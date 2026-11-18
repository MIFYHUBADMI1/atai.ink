import type { TourProgress } from "./types"

/**
 * Progress records cross a trust boundary (browser storage, then the API), so
 * nothing is coerced into a plausible-looking zero — anything unusable is
 * dropped. Shared by the client mirror and the server route so both agree on
 * what a valid record is.
 */

const STATUSES = new Set(["in-progress", "completed", "dismissed"])
const MAX_TOURS = 200
const MAX_SKIPPED = 200

export function sanitizeProgress(value: unknown): Record<string, TourProgress> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: Record<string, TourProgress> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_TOURS) break
    if (!raw || typeof raw !== "object") continue
    const entry = raw as Record<string, unknown>
    const status = typeof entry.status === "string" && STATUSES.has(entry.status) ? entry.status : null
    const step =
      typeof entry.step === "number" && Number.isFinite(entry.step)
        ? Math.min(Math.max(0, Math.trunc(entry.step)), 200)
        : null
    const updatedAt = typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0
    if (!status || step === null) continue
    const skipped = Array.isArray(entry.skipped)
      ? entry.skipped.filter((s): s is string => typeof s === "string" && s.length <= 64).slice(0, MAX_SKIPPED)
      : undefined
    out[key.slice(0, 64)] = {
      step,
      status: status as TourProgress["status"],
      updatedAt,
      skipped,
      paused: entry.paused === true ? true : undefined,
    }
  }
  return out
}

/** Merge two progress maps, newest entry per tour wins. */
export function mergeProgress(
  server: Record<string, TourProgress>,
  local: Record<string, TourProgress> | null,
): Record<string, TourProgress> {
  if (!local) return server
  const out: Record<string, TourProgress> = { ...server }
  for (const [key, entry] of Object.entries(local)) {
    const existing = out[key]
    if (!existing || entry.updatedAt > existing.updatedAt) out[key] = entry
  }
  return out
}
