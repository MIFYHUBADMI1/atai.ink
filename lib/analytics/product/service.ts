import "server-only"

import { analyticsEventsCol } from "@/lib/db/collections"
import type { AnalyticsEventDoc } from "@/lib/types/db"
import { summariseProduct, type ProductSummary } from "./summary"

/**
 * Read a project's product analytics for a window.
 *
 * The read is capped and newest-first: a project with a million events in the
 * window must not turn a page render into an unbounded scan. When the cap is
 * hit the summary says `sampled: true`, so the founder is told the number is a
 * floor rather than being shown a precise-looking lie.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_EVENTS = 20_000
const DEFAULT_WINDOW_DAYS = 30

const PROJECTION = {
  _id: 0,
  kind: 1,
  name: 1,
  path: 1,
  sessionId: 1,
  visitorId: 1,
  device: 1,
  referrerHost: 1,
  durationMs: 1,
  element: 1,
  timestamp: 1,
} as const

export async function getProductAnalytics(
  projectId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<ProductSummary> {
  const days = Math.max(1, Math.min(90, Math.floor(windowDays)))
  const now = Date.now()
  const since = now - days * DAY_MS

  const col = await analyticsEventsCol()
  const docs = await col
    .find({ projectId, timestamp: { $gte: since } }, { projection: PROJECTION })
    .sort({ timestamp: -1 })
    .limit(MAX_EVENTS + 1)
    .toArray()

  const sampled = docs.length > MAX_EVENTS
  const events = (sampled ? docs.slice(0, MAX_EVENTS) : docs) as AnalyticsEventDoc[]

  return summariseProduct(events, { windowDays: days, since, sampled })
}

/** How the snippet is installed, in one string a founder can paste. */
export function collectorSnippet(publishableKey: string, origin = "https://atai.ink"): string {
  return `<script defer src="${origin}/atai-analytics.js" data-atai-key="${publishableKey}"></script>`
}
