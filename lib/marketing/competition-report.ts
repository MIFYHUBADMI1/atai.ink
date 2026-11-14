/**
 * Competition live-research report contract — pure, side-effect free.
 *
 * The Nov 13 2026 run persisted the model's internal reasoning verbatim as the
 * report body ("The user wants a competitor-landscape snapshot… Let me analyze
 * the sources first…"). This module closes that hole: the analysis must arrive
 * as a strict JSON report, every string is scanned for internal-instruction
 * leakage, evidence ids must resolve to real retrieved sources, and an honesty
 * pass downgrades any claim the sources do not actually support. Validation
 * failures throw BEFORE persistence so the caller refunds and the founder sees
 * a recoverable error — never raw model text.
 *
 * Source relevance is scored deterministically against the business context so
 * a pizza-chain data tool can never become evidence for a cake bakery, and
 * market figures keep their geographic scope instead of being blended.
 */

import { z } from "zod"
import type { MarketSourceCategory, MarketSourceRelevance } from "@/lib/types/db"
import {
  clipPlanForPrompt,
  type CompetitionSnapshotContextInput,
} from "./competition-snapshot-context"
import {
  clipSnippet,
  sanitizeSourceUrl,
  COMPETITION_RESEARCH_PROMPT_BUDGET,
  type CompetitionSource,
} from "./competition-research-context"

// ─── Vocabulary ─────────────────────────────────────────────────────────────

export const COMPETITOR_CATEGORIES = [
  "direct",
  "indirect",
  "substitute",
  "emerging",
  "supporting_software",
  "not_competitor",
] as const
export type CompetitorCategory = (typeof COMPETITOR_CATEGORIES)[number]

export const CLAIM_STATUSES = [
  "verified_fact",
  "ai_interpretation",
  "ai_suggestion",
  "founder_provided",
  "unknown",
  "outdated",
] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

export const VERIFICATION_STATUSES = ["verified", "ai_suggestion", "research_needed"] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export const GEO_SCOPES = ["global", "regional", "country", "local"] as const
export type GeoScope = (typeof GEO_SCOPES)[number]

export const COMPETITOR_CATEGORY_LABELS: Record<CompetitorCategory, string> = {
  direct: "Direct competitor",
  indirect: "Indirect competitor",
  substitute: "Substitute",
  emerging: "Emerging competitor",
  supporting_software: "Supporting software / provider",
  not_competitor: "Not a competitor",
}

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  verified_fact: "Verified fact",
  ai_interpretation: "AI interpretation",
  ai_suggestion: "AI suggestion",
  founder_provided: "Founder-provided",
  unknown: "Unknown",
  outdated: "Outdated",
}

export const SOURCE_CATEGORY_LABELS: Record<MarketSourceCategory, string> = {
  competitor_website: "Competitor website",
  competitor_product: "Competitor product page",
  pricing_page: "Pricing page",
  industry_report: "Industry report",
  customer_research: "Customer research",
  news: "News",
  market_data: "Market data",
  data_tool: "Data tool",
  irrelevant: "Irrelevant result",
}

// ─── Source classification ──────────────────────────────────────────────────

export interface ClassifiedSource extends CompetitionSource {
  /** Stable evidence id (`s1`…`sN`) — array order is persisted, so ids are stable. */
  id: string
  category: MarketSourceCategory
  relevance: MarketSourceRelevance
  relevanceScore: number
  relevanceReason: string
}

export interface BusinessContext {
  projectName?: string
  description?: string
  idea?: string
  targetUsers?: string[]
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "where", "customers", "customer",
  "platform", "app", "application", "business", "product", "service", "services", "their",
  "they", "them", "your", "you", "our", "are", "was", "were", "been", "have", "has", "had",
  "will", "would", "could", "should", "can", "may", "might", "into", "onto", "over", "under",
  "about", "after", "before", "between", "through", "during", "without", "within", "along",
  "following", "across", "behind", "beyond", "plus", "minus", "versus", "via", "per", "than",
  "then", "when", "while", "what", "which", "who", "whom", "whose", "how", "why", "all", "any",
  "both", "each", "few", "more", "most", "other", "some", "such", "only", "own", "same", "so",
  "too", "very", "just", "because", "but", "not", "no", "nor", "or", "as", "at", "by", "in",
  "of", "on", "to", "up", "out", "off", "down", "here", "there", "once", "also", "ever",
  "never", "always", "often", "sometimes", "usually", "really", "quite", "rather", "almost",
  "enough", "even", "still", "already", "yet", "soon", "today", "tomorrow", "yesterday",
  "local", "residents", "ordering", "order", "orders", "online", "website", "websites",
])

