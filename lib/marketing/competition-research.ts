import "server-only"

/**
 * Competition live-research service.
 *
 * At the founder's request this runs REAL web research via Firecrawl
 * /v2/search and hands the evidence to the snapshot writer:
 *
 *   1. The founder's plan → three search queries (one metered ai.text call;
 *      a deterministic plan-derived fallback fills any gaps).
 *   2. Three scoped multi-source searches — competitors (web + Alexandria
 *      data tools, pages scraped), market & valuation (web filtered to the
 *      "research" category + news), recent funding/news (news, past year).
 *   3. Every response is zod-validated and URL-sanitized into display-safe
 *      sources (pure module: ./competition-research-context), which both
 *      ground the analysis prompt and persist on the snapshot as references.
 *
 * Billing mirrors lib/marketing/seo/credits.ts exactly: a fixed, env-tunable
 * credit amount charged against the project ledger only when a search run is
 * actually about to start, refunded best-effort if the run or the analysis
 * fails. The AI analysis itself is metered separately through the runtime
 * router, like every other studio generation.
 *
 * Honesty boundary: search results are what the provider returned at query
 * time — shown to the founder with links and dates, never presented as
 * verified truth. Sources are recorded verbatim (clipped, with explicit
 * constants) so the founder can audit every claim.
 */

import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import { consumeCredits, grantCredits, getAvailableCredits } from "@/lib/billing/credit-service"
import { cryptoId } from "@/lib/store/store"
import { isFirecrawlConfigured, searchMultiSource } from "@/lib/integrations/firecrawl/client"
import { routeRuntimeRequest } from "@/lib/runtime/router/router"
import { enforceProjectRuntimeLimits } from "@/lib/runtime/control/enforce-limits"
import { resolveProjectRuntimeIdentity } from "@/lib/marketing/studio/market-service"
import type { MarketAssetResearch, MarketResearchSource } from "@/lib/types/db"
import type { MirrorProject } from "@/lib/types/project"
import type { ApplicationSpecification } from "@/lib/types/specification"
import { readCombinedMarketingPlan } from "@/lib/analysis/plan-sections"
import {
  COMPETITION_RESEARCH_MAX_SOURCES,
  buildCompetitionQueryMessages,
  dedupeSources,
  fallbackCompetitionQueries,
  normalizeMultiSearch,
  parseCompetitionQueries,
  type CompetitionSource,
} from "./competition-research-context"

// ─── Billing (same discipline as lib/marketing/seo/credits.ts) ──────────────

/**
 * Credit cost of one live-research run. Overridable via
 * COMPETITION_RESEARCH_CREDIT_COST (integer ≥ 0; 0 makes the search step free
 * and skips the ledger entry — the AI analysis stays metered regardless).
 */
export function getCompetitionResearchCost(): number {
  const raw = process.env.COMPETITION_RESEARCH_CREDIT_COST
  if (raw === undefined) return 15
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return 15
  return parsed
}

export async function getCompetitionResearchAffordability(
  userId: string,
): Promise<{ cost: number; available: number; affordable: boolean }> {
  const cost = getCompetitionResearchCost()
  const available = await getAvailableCredits(userId)
  return { cost, available, affordable: cost <= 0 || available >= cost }
}

/** Charge for one research run. False = cannot afford; the caller must not search. */
export async function chargeCompetitionResearchCredits(userId: string, projectId: string): Promise<boolean> {
  const amount = getCompetitionResearchCost()
  if (amount <= 0) {
    logger.info("credits.competitionResearch", "charge skipped (zero cost configured)", { userId, projectId })
    return true
  }
  const available = await getAvailableCredits(userId)
  if (available < amount) {
    logger.warn("credits.competitionResearch", "insufficient credits", { userId, amount, available })
    return false
  }
  const result = await consumeCredits({
    userId,
    amount,
    transactionType: "ai_collaboration",
    // Synchronous one-shot REST flow: a retried request is a NEW run and must
    // be a new charge, so the key stays random (same discipline as seo/credits).
    idempotencyKey: `comp_research_${cryptoId()}`,
    referenceType: "project",
    referenceId: projectId,
    projectId,
    metadata: { reason: "Live competitor research", feature: "competition_research" },
  })
  if (!result.success) {
    logger.warn("credits.competitionResearch", "consume failed", { userId, amount })
    return false
  }
  logger.info("credits.competitionResearch", "charged", { userId, projectId, amount })
  return true
}

export type ResearchRefundOutcome = "refunded" | "not_charged" | "failed"

/** Best-effort refund after a charged run failed. Never throws; reports outcome. */
export async function refundCompetitionResearchCredits(
  userId: string,
  projectId: string,
  amount: number = getCompetitionResearchCost(),
): Promise<ResearchRefundOutcome> {
  if (amount <= 0) return "not_charged"
  try {
    await grantCredits({
      userId,
      creditType: "permanent",
      amount,
      transactionType: "other_reversal",
      idempotencyKey: `comp_research_refund_${cryptoId()}`,
      referenceType: "project",
      referenceId: projectId,
      projectId,
      metadata: { reason: "Live competitor research failed — automatic refund", feature: "competition_research" },
    })
    logger.info("credits.competitionResearch", "refunded after failure", { userId, projectId, amount })
    return "refunded"
  } catch (e) {
    logger.warn("credits.competitionResearch", "refund failed", {
      userId,
      projectId,
      message: e instanceof Error ? e.message : String(e),
    })
    return "failed"
  }
}

// ─── Query derivation ───────────────────────────────────────────────────────

