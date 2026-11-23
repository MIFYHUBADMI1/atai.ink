/**
 * Canonical application path identity.
 *
 * An application is identified by (businessId, hostname, basePath). Two inputs
 * that reach the same resource on the origin must produce the same basePath, or
 * they become two records that quietly describe one thing.
 *
 * Rules:
 *  - "" and "/" are the origin root, stored as "".
 *  - Trailing and duplicate slashes are removed: "/shop/" and "//shop//" are "/shop".
 *  - A missing leading slash is added: "shop" is "/shop".
 *  - Percent-encoding is normalised by decoding each segment once and
 *    re-encoding it, so "/%73hop" and "/shop" are the same path. A segment whose
 *    decoded form contains "/", "\\", "?" or "#" is rejected rather than guessed
 *    at, because it has more than one reasonable meaning.
 *  - "." and ".." are rejected, never resolved: resolving would silently change
 *    which application the founder meant.
 *  - Case is preserved. HTTP paths are case-sensitive; folding case would merge
 *    paths a case-sensitive origin serves separately. A case-insensitive origin
 *    is still one trust domain, so nothing security-relevant depends on this.
 *
 * @module lib/business/paths
 */

export const MAX_BASE_PATH_LENGTH = 200

export class PathInputError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "PathInputError"
    this.code = code
  }
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export function canonicalBasePath(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return ""
  const value = String(raw).trim()
  if (!value) return ""
  if (CONTROL_CHARS.test(value)) {
    throw new PathInputError("PATH_CONTROL", "That path contains characters we can't use.")
  }
  if (value.includes("?") || value.includes("#")) {
    throw new PathInputError("PATH_QUERY", "Use the path only — no query string or fragment.")
  }
  if (value.includes("\\")) {
    throw new PathInputError("PATH_BACKSLASH", "Use forward slashes in the path.")
  }

  const canonical: string[] = []
  for (const segment of value.split("/")) {
    if (!segment) continue
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw new PathInputError("PATH_ENCODING", "That path isn't validly encoded.")
    }
    if (decoded === "." || decoded === "..") {
      throw new PathInputError("PATH_DOT_SEGMENT", "Paths can't contain '.' or '..' segments.")
    }
    if (/[/\\?#]/.test(decoded) || CONTROL_CHARS.test(decoded)) {
      throw new PathInputError("PATH_AMBIGUOUS", "That path means more than one thing once decoded.")
    }
    canonical.push(encodeURIComponent(decoded))
  }

  const path = canonical.length ? `/${canonical.join("/")}` : ""
  if (path.length > MAX_BASE_PATH_LENGTH) {
    throw new PathInputError("PATH_TOO_LONG", `Keep the path under ${MAX_BASE_PATH_LENGTH} characters.`)
  }
  return path
}

/** Display/log form of an application's address. Never used as a uniqueness key. */
export function applicationOrigin(input: { hostname: string; basePath: string }): string {
  return `${input.hostname}${input.basePath}`
}