export function businessKeywords(context: BusinessContext): string[] {
  const text = [context.description, context.idea, context.projectName, ...(context.targetUsers ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  const words = text.match(/[a-z][a-z-]{3,}/g) ?? []
  const seen = new Set<string>()
  for (const word of words) {
    if (!STOPWORDS.has(word)) seen.add(word)
  }
  return [...seen].slice(0, 40)
}

const REVIEW_DOMAINS = ["reddit.com", "quora.com", "yelp.com", "trustpilot.com", "g2.com", "clutch.co", "tripadvisor.com"]
const REPORT_DOMAINS = [
  "imarcgroup.com", "dataintelo.com", "cognitivemarketresearch.com", "researchgate.net", "statista.com",
  "grandviewresearch.com", "marketsandmarkets.com", "fortunebusinessinsights.com", "mordorintelligence.com",
]
const MARKET_FIGURE_RE = /market (size|share|growth|forecast|valuation|report)|billion|million|cagr|forecast \d{4}/i
const GEO_TOKENS = ["global", "north america", "europe", "asia", "india", "china", "japan", "uk", "united states", "usa", "canada", "australia", "africa", "latin america", "middle east", "southeast asia"]

function haystack(source: CompetitionSource): string {
  return [source.title, source.snippet, source.excerpt, source.provider].filter(Boolean).join(" ").toLowerCase()
}

function overlapScore(hay: string, keywords: string[]): { score: number; matched: string[] } {
  const matched = keywords.filter((k) => hay.includes(k))
  return { score: matched.length, matched }
}

function geoNote(hay: string, context: BusinessContext): string {
  const businessHay = [context.description, context.idea, ...(context.targetUsers ?? [])].filter(Boolean).join(" ").toLowerCase()
  const sourceGeos = GEO_TOKENS.filter((g) => hay.includes(g))
  const businessGeos = GEO_TOKENS.filter((g) => businessHay.includes(g))
  if (sourceGeos.length === 0) return ""
  if (businessGeos.length === 0) return `geography: ${sourceGeos[0]} (business plan names none)`
  const foreign = sourceGeos.filter((g) => !businessGeos.includes(g) && g !== "global")
  return foreign.length > 0 ? `geography differs from plan (${foreign[0]})` : `geography: ${sourceGeos[0]}`
}

/**
 * Deterministic relevance + category scoring. Data tools are never competitor
 * evidence; a tool whose vocabulary does not overlap the business (pizza
 * chains vs a cake bakery) is labelled irrelevant and kept only as a lead.
 */
export function classifySources(sources: CompetitionSource[], context: BusinessContext): ClassifiedSource[] {
  const keywords = businessKeywords(context)
  return sources.map((source, index) => {
    const hay = haystack(source)
    const { score, matched } = overlapScore(hay, keywords)
    const domain = source.domain ?? ""
    const path = (() => {
      try {
        return source.url ? new URL(source.url).pathname.toLowerCase() : ""
      } catch {
        return ""
      }
    })()
    const geo = geoNote(hay, context)

    let category: MarketSourceCategory
    let relevance: MarketSourceRelevance
    let reason: string

    if (source.kind === "data_tool") {
      category = "data_tool"
      relevance = score >= 2 ? "medium" : "irrelevant"
      reason =
        relevance === "irrelevant"
          ? `Data tool vocabulary (${matched.join(", ") || "no overlap"}) does not match the business — kept as a lead only, never competitor evidence.`
          : `Data tool overlaps the business (${matched.join(", ")}) — useful for deeper research, not competitor evidence.`
    } else if (REVIEW_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
      category = "customer_research"
      relevance = score >= 2 ? "high" : score >= 1 ? "medium" : "low"
      reason = `Community / review discussion${matched.length ? ` mentioning ${matched.slice(0, 4).join(", ")}` : ""}.`
    } else if (/\/(pricing|plans|price)(\/|$)/.test(path)) {
      category = "pricing_page"
      relevance = score >= 1 ? "high" : "medium"
      reason = "Pricing page — actual price evidence when figures are quoted."
    } else if (REPORT_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
      category = MARKET_FIGURE_RE.test(hay) ? "market_data" : "industry_report"
      relevance = score >= 2 ? "high" : score >= 1 ? "medium" : "low"
      reason = `Research publisher${geo ? `; ${geo}` : ""}.`
    } else if (source.kind === "news") {
      category = MARKET_FIGURE_RE.test(hay) ? "market_data" : "news"
      relevance = score >= 2 ? "high" : score >= 1 ? "medium" : "low"
      reason = category === "market_data" ? `News carrying market figures${geo ? `; ${geo}` : ""}.` : "News item."
    } else if (source.kind === "research") {
      category = /survey|consumer preference|customer/.test(hay) ? "customer_research" : "industry_report"
      relevance = score >= 2 ? "high" : score >= 1 ? "medium" : "low"
      reason = `Industry / academic research${geo ? `; ${geo}` : ""}.`
    } else if (/\/(product|features|solutions|platform)(\/|$)/.test(path) || /software|platform|features|tool for/.test(hay)) {
      category = "competitor_product"
      relevance = score >= 2 ? "high" : score >= 1 ? "medium" : "low"
      reason = `Product / feature page${matched.length ? ` (${matched.slice(0, 4).join(", ")})` : ""}.`
    } else if (score >= 1) {
      category = "competitor_website"
      relevance = score >= 3 ? "high" : "medium"
      reason = `Business site overlapping the plan (${matched.slice(0, 4).join(", ")}).`
    } else {
      category = "irrelevant"
      relevance = "irrelevant"
      reason = "No vocabulary overlap with the business description, audience or category."
    }

    if (geo.includes("differs") && relevance === "high") relevance = "medium"

    return {
      ...source,
      id: `s${index + 1}`,
      category,
      relevance,
      relevanceScore: score,
      relevanceReason: reason,
    }
  })
}

/** Sources that may back a competitor or a factual claim. */
export function isEvidenceEligible(source: ClassifiedSource): boolean {
  return source.category !== "irrelevant" && source.category !== "data_tool" && source.relevance !== "irrelevant"
}

const COMPETITOR_SITE_CATEGORIES: MarketSourceCategory[] = ["competitor_website", "competitor_product", "pricing_page"]

// ─── Report schema ──────────────────────────────────────────────────────────

const evidenceSchema = z.object({
  sourceId: z.string().min(1).max(8),
  note: z.string().max(400).optional(),
})

const claimSchema = z.object({
  text: z.string().min(1).max(600),
  status: z.enum(CLAIM_STATUSES),
  evidence: z.array(evidenceSchema).max(6),
})

/**
 * A money fact (price, valuation, funding) the sources explicitly state.
 * Evidence is optional at the schema boundary so one unsupported fact does not
 * reject the whole report — the honesty pass drops any fact whose citations
 * are not eligible evidence, and the UI shows "not found" instead.
 */
const reportedFactSchema = z.object({
  summary: z.string().min(1).max(300),
  amount: z.number().finite().optional(),
  currency: z.string().max(8).optional(),
  asOfDate: z.string().max(40).optional(),
  evidence: z.array(evidenceSchema).max(3),
})

const competitorSchema = z.object({
  name: z.string().min(2).max(120),
  website: z.string().max(2048).optional(),
  category: z.enum(COMPETITOR_CATEGORIES),
  whyItMayCompete: z.string().min(1).max(600),
  targetAudience: z.string().max(300).optional(),
  productsServices: z.string().max(400).optional(),
  location: z.string().max(160).optional(),
  founded: z.string().max(40).optional(),
  pricing: reportedFactSchema.optional(),
  valuation: reportedFactSchema.optional(),
  funding: reportedFactSchema.optional(),
  strengths: z.array(z.string().min(1).max(200)).max(4).optional(),
  weaknesses: z.array(z.string().min(1).max(200)).max(4).optional(),
  evidence: z.array(evidenceSchema).max(6),
  verification: z.enum(VERIFICATION_STATUSES),
  confidence: z.enum(CONFIDENCE_LEVELS),
})

const marketFigureSchema = z.object({
  label: z.string().min(1).max(200),
  value: z.number().finite().optional(),
  unit: z.string().max(40).optional(),
  currency: z.string().max(8).optional(),
  geographyScope: z.enum(GEO_SCOPES),
  geographyLabel: z.string().min(1).max(120),
  publicationDate: z.string().max(40).optional(),
  forecastPeriod: z.string().max(80).optional(),
  sourceId: z.string().min(1).max(8),
  status: z.enum(CLAIM_STATUSES),
})

const comparisonCellSchema = z.object({
  name: z.string().min(1).max(120),
  value: z.string().min(1).max(300),
  sourceId: z.string().max(8).optional(),
})

const comparisonRowSchema = z.object({
  attribute: z.string().min(1).max(120),
  yours: z.string().max(300).optional(),
  competitors: z.array(comparisonCellSchema).max(8),
})

export const competitionReportSchema = z.object({
  keyFindings: z.array(claimSchema).max(8),
  limitations: z.array(z.string().min(1).max(400)).max(8),
  opportunities: z.array(claimSchema).max(8),
  competitors: z.array(competitorSchema).max(12),
  marketFigures: z.array(marketFigureSchema).max(12),
  customerBehaviour: z.array(claimSchema).max(6),
  news: z.array(claimSchema).max(8),
  featureComparison: z.array(comparisonRowSchema).max(8),
  pricingComparison: z.array(comparisonRowSchema).max(8),
  positioningNotes: z.array(claimSchema).max(6),
  gaps: z.array(z.string().min(1).max(400)).max(8),
  questions: z.array(z.string().min(1).max(300)).max(5),
})

export type CompetitionReport = z.infer<typeof competitionReportSchema>
export type ReportClaim = z.infer<typeof claimSchema>
export type ReportCompetitor = z.infer<typeof competitorSchema>
export type ReportFact = z.infer<typeof reportedFactSchema>
export type ReportMarketFigure = z.infer<typeof marketFigureSchema>
export type ReportComparisonRow = z.infer<typeof comparisonRowSchema>

// ─── Leakage guard ──────────────────────────────────────────────────────────

const LEAK_PATTERNS: Array<[RegExp, string]> = [
  [/the user wants/i, "model planning prose"],
  [/i need to (follow|analyze|extract|describe|check|list)/i, "model planning prose"],
  [/let me (analyze|think|extract|check|review)/i, "model planning prose"],
  [/now, i (need|must|will)/i, "model planning prose"],
  [/i must (only|cite|follow|list)/i, "model planning prose"],
  [/sources provided:/i, "prompt echo"],
  [/numbered live-research sources/i, "prompt echo"],
  [/system (prompt|instruction)/i, "prompt echo"],
  [/hard rules/i, "prompt echo"],
  [/prompt template/i, "prompt echo"],
  [/tool orchestration/i, "prompt echo"],
  [/as an ai/i, "model self-reference"],
  [/internal (reasoning|instructions|analysis)/i, "model self-reference"],
  [/return only (a |the )?json/i, "prompt echo"],
  [/thinking (process|block)/i, "model self-reference"],
]

/** Returns a human-readable reason when text looks like internal model work. */
export function detectInternalLeakage(text: string): string | null {
  for (const [pattern, label] of LEAK_PATTERNS) {
    if (pattern.test(text)) return label
  }
  return null
}

export class CompetitionReportError extends Error {
  readonly code = "COMPETITION_REPORT_INVALID"
  constructor(message: string) {
    super(message)
    this.name = "CompetitionReportError"
  }
}

// ─── Parsing + honesty pass ─────────────────────────────────────────────────

function extractJson(raw: string): unknown {
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // tolerate a single fenced or prefaced object, nothing else
    const match = /\{[\s\S]*\}/.exec(trimmed)
    if (!match) throw new CompetitionReportError("The analysis did not return a structured report.")
    try {
      return JSON.parse(match[0])
    } catch {
      throw new CompetitionReportError("The analysis did not return a structured report.")
    }
  }
}

function scanStrings(value: unknown): string | null {
  if (typeof value === "string") return detectInternalLeakage(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = scanStrings(item)
      if (hit) return hit
    }
    return null
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const hit = scanStrings(item)
      if (hit) return hit
    }
  }
  return null
}

