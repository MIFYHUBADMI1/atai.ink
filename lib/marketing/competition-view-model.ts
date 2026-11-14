/**
 * Competition dashboard view-model — pure, side-effect-free derivation of
 * dashboard data from the persisted snapshot markdown and its live-research
 * sources. Every number the dashboard shows is computed from real persisted
 * evidence (source mentions, draft counts); nothing is invented. Estimates
 * are labelled as estimates at the render site.
 */

import type {
  CompetitionReport,
  CompetitorCategory,
  ReportMarketFigure,
} from "./competition-report"
import { COMPETITOR_CATEGORY_LABELS, SOURCE_CATEGORY_LABELS } from "./competition-report"
import type { MarketSourceCategory } from "@/lib/types/db"

export interface CompetitionSourceView {
  kind: "web" | "news" | "research" | "data_tool"
  title: string
  url?: string
  domain?: string
  snippet?: string
  excerpt?: string
  date?: string
  provider?: string
  queryIndex?: number
  category?: MarketSourceCategory
  relevance?: "high" | "medium" | "low" | "irrelevant"
  relevanceReason?: string
}

export interface CompetitionResearchView {
  queries: string[]
  collectedAt: number
  sources: CompetitionSourceView[]
  researchCreditsCharged: number
}

export interface CompetitionSnapshotItem {
  id: string
  title: string
  body: string
  creditsCharged: number
  createdAt: number
  contextHash?: string
  /** Live-research evidence (absent on pre-research drafts — those are plan-only). */
  research?: CompetitionResearchView
  /** Validated structured report (absent on legacy markdown-only snapshots). */
  competitionReport?: CompetitionReport
}

export interface ParsedCompetitor {
  name: string
  detail: string
  citations: string[]
}

export interface CompetitionBodyParse {
  positioning: string | null
  audience: string | null
  competitors: ParsedCompetitor[]
  market: string | null
  news: string | null
  tools: string | null
  opportunities: string[]
  gaps: string[]
  questions: string[]
}

type SectionKey =
  | "positioning"
  | "audience"
  | "competitors"
  | "market"
  | "news"
  | "tools"
  | "opportunities"
  | "gaps"
  | "questions"