/**
 * Turn the plan into three search queries. One metered ai.text call drafts
 * them; any unusable output or failure falls back to the deterministic
 * plan-derived queries. Both sets are derived from the plan only — no client
 * input reaches the search engine verbatim (injection surface stays closed).
 */
export async function deriveCompetitionQueries(input: {
  userId: string
  projectId: string
  projectName: string
  description?: string
  idea?: string
  targetUsers?: string[]
  marketingPlan?: string
}): Promise<string[]> {
  const fallback = fallbackCompetitionQueries(input)
  try {
    const identity = await resolveProjectRuntimeIdentity({
      userId: input.userId,
      projectId: input.projectId,
      capability: "ai.text",
    })
    await enforceProjectRuntimeLimits(identity.auth)
    const messages = buildCompetitionQueryMessages({
      projectName: input.projectName,
      description: input.description,
      idea: input.idea,
      targetUsers: input.targetUsers,
      marketingPlan: input.marketingPlan,
    })
    const response = await routeRuntimeRequest(identity.auth, {
      capability: "ai.text",
      operation: "chat",
      input: {
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.prompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
      },
    })
    const content = (response.data as { content?: unknown } | null)?.content
    if (typeof content !== "string") return fallback
    const parsed = parseCompetitionQueries(content)
    if (!parsed) return fallback
    return [parsed.competitors ?? fallback[0], parsed.market ?? fallback[1], parsed.news ?? fallback[2]].filter(
      (q): q is string => Boolean(q),
    )
  } catch (e) {
    logger.warn("marketing.competition.research", "query derivation failed — using plan-derived fallback", {
      projectId: input.projectId,
      message: e instanceof Error ? e.message : String(e),
    })
    return fallback
  }
}

// ─── Search execution ───────────────────────────────────────────────────────

const SEARCH_LIMIT = 6

/**
 * Run the three scoped searches. Partial failure is honest and tolerated —
 * the founder sees whichever sources did land; total failure throws so the
 * caller refunds.
 */
export async function runCompetitionSearches(queries: string[]): Promise<MarketResearchSource[]> {
  const searches = [
    {
      label: "competitors",
      query: queries[0],
      options: { sources: ["web", "alexandria"] as const, limit: SEARCH_LIMIT, scrapeWeb: true },
    },
    {
      label: "market & valuation",
      query: queries[1],
      options: { sources: ["web", "news"] as const, categories: ["research"], limit: SEARCH_LIMIT },
    },
    {
      label: "recent news",
      query: queries[2],
      options: { sources: ["news"] as const, limit: SEARCH_LIMIT, tbs: "qdr:y" },
    },
  ].filter((search) => Boolean(search.query))

  const results = await Promise.allSettled(
    searches.map((search) => searchMultiSource(search.query as string, { ...search.options })),
  )

  const sources: CompetitionSource[] = []
  let failed = 0
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      sources.push(...normalizeMultiSearch(result.value, index))
    } else {
      failed += 1
      logger.warn("marketing.competition.research", `search "${searches[index].label}" failed`, {
        query: searches[index].query,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  })

  if (sources.length === 0) {
    throw new AppError(
      "AI_UNAVAILABLE",
      failed > 0
        ? "The live web search didn't return any usable results. Nothing was kept."
        : "The live web search returned no usable sources. Nothing was kept.",
    )
  }

  const deduped = dedupeSources(sources).slice(0, COMPETITION_RESEARCH_MAX_SOURCES)
  logger.info("marketing.competition.research", "searches complete", {
    requested: searches.length,
    failed,
    sources: deduped.length,
  })
  return deduped.map(stripPromptOnlyWeight)
}

// ─── Orchestration ──────────────────────────────────────────────────────────

export interface CompetitionResearchBundle {
  research: MarketAssetResearch
}

/**
 * Full research bundle for one snapshot run: derive queries → search →
 * normalize into persisted, display-safe sources.
 */
export async function runCompetitionResearch(input: {
  userId: string
  projectId: string
  project: MirrorProject
}): Promise<CompetitionResearchBundle> {
  const spec = (input.project.specification ?? undefined) as ApplicationSpecification | undefined
  const marketingPlan = spec ? readCombinedMarketingPlan(spec) : ""

  const queries = await deriveCompetitionQueries({
    userId: input.userId,
    projectId: input.projectId,
    projectName: input.project.name,
    description: spec?.description,
    idea: input.project.idea,
    targetUsers: spec?.targetUsers,
    marketingPlan,
  })

  const sources = await runCompetitionSearches(queries)
  return {
    research: {
      queries,
      collectedAt: Date.now(),
      sources: sources as MarketResearchSource[],
      researchCreditsCharged: 0,
    },
  }
}

/**
 * The Firecrawl client returns provider payloads; ensure the persisted shape
 * is exactly MarketResearchSource (drops any stray fields).
 */
function stripPromptOnlyWeight(source: CompetitionSource): MarketResearchSource {
  return {
    kind: source.kind,
    title: source.title,
    ...(source.url ? { url: source.url } : {}),
    ...(source.domain ? { domain: source.domain } : {}),
    ...(source.snippet ? { snippet: source.snippet } : {}),
    ...(source.excerpt ? { excerpt: source.excerpt } : {}),
    ...(source.date ? { date: source.date } : {}),
    ...(source.provider ? { provider: source.provider } : {}),
    ...(source.queryIndex !== undefined ? { queryIndex: source.queryIndex } : {}),
  }
}

export { isFirecrawlConfigured }