export interface ParseReportResult {
  report: CompetitionReport
  /** Transparency notes about downgrades/drops applied by the honesty pass. */
  notes: string[]
}

/**
 * Validate the model's raw output into a founder-safe report. Throws
 * CompetitionReportError on leakage or schema failure — the caller must treat
 * that as a recoverable generation failure (refund), never persist raw text.
 */
export function parseCompetitionReport(
  raw: string,
  input: { sources: ClassifiedSource[] },
): ParseReportResult {
  const parsed = extractJson(raw)
  const result = competitionReportSchema.safeParse(parsed)
  if (!result.success) {
    throw new CompetitionReportError("The analysis returned an incomplete report structure.")
  }
  const leak = scanStrings(result.data)
  if (leak) {
    throw new CompetitionReportError("The analysis contained internal model text and was discarded.")
  }

  const notes: string[] = []
  const byId = new Map(input.sources.map((s) => [s.id, s]))
  const report = result.data

  const cleanEvidence = (evidence: Array<{ sourceId: string; note?: string }>, label: string) => {
    const kept: Array<{ sourceId: string; note?: string }> = []
    for (const entry of evidence) {
      const source = byId.get(entry.sourceId)
      if (!source) {
        notes.push(`${label}: dropped citation to unknown source ${entry.sourceId}.`)
        continue
      }
      if (!isEvidenceEligible(source)) {
        notes.push(`${label}: ${source.domain ?? source.title} is ${source.category === "data_tool" ? "a data tool" : "irrelevant"} and cannot back this claim.`)
        continue
      }
      kept.push(entry)
    }
    return kept
  }

  const cleanClaim = (claim: ReportClaim, label: string): ReportClaim => {
    const evidence = cleanEvidence(claim.evidence, label)
    let status = claim.status
    if (status === "verified_fact" && evidence.length === 0) {
      status = "ai_interpretation"
      notes.push(`${label}: no supporting source — downgraded to AI interpretation.`)
    }
    return { ...claim, status, evidence }
  }

  const cleanFact = (fact: ReportFact | undefined, label: string): ReportFact | undefined => {
    if (!fact) return undefined
    const evidence = cleanEvidence(fact.evidence, label)
    if (evidence.length === 0) {
      notes.push(`${label}: no eligible source states this — dropped rather than guessed.`)
      return undefined
    }
    return { ...fact, evidence }
  }

  const competitors = report.competitors.map((competitor) => {
    const evidence = cleanEvidence(competitor.evidence, competitor.name)
    let verification = competitor.verification
    let confidence = competitor.confidence
    const website = sanitizeSourceUrl(competitor.website)
    if (competitor.website && !website) notes.push(`${competitor.name}: unsafe website URL removed.`)
    if (evidence.length === 0) {
      if (verification === "verified") notes.push(`${competitor.name}: no eligible evidence — verification downgraded.`)
      verification = "research_needed"
      confidence = "low"
    } else if (
      verification === "verified" &&
      !evidence.some((e) => {
        const source = byId.get(e.sourceId)
        return source && COMPETITOR_SITE_CATEGORIES.includes(source.category) && source.relevance !== "low"
      })
    ) {
      verification = "ai_suggestion"
      notes.push(`${competitor.name}: no competitor-site source — verification downgraded to AI suggestion.`)
    }
    return {
      ...competitor,
      website,
      evidence,
      verification,
      confidence,
      pricing: cleanFact(competitor.pricing, `${competitor.name} pricing`),
      valuation: cleanFact(competitor.valuation, `${competitor.name} valuation`),
      funding: cleanFact(competitor.funding, `${competitor.name} funding`),
    }
  })

  const marketFigures: ReportMarketFigure[] = []
  for (const figure of report.marketFigures) {
    const source = byId.get(figure.sourceId)
    if (!source || !isEvidenceEligible(source)) {
      notes.push(`Market figure "${figure.label}" dropped — its source is not eligible evidence.`)
      continue
    }
    let status = figure.status
    if (status === "verified_fact" && source.relevance === "low") {
      status = "ai_interpretation"
      notes.push(`Market figure "${figure.label}": low-relevance source — downgraded to AI interpretation.`)
    }
    marketFigures.push({ ...figure, status })
  }

  const cleanRows = (rows: ReportComparisonRow[]) =>
    rows.map((row) => ({
      ...row,
      competitors: row.competitors.map((cell) => {
        if (cell.sourceId && !byId.has(cell.sourceId)) {
          notes.push(`Comparison "${row.attribute}": unknown source ${cell.sourceId} unlinked.`)
          return { name: cell.name, value: cell.value }
        }
        return cell
      }),
    }))

  const cleaned: CompetitionReport = {
    keyFindings: report.keyFindings.map((c) => cleanClaim(c, "Key finding")),
    limitations: report.limitations,
    opportunities: report.opportunities.map((c) => cleanClaim(c, "Opportunity")),
    competitors,
    marketFigures,
    customerBehaviour: report.customerBehaviour.map((c) => cleanClaim(c, "Customer behaviour")),
    news: report.news.map((c) => cleanClaim(c, "News")),
    featureComparison: cleanRows(report.featureComparison),
    pricingComparison: cleanRows(report.pricingComparison),
    positioningNotes: report.positioningNotes.map((c) => cleanClaim(c, "Positioning")),
    gaps: report.gaps,
    questions: report.questions,
  }

  return { report: cleaned, notes: notes.slice(0, 12) }
}