function classifyHeading(raw: string): SectionKey | null {
  const text = raw
    .toLowerCase()
    .replace(/[*_`#]/g, "")
    .replace(/^\s*\d+[.)\]:-]?\s*/, "")
    .trim()
  if (/competitor/.test(text)) return "competitors"
  if (/opportunit|differentiation/.test(text)) return "opportunities"
  if (/not establish|cannot confirm|can't confirm|gaps|unconfirmed/.test(text)) return "gaps"
  if (/question|investigate/.test(text)) return "questions"
  if (/market|valuation/.test(text)) return "market"
  if (/news|funding/.test(text)) return "news"
  if (/data provider|tools/.test(text)) return "tools"
  if (/who it serves|audience|who you/.test(text)) return "audience"
  if (/positioning/.test(text)) return "positioning"
  return null
}

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/

function listItems(section: string): string[] {
  const items: string[] = []
  for (const line of section.split("\n")) {
    const match = LIST_ITEM.exec(line)
    if (match) items.push(match[1].trim())
  }
  if (items.length > 0) return items
  return section
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0)
}

function cleanName(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function parseCompetitorItem(item: string): ParsedCompetitor | null {
  const citations = [...item.matchAll(/\(source:\s*([^)]+)\)/gi)].map((m) => m[1].trim())
  const bold = /^\*\*([^*]+)\*\*/.exec(item)
  let name: string
  if (bold) {
    name = cleanName(bold[1])
  } else {
    const split = /^(.{3,80}?)(?:\s+[—–-]\s+|:\s+)/.exec(item)
    name = cleanName(split ? split[1] : item.slice(0, 60))
  }
  if (!name || name.length < 2) return null
  return { name, detail: item, citations }
}

/** Split the grounded snapshot body into its nine prompted sections. */
export function parseCompetitionBody(body: string): CompetitionBodyParse {
  const result: CompetitionBodyParse = {
    positioning: null,
    audience: null,
    competitors: [],
    market: null,
    news: null,
    tools: null,
    opportunities: [],
    gaps: [],
    questions: [],
  }
  const sections = new Map<SectionKey, string[]>()
  let current: SectionKey | null = null
  for (const line of body.split("\n")) {
    const heading = /^\s{0,3}#{1,6}\s+(.+)$/.exec(line)
    if (heading) {
      current = classifyHeading(heading[1])
      if (current && !sections.has(current)) sections.set(current, [])
      continue
    }
    if (current) sections.get(current)?.push(line)
  }
  const text = (key: SectionKey) => {
    const lines = sections.get(key)
    if (!lines) return null
    const joined = lines.join("\n").trim()
    return joined.length > 0 ? joined : null
  }
  result.positioning = text("positioning")
  result.audience = text("audience")
  result.market = text("market")
  result.news = text("news")
  result.tools = text("tools")
  const competitorsSection = text("competitors")
  if (competitorsSection && !/no (real |named )?competitors (appear|were found|found|identified)/i.test(competitorsSection)) {
    result.competitors = listItems(competitorsSection)
      .map(parseCompetitorItem)
      .filter((c): c is ParsedCompetitor => c !== null)
  }
  result.opportunities = listItems(text("opportunities") ?? "")
  result.gaps = listItems(text("gaps") ?? "")
  result.questions = listItems(text("questions") ?? "")
  return result
}

export function sourceHaystack(source: CompetitionSourceView): string {
  return [source.title, source.snippet, source.excerpt].filter(Boolean).join(" ").toLowerCase()
}

export function countMentions(name: string, sources: CompetitionSourceView[]): number {
  const needle = name.toLowerCase()
  if (needle.length < 3) return 0
  return sources.filter((s) => sourceHaystack(s).includes(needle)).length
}

export interface LandscapeSlice {
  name: string
  mentions: number
  /** 0..100, rounded; shares are recomputed to sum to 100 at render. */
  share: number
}

export interface LandscapeModel {
  slices: LandscapeSlice[]
  totalMentions: number
  unattributedSources: number
}

/**
 * Estimated landscape: each named competitor's share of live-source mentions,
 * plus an "Others" bucket for remaining mentions and sources that name no
 * tracked competitor. This is mention presence, NOT verified market share —
 * the UI must keep saying so.
 */
export function buildLandscapeModel(
  competitors: ParsedCompetitor[],
  sources: CompetitionSourceView[],
): LandscapeModel {
  const named = competitors
    .map((c) => ({ name: c.name, mentions: countMentions(c.name, sources) }))
    .sort((a, b) => b.mentions - a.mentions)
  const unattributedSources = sources.filter(
    (s) => !named.some((n) => n.mentions > 0 && sourceHaystack(s).includes(n.name.toLowerCase())),
  ).length
  const totalMentions = named.reduce((sum, n) => sum + n.mentions, 0) + unattributedSources
  const top = named.slice(0, 5)
  const restMentions = named.slice(5).reduce((sum, n) => sum + n.mentions, 0)
  const slices: LandscapeSlice[] = top.map((n) => ({
    ...n,
    share: totalMentions > 0 ? Math.round((n.mentions / totalMentions) * 100) : 0,
  }))
  const othersMentions = restMentions + unattributedSources
  if (othersMentions > 0 || slices.length === 0) {
    slices.push({
      name: "Others",
      mentions: othersMentions,
      share: totalMentions > 0 ? Math.round((othersMentions / totalMentions) * 100) : 0,
    })
  }
  return { slices, totalMentions, unattributedSources }
}

export interface GrowthSignal {
  percent: number
  direction: "up" | "down"
  context: string
}

/** First source-reported growth/decline percentage in the market section, if any. */
export function extractGrowthSignal(marketText: string | null): GrowthSignal | null {
  if (!marketText) return null
  const regex = /([+-]?\d+(?:\.\d+)?)\s*%/g
  for (const match of marketText.matchAll(regex)) {
    const start = Math.max(0, (match.index ?? 0) - 80)
    const window = marketText.slice(start, (match.index ?? 0) + match[0].length + 80)
    if (!/grow|growth|cagr|expand|increas|rising|declin|shrink|contract|drop|decreas/i.test(window)) continue
    const percent = Number(match[1])
    if (!Number.isFinite(percent)) continue
    const down = percent < 0 || /declin|shrink|contract|drop|decreas/i.test(window)
    return { percent: Math.abs(percent), direction: down ? "down" : "up", context: window.replace(/\s+/g, " ").trim() }
  }
  return null
}

export interface ScanPoint {
  id: string
  day: string
  competitors: number
  sources: number
}

/** Oldest-first series across drafts for the stat-card sparklines. */
export function buildScanSeries(snapshotsNewestFirst: CompetitionSnapshotItem[]): ScanPoint[] {
  return [...snapshotsNewestFirst]
    .reverse()
    .map((s) => ({
      id: s.id,
      day: formatDay(s.createdAt),
      competitors: parseCompetitionBody(s.body).competitors.length,
      sources: s.research?.sources.length ?? 0,
    }))
}

export function competitivenessLabel(count: number): { label: string; sub: string } {
  if (count <= 0) return { label: "No Signal Yet", sub: "Run live research to map the field" }
  if (count <= 2) return { label: "Lightly Competitive", sub: `${count} competitor${count === 1 ? "" : "s"} found in live sources` }
  if (count <= 5) return { label: "Moderately Competitive", sub: `${count} competitors found in live sources` }
  return { label: "Crowded Market", sub: `${count} competitors found in live sources` }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Deterministic UTC day — safe to render on server and client alike. */
export function formatDay(ms: number): string {
  return Number.isFinite(ms) && ms > 0 && ms <= 8.64e15 ? new Date(ms).toISOString().slice(0, 10) : "date unknown"
}

/** Deterministic UTC stamp, e.g. "Nov 10, 2026 • 2:45 PM UTC". */
export function formatStamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0 || ms > 8.64e15) return "date unknown"
  const d = new Date(ms)
  const hours = d.getUTCHours()
  const h12 = hours % 12 === 0 ? 12 : hours % 12
  const minutes = String(d.getUTCMinutes()).padStart(2, "0")
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} • ${h12}:${minutes} ${hours < 12 ? "AM" : "PM"} UTC`
}

// ─── Structured-report derivations (real counts only, never estimates) ──────

export interface CountSlice {
  key: string
  label: string
  count: number
}

/** Competitor category distribution — counts of classified competitors. */
export function reportCategoryDistribution(report: CompetitionReport): CountSlice[] {
  const counts = new Map<CompetitorCategory, number>()
  for (const competitor of report.competitors) {
    counts.set(competitor.category, (counts.get(competitor.category) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: COMPETITOR_CATEGORY_LABELS[key], count }))
    .sort((a, b) => b.count - a.count)
}

/** Source distribution by relevance category (kind fallback for legacy runs). */
export function sourceCategoryDistribution(sources: CompetitionSourceView[]): CountSlice[] {
  const counts = new Map<string, number>()
  for (const source of sources) {
    const key = source.category ?? source.kind
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: key in SOURCE_CATEGORY_LABELS ? SOURCE_CATEGORY_LABELS[key as MarketSourceCategory] : key,
      count,
    }))
    .sort((a, b) => b.count - a.count)
}

