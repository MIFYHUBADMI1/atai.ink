/**
 * The single rule that decides whether an existing business has anything to
 * read. Shared by the intake wizard and the server so a founder cannot be told
 * one thing in the form and get another from the API.
 */

export interface IntakeSourceInput {
  websiteUrl?: string | null
  githubOwner?: string | null
  githubRepo?: string | null
}

export const INTAKE_SOURCE_ERROR =
  "Atai needs one real thing to read before it can assess a business: a website address or a repository. Your description alone is not enough."

/**
 * A usable website source, or null. Only a resolvable http(s) hostname counts:
 * `new URL` rejects the shapes that would fail the crawl anyway, so the founder
 * hears it here instead of after a submit.
 */
export function parseIntakeWebsite(raw?: string | null): { url: string; hostname: string } | null {
  const trimmed = (raw ?? "").trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  const hostname = parsed.hostname.toLowerCase()
  if (!hostname.includes(".") || hostname.startsWith(".") || hostname.endsWith(".")) return null
  return { url: parsed.toString(), hostname }
}

export function hasIntakeSource(input: IntakeSourceInput): boolean {
  const owner = (input.githubOwner ?? "").trim()
  const repo = (input.githubRepo ?? "").trim()
  return Boolean(parseIntakeWebsite(input.websiteUrl)) || Boolean(owner && repo)
}
