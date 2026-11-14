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
export const COMPETITION_RESEARCH_MAX_SOURCES = 30
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

/**
 * Query clipping never inserts an ellipsis: "… competitors al…" style queries
 * degrade the search engine's matching. Cut at a word boundary instead.
 */
export function clipQuery(value: string | undefined, max: number): string | undefined {
  const normalized = clean(value ?? "").replace(/\s+/g, " ").trim()
  if (!normalized) return undefined
  if (normalized.length <= max) return normalized
  const cut = normalized.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trim() || undefined
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
    clipQuery(phraseSource.split(/[.!?\n]/)[0], 60)?.replace(/["']/g, "").trim() || input.projectName
  const audience = clipQuery((input.targetUsers ?? [])[0] ?? "", 40)?.replace(/["']/g, "").trim()

  const withAudience = audience ? ` for ${audience}` : ""
  return [
    clipQuery(`${category}${withAudience} competitors alternatives pricing`, COMPETITION_RESEARCH_QUERY_MAX),
    clipQuery(`${category} market size valuation ${year}`, COMPETITION_RESEARCH_QUERY_MAX),
    clipQuery(`${category} funding news ${year}`, COMPETITION_RESEARCH_QUERY_MAX),
    clipQuery(`${category} software pricing plans cost per month`, COMPETITION_RESEARCH_QUERY_MAX),
    clipQuery(`${category} startups funding raised valuation ${year}`, COMPETITION_RESEARCH_QUERY_MAX),
  ].filter((q): q is string => Boolean(q))
}

const COMPETITION_QUERY_ASK =
  "Write exactly five web search queries to research this product's competition and market:\n" +
  '"competitors" — direct and alternative products these target users could choose instead.\n' +
  '"market" — market size, growth and valuation data for this category.\n' +
  '"news" — recent funding, launches or news about the main players.\n' +
  '"pricing" — actual prices, plans and costs of the competing products (pricing pages, plan comparisons).\n' +
  '"funding" — funding rounds, amounts raised and reported valuations of companies in this category.\n' +
  "Rules: each query max 120 characters; use the category and audience words from the plan; " +
  "NEVER use the founder's own product name as a query (it is new and not indexed yet) — search its " +
  "category instead; include a geography if the plan names one.\n" +
  'Return ONLY: {"competitors": "...", "market": "...", "news": "...", "pricing": "...", "funding": "..."}'

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
  pricing: z.string().min(1).optional(),
  funding: z.string().min(1).optional(),
})

/**
 * Parse the model's JSON query output. Returns null unless at least one query
 * survived — the caller then fills the gaps from the deterministic fallback.
 */
export function parseCompetitionQueries(raw: string): {
  competitors?: string
  market?: string
  news?: string
  pricing?: string
  funding?: string
} | null {
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
    value ? clipQuery(value.replace(/["']/g, "").trim(), COMPETITION_RESEARCH_QUERY_MAX) : undefined
  const parsedQueries = {
    ...(clipped(result.data.competitors) ? { competitors: clipped(result.data.competitors) } : {}),
    ...(clipped(result.data.market) ? { market: clipped(result.data.market) } : {}),
    ...(clipped(result.data.news) ? { news: clipped(result.data.news) } : {}),
    ...(clipped(result.data.pricing) ? { pricing: clipped(result.data.pricing) } : {}),
    ...(clipped(result.data.funding) ? { funding: clipped(result.data.funding) } : {}),
  }
  return Object.keys(parsedQueries).length > 0 ? parsedQueries : null
}

// The grounded analysis prompt lives in ./competition-report — a strict JSON
// contract validated before persistence (the legacy free-markdown ask leaked
// internal model reasoning into the Nov 13 2026 report).
