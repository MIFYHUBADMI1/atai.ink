/**
 * Competition live research — pure context assembly and evidence shaping.
 *
 * The competition snapshot used to be written strictly from the founder's own
 * plan (an honest limitation: Atai collected no live market data). It now runs
 * REAL live web research at the founder's request — Firecrawl /v2/search
 * across web, news, the "research" category, and Alexandria data-provider
 * discovery — and the analysis prompt is grounded in exactly those sources.
 *
 * Everything here is deterministic and side-effect free (NO network, DB, or
 * env access) so it is unit-testable: the service module
 * (`./competition-research`) owns the calls, billing, and persistence.
 *
 * Honesty rules encoded here:
 *  - Search results are what the provider returned at query time — they are
 *    shown to the founder WITH links and dates, never presented as verified
 *    truth. No output can be guaranteed 100% accurate; attribution is the
 *    substitute for that promise.
 *  - Source URLs are sanitized to http(s) — nothing executable reaches the UI.
 *  - Nothing is dropped silently: sources are capped and clipped with
 *    explicit constants, and the analysis prompt orders the model to say
 *    plainly when the sources do not establish something.
 */

import { z } from "zod"
import {
  clipPlanForPrompt,
  type CompetitionSnapshotContextInput,
} from "./competition-snapshot-context"

function clean(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim()
}

// ─── Shaping constants ──────────────────────────────────────────────────────

export const COMPETITION_RESEARCH_QUERY_MAX = 120
export const COMPETITION_RESEARCH_SNIPPET_MAX = 320
export const COMPETITION_RESEARCH_PAGE_MAX = 900
export const COMPETITION_RESEARCH_MAX_SOURCES = 24
/** Application budget for the grounded analysis prompt (plan + sources). */
export const COMPETITION_RESEARCH_PROMPT_BUDGET = 16_000

export type CompetitionSourceKind = "web" | "news" | "research" | "data_tool"

export interface CompetitionSource {
  kind: CompetitionSourceKind
  title: string
  url?: string
  domain?: string
  snippet?: string
  excerpt?: string
  date?: string
  provider?: string
  queryIndex?: number
}

// ─── Response normalization ─────────────────────────────────────────────────

// Shape-only validation — the URL safety gate is sanitizeSourceUrl below, so
// one malformed entry never discards the whole response.
const rawUrl = z.string().max(2048)

const webResultSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  url: rawUrl.optional(),
  markdown: z.string().optional(),
  category: z.string().optional(),
})

const newsResultSchema = z.object({
  title: z.string().optional(),
  url: rawUrl.optional(),
  snippet: z.string().optional(),
  date: z.string().optional(),
})

const toolResultSchema = z.object({
  provider: z.string().optional(),
  capability: z.string().optional(),
  description: z.string().optional(),
  url: rawUrl.optional(),
})

const multiSearchSchema = z.object({
  data: z
    .object({
      web: z.array(webResultSchema).optional(),
      news: z.array(newsResultSchema).optional(),
      tools: z.array(toolResultSchema).optional(),
    })
    .optional(),
})