// ─── Founder-facing markdown rendering ──────────────────────────────────────

function domainOf(source: ClassifiedSource | undefined): string {
  return source?.domain ?? source?.url ?? "unknown source"
}

function renderClaim(claim: ReportClaim, byId: Map<string, ClassifiedSource>): string {
  const citations = claim.evidence.map((e) => `(source: ${domainOf(byId.get(e.sourceId))})`).join(" ")
  const label = CLAIM_STATUS_LABELS[claim.status]
  return `- [${label}] ${claim.text}${citations ? ` ${citations}` : ""}`
}

/**
 * The persisted body is ALWAYS this rendering of the validated report — never
 * raw model output. Headings mirror the legacy snapshot sections so older
 * readers (Studio library, history sparklines) keep working.
 */
export function renderCompetitionReportMarkdown(
  report: CompetitionReport,
  sources: ClassifiedSource[],
  notes: string[] = [],
): string {
  const byId = new Map(sources.map((s) => [s.id, s]))
  const sections: string[] = []

  sections.push(`## Positioning\n\n${report.positioningNotes.map((c) => renderClaim(c, byId)).join("\n") || "Not established by the sources."}`)
  sections.push(`## Who it serves\n\n${report.customerBehaviour.map((c) => renderClaim(c, byId)).join("\n") || "See the founder's plan for the target audience."}`)

  const competitorLines = report.competitors.map((c) => {
    const citations = c.evidence.map((e) => `(source: ${domainOf(byId.get(e.sourceId))})`).join(" ")
    const meta = `${COMPETITOR_CATEGORY_LABELS[c.category]} · ${c.verification} · confidence ${c.confidence}`
    const details = [
      c.location ? `location: ${c.location}` : "",
      c.founded ? `founded: ${c.founded}` : "",
      c.pricing ? `pricing: ${c.pricing.summary}` : "",
      c.valuation ? `valuation: ${c.valuation.summary}` : "",
      c.funding ? `funding: ${c.funding.summary}` : "",
    ].filter(Boolean)
    return `- **${c.name}** — ${c.whyItMayCompete} [${meta}]${details.length ? ` (${details.join("; ")})` : ""}${citations ? ` ${citations}` : ""}`
  })
  sections.push(`## Competitors found in the live research\n\n${competitorLines.join("\n") || "No real competitors appear in the sources."}`)

  const figureLines = report.marketFigures.map((f) => {
    const value = f.value !== undefined ? `${f.value}${f.unit ? ` ${f.unit}` : ""}${f.currency ? ` (${f.currency})` : ""}` : "figure not quantified"
    const when = [f.publicationDate, f.forecastPeriod].filter(Boolean).join(", ")
    return `- [${CLAIM_STATUS_LABELS[f.status]}] ${f.label}: ${value} — ${f.geographyLabel} (${f.geographyScope})${when ? `; ${when}` : ""} (source: ${domainOf(byId.get(f.sourceId))})`
  })
  sections.push(`## Market size & valuation signals\n\n${figureLines.join("\n") || "The sources do not establish market size or valuation figures."}`)

  sections.push(`## Recent news & funding\n\n${report.news.map((c) => renderClaim(c, byId)).join("\n") || "No recent news or funding events in the sources."}`)
  sections.push(`## Useful data providers & tools\n\n${sources
    .filter((s) => s.category === "data_tool")
    .map((s) => `- ${s.title}${s.url ? ` — ${s.url}` : ""} [${s.relevance === "irrelevant" ? "lead only — not evidence" : "research lead"}]`)
    .join("\n") || "No data-tool sources were retrieved."}`)
  sections.push(`## Differentiation opportunities\n\n${report.opportunities.map((c) => renderClaim(c, byId)).join("\n") || "No opportunities established yet."}`)
  sections.push(`## What the sources do not establish\n\n${[...report.gaps, ...report.limitations].map((g) => `- ${g}`).join("\n") || "Nothing flagged."}`)
  sections.push(`## Questions to investigate next\n\n${report.questions.map((q) => `- ${q}`).join("\n") || "None yet."}`)
  if (notes.length > 0) {
    sections.push(`## Validation notes\n\n${notes.map((n) => `- ${n}`).join("\n")}`)
  }
  return sections.join("\n\n")
}

