import { z } from "zod"

export interface CompetitorProfile {
  name: string
  url?: string
  tagline?: string
  founded?: string
  pricing?: string
  businessModel?: string
  strengths?: string[]
  weaknesses?: string[]
  targetCustomer?: string
  competitiveEdge?: string
  fundingStatus?: string
}

const MAX = {
  name: 120,
  url: 300,
  tagline: 240,
  founded: 40,
  pricing: 120,
  businessModel: 300,
  strengths: 6,
  strengthItem: 200,
  weaknesses: 6,
  weaknessItem: 200,
  targetCustomer: 240,
  competitiveEdge: 400,
  fundingStatus: 60,
} as const

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const cleaned = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim()
  return cleaned || undefined
}

function cleanStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map(cleanString).filter((item): item is string => Boolean(item))
  return items.length > 0 ? items : undefined
}

export function sanitizeCompetitorUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX.url || /[\u0000-\u0020\u007f\\]/.test(value)) return undefined
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
    if (parsed.username || parsed.password || (parsed.port && !["80", "443"].includes(parsed.port))) return undefined
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "")
    if (!host.includes(".") || /[\[\]:]/.test(host) || /^\d+(\.\d+)*$/.test(host)) return undefined
    if (/(^|\.)(localhost|local|internal|lan|invalid|test)$/.test(host)) return undefined
    parsed.hostname = host
    return parsed.toString()
  } catch {
    return undefined
  }
}

/** Collapse a name for duplicate detection (case + spacing insensitive). */
function dedupeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

export interface NormalizedCompetitors {
  competitors: CompetitorProfile[]
  /** Entries that were present but unusable (no name, junk shape, …). */
  dropped: number
  /** Same-company entries removed by duplicate detection. */
  duplicates: number
}

// Length limits apply to new model output, not previously stored text.
export function normalizeCompetitors(raw: unknown): NormalizedCompetitors {
  if (!Array.isArray(raw)) return { competitors: [], dropped: 0, duplicates: 0 }

  const competitors: CompetitorProfile[] = []
  const seen = new Set<string>()
  const domains = new Set<string>()
  let dropped = 0
  let duplicates = 0

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      dropped += 1
      continue
    }
    const record = entry as Record<string, unknown>
    const name = cleanString(record.name)
    if (!name) {
      dropped += 1
      continue
    }
    const key = dedupeName(name)
    const url = sanitizeCompetitorUrl(record.url)
    const domain = url ? new URL(url).hostname.replace(/^www\./, "") : undefined
    if (seen.has(key) || (domain && domains.has(domain))) {
      duplicates += 1
      continue
    }
    seen.add(key)
    if (domain) domains.add(domain)

    const profile: CompetitorProfile = { name }
    if (url) profile.url = url
    const optional: [Exclude<keyof CompetitorProfile, "strengths" | "weaknesses">, unknown][] = [
      ["tagline", record.tagline],
      ["founded", record.founded],
      ["pricing", record.pricing],
      ["businessModel", record.businessModel],
      ["targetCustomer", record.targetCustomer],
      ["competitiveEdge", record.competitiveEdge],
      ["fundingStatus", record.fundingStatus],
    ]
    for (const [field, value] of optional) {
      const cleaned = cleanString(value)
      if (cleaned) profile[field] = cleaned
    }
    const strengths = cleanStringList(record.strengths)
    if (strengths) profile.strengths = strengths
    const weaknesses = cleanStringList(record.weaknesses)
    if (weaknesses) profile.weaknesses = weaknesses

    competitors.push(profile)
  }

  return { competitors, dropped, duplicates }
}

const optionalText = (max: number) => z.string().trim().max(max).nullish()
const modelCompetitor = z.object({
  name: z.string().trim().min(1).max(MAX.name),
  url: z.string().refine((value) => !value || Boolean(sanitizeCompetitorUrl(value)), "Invalid competitor URL").nullish(),
  tagline: optionalText(MAX.tagline),
  founded: optionalText(MAX.founded),
  pricing: optionalText(MAX.pricing),
  businessModel: optionalText(MAX.businessModel),
  strengths: z.array(z.string().trim().min(1).max(MAX.strengthItem)).max(MAX.strengths).nullish(),
  weaknesses: z.array(z.string().trim().min(1).max(MAX.weaknessItem)).max(MAX.weaknesses).nullish(),
  targetCustomer: optionalText(MAX.targetCustomer),
  competitiveEdge: optionalText(MAX.competitiveEdge),
  fundingStatus: optionalText(MAX.fundingStatus),
}).strict()

export function parseCompetitorOutput(text: string): NormalizedCompetitors {
  if (text.length > 40_000) throw new Error("Competitor response exceeds the supported size")
  const raw = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1")
  const validated = z.array(modelCompetitor).min(1).max(12).parse(JSON.parse(raw))
  return normalizeCompetitors(validated)
}

export interface CachedCompetitors {
  data: CompetitorProfile[]
  generatedAt: number
  /** Ledger intent identity that produced this entry (idempotent recovery). */
  intentKey?: string
}

export interface ReplayResult {
  competitors: CompetitorProfile[]
  generatedAt: number
}

export interface ResourceCompetitorIntelligence {
  sourceSection: "resources"
  status: "ai_suggestion"
  verificationStatus: "unverified"
  generatedAt: number | null
  competitors: CompetitorProfile[]
  omittedEntries: number
}

export function readResourcesCompetitors(cache: unknown): ResourceCompetitorIntelligence {
  const entry = cache && typeof cache === "object" && !Array.isArray(cache)
    ? (cache as Record<string, unknown>).competitors : undefined
  const record = entry && typeof entry === "object" && !Array.isArray(entry)
    ? entry as Record<string, unknown> : {}
  const normalized = normalizeCompetitors(record.data)
  return {
    sourceSection: "resources", status: "ai_suggestion", verificationStatus: "unverified",
    generatedAt: typeof record.generatedAt === "number" && Number.isFinite(record.generatedAt) && record.generatedAt > 0 && record.generatedAt <= 8.64e15
      ? record.generatedAt : null,
    competitors: normalized.competitors,
    omittedEntries: normalized.dropped + normalized.duplicates,
  }
}

/**
 * Recover the result of a PREVIOUS successful generation under the same
 * ledger intent — the "response was lost but the charge and data landed"
 * path. Legacy cache entries (no intentKey) and unknown intents return null:
 * recovery never guesses.
 */
export function replayCompetitors(
  cache: unknown,
  intentKey: string | undefined,
): ReplayResult | null {
  if (!intentKey) return null
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return null
  const entry = (cache as Record<string, unknown>).competitors
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
  const record = entry as Record<string, unknown>
  if (record.intentKey !== intentKey) return null
  const generatedAt = typeof record.generatedAt === "number" ? record.generatedAt : 0
  const { competitors } = normalizeCompetitors(record.data)
  if (competitors.length === 0) return null
  return { competitors, generatedAt }
}