export function clipSnippet(value: string | undefined, max: number): string | undefined {
  const normalized = clean(value ?? "").replace(/\s+/g, " ")
  if (!normalized) return undefined
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`
}

export function sanitizeSourceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  return /^https?:\/\//i.test(value) && value.length <= 2048 ? value : undefined
}

export function sourceDomain(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || undefined
  } catch {
    return undefined
  }
}

/**
 * Normalize one raw Firecrawl /v2/search response into display-safe sources.
 * Invalid entries and non-http(s) URLs are DROPPED (never repaired into
 * something misleading); dedupe by URL keeps the first, richest entry.
 */
export function normalizeMultiSearch(raw: unknown, queryIndex: number): CompetitionSource[] {
  const parsed = multiSearchSchema.safeParse(raw)
  if (!parsed.success) return []
  const { web, news, tools } = parsed.data.data ?? {}

  const sources: CompetitionSource[] = []
  const seen = new Set<string>()

  for (const item of web ?? []) {
    const url = sanitizeSourceUrl(item.url)
    const domain = sourceDomain(url)
    const isResearch = (item.category ?? "").toLowerCase() === "research"
    const title = clean(item.title ?? "").replace(/\s+/g, " ") || domain || "Untitled result"
    const key = (url ?? `title:${title.toLowerCase()}`).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    sources.push({
      kind: isResearch ? "research" : "web",
      title,
      ...(url ? { url } : {}),
      ...(domain ? { domain } : {}),
      ...(clipSnippet(item.description, COMPETITION_RESEARCH_SNIPPET_MAX)
        ? { snippet: clipSnippet(item.description, COMPETITION_RESEARCH_SNIPPET_MAX) }
        : {}),
      ...(clipSnippet(item.markdown, COMPETITION_RESEARCH_PAGE_MAX)
        ? { excerpt: clipSnippet(item.markdown, COMPETITION_RESEARCH_PAGE_MAX) }
        : {}),
      queryIndex,
    })
  }

  for (const item of news ?? []) {
    const url = sanitizeSourceUrl(item.url)
    const domain = sourceDomain(url)
    const title = clean(item.title ?? "").replace(/\s+/g, " ") || domain || "Untitled result"
    const key = (url ?? `title:${title.toLowerCase()}`).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const date = clean(item.date ?? "").slice(0, 32) || undefined
    sources.push({
      kind: "news",
      title,
      ...(url ? { url } : {}),
      ...(domain ? { domain } : {}),
      ...(clipSnippet(item.snippet, COMPETITION_RESEARCH_SNIPPET_MAX)
        ? { snippet: clipSnippet(item.snippet, COMPETITION_RESEARCH_SNIPPET_MAX) }
        : {}),
      ...(date ? { date } : {}),
      queryIndex,
    })
  }

  for (const item of tools ?? []) {
    const provider = clean(item.provider ?? "").slice(0, 120) || undefined
    const capability = clean(item.capability ?? "").slice(0, 160) || undefined
    const url = sanitizeSourceUrl(item.url)
    const title =
      [provider, capability].filter(Boolean).join(" — ") ||
      sourceDomain(url) ||
      "Unnamed data tool"
    const key = (url ?? `tool:${(provider ?? title).toLowerCase()}`).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    sources.push({
      kind: "data_tool",
      title,
      ...(url ? { url } : {}),
      ...(sourceDomain(url) ? { domain: sourceDomain(url) } : {}),
      ...(clipSnippet(item.description, COMPETITION_RESEARCH_SNIPPET_MAX)
        ? { snippet: clipSnippet(item.description, COMPETITION_RESEARCH_SNIPPET_MAX) }
        : {}),
      ...(provider ? { provider } : {}),
      queryIndex,
    })
  }

  return sources.slice(0, COMPETITION_RESEARCH_MAX_SOURCES)
}

/**
 * Dedupe across separate searches (the same URL can surface for both the
 * competitor and market queries). First occurrence wins — searches run in
 * priority order, so the earlier (richer, scraped) entry is kept.
 */
export function dedupeSources(sources: CompetitionSource[]): CompetitionSource[] {
  const seen = new Set<string>()
  const kept: CompetitionSource[] = []
  for (const source of sources) {
    const key = (
      source.url ? source.url.toLowerCase().replace(/\/+$/, "") : `${source.kind}:${source.title.toLowerCase()}`
    )
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(source)
    if (kept.length >= COMPETITION_RESEARCH_MAX_SOURCES) break
  }
  return kept
}

// ─── Search-query derivation ────────────────────────────────────────────────

export const COMPETITION_QUERY_SYSTEM =
  "You turn a founder's product plan into precise web search queries for competitive and market research. " +
  "Return ONLY a JSON object — no prose, no markdown fences."

/**
 * Derive fallback queries deterministically from the plan. The AI-derived set
 * is preferred; this guarantees a usable (if blunter) search even when the
 * model output is unusable. Every query is recorded and shown to the founder.
 */
export function fallbackCompetitionQueries(
  input: Pick<CompetitionSnapshotContextInput, "projectName" | "description" | "idea" | "targetUsers" | "marketingPlan">,
  year: number = new Date().getFullYear(),
): string[] {
  const phraseSource =
    clean(input.description ?? "") || clean(input.idea ?? "") || clean(input.marketingPlan ?? "") || input.projectName
  // First sentence-ish chunk, punctuation softened — search engines prefer it.
  const category =
    clipSnippet(phraseSource.split(/[.!?\n]/)[0], 60)?.replace(/["']/g, "").trim() || input.projectName
  const audience = clipSnippet((input.targetUsers ?? [])[0] ?? "", 40)?.replace(/["']/g, "").trim()

  const withAudience = audience ? ` for ${audience}` : ""
  return [
    clipSnippet(`${category}${withAudience} competitors alternatives pricing`, COMPETITION_RESEARCH_QUERY_MAX),
    clipSnippet(`${category} market size valuation ${year}`, COMPETITION_RESEARCH_QUERY_MAX),
    clipSnippet(`${category} funding news ${year}`, COMPETITION_RESEARCH_QUERY_MAX),
  ].filter((q): q is string => Boolean(q))
}

const COMPETITION_QUERY_ASK =
  "Write exactly three web search queries to research this product's competition and market:\n" +
  '"competitors" — direct and alternative products these target users could choose instead.\n' +
  '"market" — market size, growth and valuation data for this category.\n' +
  '"news" — recent funding, launches or news about the main players.\n' +
  "Rules: each query max 120 characters; use the category and audience words from the plan; " +
  "NEVER use the founder's own product name as a query (it is new and not indexed yet) — search its " +
  "category instead; include a geography if the plan names one.\n" +
  'Return ONLY: {"competitors": "...", "market": "...", "news": "..."}'

export function buildCompetitionQueryMessages(
  input: Pick<CompetitionSnapshotContextInput, "projectName" | "description" | "idea" | "targetUsers" | "marketingPlan">,
): { system: string; prompt: string } {
  const users = (input.targetUsers ?? []).map((u) => clean(u)).filter(Boolean)
  const context = [
    `Product: ${clipSnippet(input.projectName, 120)}`,
    clipSnippet(input.description, 600) ? `What it is: ${clipSnippet(input.description, 600)}` : "",
    clipSnippet(input.idea, 600) ? `In the founder's words: ${clipSnippet(input.idea, 600)}` : "",
    users.length ? `Target users: ${clipSnippet(users.join("; "), 300)}` : "",
    input.marketingPlan ? `Plan: ${clipPlanForPrompt(input.marketingPlan, 2_000)}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  return { system: COMPETITION_QUERY_SYSTEM, prompt: `${COMPETITION_QUERY_ASK}\n\n${context}` }
}

const queryOutputSchema = z.object({
  competitors: z.string().min(1).optional(),
  market: z.string().min(1).optional(),
  news: z.string().min(1).optional(),
})

/**
 * Parse the model's JSON query output. Returns null unless at least one query
 * survived — the caller then fills the gaps from the deterministic fallback.
 */
export function parseCompetitionQueries(raw: string): { competitors?: string; market?: string; news?: string } | null {
  const match = /\{[\s\S]*\}/.exec(raw)
  if (!match) return null
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(match[0])
  } catch {
    return null
  }
  const result = queryOutputSchema.safeParse(parsedJson)
  if (!result.success) return null
  const clipped = (value: string | undefined) =>
    value ? clipSnippet(value.replace(/["']/g, "").trim(), COMPETITION_RESEARCH_QUERY_MAX) : undefined
  const parsedQueries = {
    ...(clipped(result.data.competitors) ? { competitors: clipped(result.data.competitors) } : {}),
    ...(clipped(result.data.market) ? { market: clipped(result.data.market) } : {}),
    ...(clipped(result.data.news) ? { news: clipped(result.data.news) } : {}),
  }
  return Object.keys(parsedQueries).length > 0 ? parsedQueries : null
}

// ─── Grounded analysis prompt ───────────────────────────────────────────────

export const COMPETITION_RESEARCH_ASK =
  "Draft the competitor-landscape snapshot for this product, grounded in the founder's plan AND the " +
  "numbered live-research sources provided.\n" +
  "Cover each point under its own short markdown heading, in this order:\n" +
  '1 "Positioning" — what the plan says sets this product apart, restated clearly.\n' +
  '2 "Who it serves" — the target customers, as the plan describes them.\n' +
  '3 "Competitors found in the live research" — ONLY companies that appear in the sources. For each: ' +
  "what they do and how they compare, cited like (source: example.com). If no real competitors appear " +
  "in the sources, say exactly that.\n" +
  '4 "Market size & valuation signals" — ONLY figures that appear in the sources, each with its source ' +
  "domain and, for market reports, its date. Never extrapolate or combine numbers.\n" +
  '5 "Recent news & funding" — items from the news sources with their dates.\n' +
  '6 "Useful data providers & tools" — relevant data-tool sources the founder could use for deeper research, if any.\n' +
  '7 "Differentiation opportunities" — hypotheses that tie the plan\'s positioning to what the sources show.\n' +
  '8 "What the sources do not establish" — the claims the research could NOT confirm.\n' +
  '9 "Questions to investigate next" — two or three concrete follow-up questions.\n' +
  "HARD RULES: every company, product, price, market size, growth rate, ranking, review or funding event " +
  "MUST come from the numbered sources or the founder's plan, cited like (source: example.com). If sources " +
  "disagree or are missing, say so plainly instead of filling the gap from memory. Never invent a fact, " +
  "number, or company. Search results change over time — phrase findings as what the sources showed."

export const COMPETITION_RESEARCH_SYSTEM =
  "You are the competitive-intelligence analyst inside a founder's product workspace. " +
  "You write competitor-landscape snapshots grounded in numbered live-research sources gathered at the " +
  "founder's request. Every company, number, price, ranking or funding event must come from those sources " +
  "or the founder's own plan, cited like (source: example.com). Never invent facts; when the sources do " +
  "not establish something, say so plainly. Do not mention that you are an AI. " +
  "Return only the requested deliverable — no preamble, no markdown fences."

const SOURCE_KIND_LABELS: Record<CompetitionSourceKind, string> = {
  web: "web",
  news: "news",
  research: "research",
  data_tool: "data tool",
}

export function formatSourceLine(source: CompetitionSource, index: number): string {
  const label = SOURCE_KIND_LABELS[source.kind]
  const where = source.url ? ` — ${source.domain ?? source.url}` : ""
  const date = source.date ? ` — ${source.date}` : ""
  const head = `[${index + 1}] ${label} · ${source.title}${where}${date}`
  const detail = source.excerpt
    ? `Content: ${source.excerpt}`
    : source.snippet
      ? `Summary: ${source.snippet}`
      : source.provider && source.kind === "data_tool"
        ? `Provider: ${source.provider}`
        : ""
  return detail ? `${head}\n${detail}` : head
}

export function formatSourcesBlock(sources: CompetitionSource[]): string {
  if (sources.length === 0) {
    return "Live-research sources: none — the searches returned nothing usable. Say so in every section " +
      "that would have needed them."
  }
  return ["Live-research sources (numbered — cite them like (source: domain)):", ...sources.map((s, i) => formatSourceLine(s, i))].join("\n")
}

export interface CompetitionResearchPromptInput extends CompetitionSnapshotContextInput {
  research: { queries: string[]; sources: CompetitionSource[] }
}

/**
 * Assemble the grounded system + user messages. Sources take budget priority
 * over the plan: the plan is clipped to whatever room remains, with the same
 * explicit omission marker used everywhere else — nothing disappears silently.
 */
export function buildCompetitionResearchMessages(input: CompetitionResearchPromptInput): {
  system: string
  prompt: string
} {
  const users = (input.targetUsers ?? []).map((user) => clean(user)).filter(Boolean)

  const fixed: string[] = [
    `App: ${clipSnippet(input.projectName, 200)}`,
    clipSnippet(input.description, 600) ? `What it is: ${clipSnippet(input.description, 600)}` : "",
    clipSnippet(input.idea, 800) ? `In the founder's words: ${clipSnippet(input.idea, 800)}` : "",
    users.length ? `Target users: ${clipSnippet(users.join("; "), 1_200)}` : "",
    input.goals?.businessGoal ? `Business goal: ${clipSnippet(input.goals.businessGoal, 300)}` : "",
    input.goals?.revenueTarget ? `Revenue target: ${clipSnippet(input.goals.revenueTarget, 150)}` : "",
    input.goals?.destination ? `Where the founder wants it to live: ${clipSnippet(input.goals.destination, 150)}` : "",
  ].filter(Boolean)

  const queriesLine = input.research.queries.length
    ? `Searches run (in order): ${input.research.queries.map((q, i) => `q${i + 1}: "${q}"`).join("; ")}`
    : "No search queries recorded."
  const sourcesBlock = formatSourcesBlock(input.research.sources)

  const siteUrl = clean(input.siteUrl ?? "")
  const urlLine = siteUrl.length > 2048
    ? "Live URL: omitted because it exceeds 2048 characters; no shortened URL was substituted."
    : siteUrl
      ? `Live URL: ${siteUrl}`
      : "Live URL: none yet — leave link-specific steps to the founder."

  const nonPlanLength =
    COMPETITION_RESEARCH_SYSTEM.length +
    COMPETITION_RESEARCH_ASK.length +
    queriesLine.length +
    sourcesBlock.length +
    fixed.join("\n").length +
    urlLine.length +
    12

  const planBudget = COMPETITION_RESEARCH_PROMPT_BUDGET - nonPlanLength
  const plan = planBudget > 0 ? clipPlanForPrompt(input.marketingPlan, planBudget) : ""
  const planBlock = plan
    ? `Marketing plan from the founder's planning (positioning, value proposition, channels):\n${plan}`
    : "Marketing plan: none written yet or omitted to fit the budget — draft from the facts and sources above."

  const prompt = [COMPETITION_RESEARCH_ASK, "Founder's plan context:", fixed.join("\n"), planBlock, queriesLine, sourcesBlock, urlLine]
    .filter(Boolean)
    .join("\n\n")

  return { system: COMPETITION_RESEARCH_SYSTEM, prompt }
}