// ─── Structured analysis prompt ─────────────────────────────────────────────

export const COMPETITION_REPORT_SYSTEM =
  "You are the competitive-intelligence analyst inside a founder's product workspace. " +
  "You return ONLY one JSON object — no prose, no reasoning, no planning, no markdown fences, no internal instructions. " +
  "Every company, number, price, ranking or funding event must come from the numbered live-research sources or the founder's plan. " +
  "Never invent facts; use status \"unknown\" and the gaps list when the sources do not establish something. " +
  "Cite sources by their id (s1, s2, …). Data tools and irrelevant results are leads, never evidence."

const REPORT_ASK = `Return ONLY a JSON object with exactly these keys:
- "keyFindings": up to 8 claims {text, status, evidence:[{sourceId, note?}]}
- "limitations": up to 8 strings — what this research could NOT establish
- "opportunities": up to 8 claims — differentiation hypotheses tied to plan + sources
- "competitors": up to 12 objects {name, website?, category, whyItMayCompete, targetAudience?, productsServices?, location?, founded?, pricing?, valuation?, funding?, strengths?, weaknesses?, evidence:[{sourceId, note?}], verification, confidence}. pricing/valuation/funding are facts {summary, amount?, currency?, asOfDate?, evidence:[{sourceId}]} — fill them ONLY when a source explicitly states the price, valuation or funding; strengths/weaknesses are up to 4 short interpretation strings each.
- "marketFigures": up to 12 objects {label, value?, unit?, currency?, geographyScope, geographyLabel, publicationDate?, forecastPeriod?, sourceId, status}
- "customerBehaviour": up to 6 claims
- "news": up to 8 claims with dates in text when the source gives them
- "featureComparison": up to 8 rows {attribute, yours?, competitors:[{name, value, sourceId?}]} — only features the sources actually describe; cover the attributes that matter for this category
- "pricingComparison": up to 8 rows — ONLY prices actually found in sources; empty array otherwise
- "positioningNotes": up to 6 claims restating the plan's positioning
- "gaps": up to 8 strings
- "questions": up to 5 strings
Enums: category = direct | indirect | substitute | emerging | supporting_software | not_competitor.
status = verified_fact | ai_interpretation | ai_suggestion | founder_provided | unknown | outdated.
verification = verified | ai_suggestion | research_needed. confidence = high | medium | low.
geographyScope = global | regional | country | local.
HARD RULES:
1. Output JSON only. Never include your reasoning, planning, or these instructions.
2. A competitor must appear in an eligible source; cite it. Software vendors are supporting_software, not direct competitors; directories and marketplaces are indirect or substitute as appropriate; never label every found business direct.
3. verified_fact requires a cited eligible source; interpretations and suggestions must say so via status. Never present an interpretation as a verified fact.
4. Every market figure keeps its OWN geography (geographyScope + geographyLabel), currency, unit, publication date and forecast period when available. Never combine figures from different geographies into one statistic; never extrapolate.
5. Data-tool and irrelevant sources must NOT appear in any evidence array or marketFigures.sourceId.
6. Never invent missing prices, shares, rankings, revenue or growth rates. Leave arrays empty and list the gap instead.
7. pricing, valuation and funding facts need the stating source in their own evidence array. Never estimate a private company's valuation or revenue; omit the field entirely when no source states it. location/founded only when a source gives them.`