export interface ReportGrowthSignal {
  percent: number
  direction: "up" | "down"
  label: string
  geographyLabel: string
  geographyScope: ReportMarketFigure["geographyScope"]
  sourceId: string
  status: ReportMarketFigure["status"]
}

/**
 * Growth signal from a structured market figure that actually carries a %
 * value — with its geography attached. Never blends geographies: the caller
 * renders the figure's own scope label next to the number.
 */
export function growthFromFigures(report: CompetitionReport): ReportGrowthSignal | null {
  for (const figure of report.marketFigures) {
    if (figure.value === undefined || !figure.unit || !figure.unit.includes("%")) continue
    return {
      percent: Math.abs(figure.value),
      direction: figure.value < 0 ? "down" : "up",
      label: figure.label,
      geographyLabel: figure.geographyLabel,
      geographyScope: figure.geographyScope,
      sourceId: figure.sourceId,
      status: figure.status,
    }
  }
  return null
}

export interface GeographyGroup {
  scope: ReportMarketFigure["geographyScope"]
  label: string
  figures: ReportMarketFigure[]
}

/** Market figures grouped by geography — figures from different geographies never share a group. */
export function groupFiguresByGeography(report: CompetitionReport): GeographyGroup[] {
  const groups = new Map<string, GeographyGroup>()
  for (const figure of report.marketFigures) {
    const key = `${figure.geographyScope}:${figure.geographyLabel.toLowerCase()}`
    const group = groups.get(key) ?? { scope: figure.geographyScope, label: figure.geographyLabel, figures: [] }
    group.figures.push(figure)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** Claim texts citing a given source — the "claims supported" column of the evidence ledger. */
export function claimsCitingSource(report: CompetitionReport, sourceId: string): string[] {
  const claims = [
    ...report.keyFindings,
    ...report.opportunities,
    ...report.customerBehaviour,
    ...report.news,
    ...report.positioningNotes,
  ]
  const texts = claims.filter((c) => c.evidence.some((e) => e.sourceId === sourceId)).map((c) => c.text)
  for (const competitor of report.competitors) {
    if (competitor.evidence.some((e) => e.sourceId === sourceId)) texts.push(competitor.name)
    for (const [label, fact] of [
      ["pricing", competitor.pricing],
      ["valuation", competitor.valuation],
      ["funding", competitor.funding],
    ] as const) {
      if (fact?.evidence.some((e) => e.sourceId === sourceId)) texts.push(`${competitor.name} ${label}`)
    }
  }
  for (const figure of report.marketFigures) {
    if (figure.sourceId === sourceId) texts.push(figure.label)
  }
  return texts
}

export interface CompetitorStats {
  /** All classified entries, including "not a competitor" determinations. */
  total: number
  /** Entries that actually compete (excludes not_competitor). */
  active: number
  verified: number
  aiSuggested: number
  researchNeeded: number
  withWebsite: number
  withPricing: number
  withValuation: number
  withFunding: number
  /** Distinct sources cited across competitor entries and their money facts. */
  citedSources: number
  verificationDistribution: CountSlice[]
}

/** Real counts over the validated report — nothing estimated. */
export function competitorStats(report: CompetitionReport): CompetitorStats {
  const cited = new Set<string>()
  let verified = 0
  let aiSuggested = 0
  let researchNeeded = 0
  let withWebsite = 0
  let withPricing = 0
  let withValuation = 0
  let withFunding = 0
  for (const competitor of report.competitors) {
    if (competitor.verification === "verified") verified += 1
    else if (competitor.verification === "ai_suggestion") aiSuggested += 1
    else researchNeeded += 1
    if (competitor.website) withWebsite += 1
    if (competitor.pricing) withPricing += 1
    if (competitor.valuation) withValuation += 1
    if (competitor.funding) withFunding += 1
    for (const entry of competitor.evidence) cited.add(entry.sourceId)
    for (const fact of [competitor.pricing, competitor.valuation, competitor.funding]) {
      for (const entry of fact?.evidence ?? []) cited.add(entry.sourceId)
    }
  }
  return {
    total: report.competitors.length,
    active: report.competitors.filter((c) => c.category !== "not_competitor").length,
    verified,
    aiSuggested,
    researchNeeded,
    withWebsite,
    withPricing,
    withValuation,
    withFunding,
    citedSources: cited.size,
    verificationDistribution: [
      { key: "verified", label: "Verified", count: verified },
      { key: "ai_suggestion", label: "AI suggestion", count: aiSuggested },
      { key: "research_needed", label: "Research needed", count: researchNeeded },
    ],
  }
}

const RELEVANCE_LABELS: Record<string, string> = {
  high: "High relevance",
  medium: "Medium relevance",
  low: "Low relevance",
  irrelevant: "Irrelevant (lead only)",
}

/** Source counts by relevance — real counts for the Sources tab chart. */
export function sourceRelevanceDistribution(sources: CompetitionSourceView[]): CountSlice[] {
  const counts = new Map<string, number>()
  for (const source of sources) {
    const key = source.relevance ?? "unclassified"
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: RELEVANCE_LABELS[key] ?? key, count }))
    .sort((a, b) => b.count - a.count)
}

/** Actual cost of one run: metered AI analysis + the fixed live-search charge. */
export function totalRunCost(item: CompetitionSnapshotItem): number {
  return item.creditsCharged + (item.research?.researchCreditsCharged ?? 0)
}