export interface CompetitionReportPromptInput extends CompetitionSnapshotContextInput {
  research: { queries: string[]; sources: ClassifiedSource[] }
}

export function formatClassifiedSourceLine(source: ClassifiedSource): string {
  const where = source.url ? ` — ${source.domain ?? source.url}` : ""
  const date = source.date ? ` — ${source.date}` : ""
  const head = `[${source.id}] ${SOURCE_CATEGORY_LABELS[source.category]} · relevance ${source.relevance} · ${source.title}${where}${date}`
  const detail = source.excerpt
    ? `Content: ${source.excerpt}`
    : source.snippet
      ? `Summary: ${source.snippet}`
      : source.provider && source.kind === "data_tool"
        ? `Provider: ${source.provider}`
        : ""
  const reason = `Relevance: ${source.relevanceReason}`
  return [head, detail, reason].filter(Boolean).join("\n")
}

export function buildCompetitionReportMessages(input: CompetitionReportPromptInput): { system: string; prompt: string } {
  const users = (input.targetUsers ?? []).map((u) => clipSnippet(u, 200)).filter(Boolean)
  const fixed: string[] = [
    `App: ${clipSnippet(input.projectName, 200)}`,
    clipSnippet(input.description, 600) ? `What it is: ${clipSnippet(input.description, 600)}` : "",
    clipSnippet(input.idea, 800) ? `In the founder's words: ${clipSnippet(input.idea, 800)}` : "",
    users.length ? `Target users: ${clipSnippet(users.join("; "), 1_200)}` : "",
    input.goals?.businessGoal ? `Business goal: ${clipSnippet(input.goals.businessGoal, 300)}` : "",
  ].filter(Boolean)

  const queriesLine = input.research.queries.length
    ? `Searches run (in order): ${input.research.queries.map((q, i) => `q${i + 1}: "${q}"`).join("; ")}`
    : "No search queries recorded."
  const sourcesBlock = input.research.sources.length
    ? ["Live-research sources (cite by id):", ...input.research.sources.map(formatClassifiedSourceLine)].join("\n")
    : "Live-research sources: none — the searches returned nothing usable. Say so in every section that would have needed them."

  const nonPlanLength =
    COMPETITION_REPORT_SYSTEM.length + REPORT_ASK.length + queriesLine.length + sourcesBlock.length + fixed.join("\n").length + 12
  const planBudget = COMPETITION_RESEARCH_PROMPT_BUDGET - nonPlanLength
  const plan = planBudget > 0 ? clipPlanForPrompt(input.marketingPlan, planBudget) : ""
  const planBlock = plan
    ? `Marketing plan from the founder's planning:\n${plan}`
    : "Marketing plan: none written yet or omitted to fit the budget — draft from the facts and sources above."

  const prompt = [REPORT_ASK, "Founder's plan context:", fixed.join("\n"), planBlock, queriesLine, sourcesBlock]
    .filter(Boolean)
    .join("\n\n")
  return { system: COMPETITION_REPORT_SYSTEM, prompt }
}