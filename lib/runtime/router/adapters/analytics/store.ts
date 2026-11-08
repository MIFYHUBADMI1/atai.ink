import "server-only"
import { analyticsEventsCol } from "@/lib/db/collections"
import type { AnalyticsEventDoc } from "@/lib/types/db"
import type { AnalyticsDailyBucket, AnalyticsSummaryResultData, AnalyticsTopEvent } from "./mapper"

/**
 * Atai Runtime — first-party analytics store (server-only).
 *
 * Persists tracked events and computes project-scoped retention summaries
 * directly from Atai's own MongoDB. No external analytics provider is involved:
 * the data never leaves atai.ink, and every read is filtered by the trusted
 * project id. Events auto-expire via the TTL index (see ANALYTICS_RETENTION_DAYS).
 *
 * @module lib/runtime/router/adapters/analytics/store
 */

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_TOP_EVENTS = 10

/** Persist a normalized batch of events; returns how many were inserted. */
export async function recordEvents(events: AnalyticsEventDoc[]): Promise<number> {
  if (events.length === 0) return 0
  const col = await analyticsEventsCol()
  const result = await col.insertMany(events, { ordered: false })
  return result.insertedCount
}

/**
 * Compute a retention/activity summary for one project over a look-back window.
 * Returning visitors are those seen in the window who also appear in the
 * retained history before it — an honest measure bounded by the TTL retention.
 */
export async function computeSummary(
  projectId: string,
  windowDays: number,
  now: number = Date.now(),
): Promise<AnalyticsSummaryResultData> {
  const days = Math.max(1, Math.min(90, Math.floor(windowDays)))
  const since = now - days * DAY_MS
  const col = await analyticsEventsCol()
  const windowMatch = { projectId, timestamp: { $gte: since, $lte: now } }

  const [facetRows, dailyRows, inWindowVisitors, priorVisitors] = await Promise.all([
    col
      .aggregate<{ total: Array<{ count: number }>; top: AnalyticsTopEvent[] }>([
        { $match: windowMatch },
        {
          $facet: {
            total: [{ $count: "count" }],
            top: [
              { $group: { _id: "$name", count: { $sum: 1 } } },
              { $sort: { count: -1, _id: 1 } },
              { $limit: MAX_TOP_EVENTS },
              { $project: { _id: 0, name: "$_id", count: 1 } },
            ],
          },
        },
      ])
      .toArray(),
    col
      .aggregate<AnalyticsDailyBucket>([
        { $match: windowMatch },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$timestamp" } } },
            events: { $sum: 1 },
            visitors: { $addToSet: "$visitorId" },
          },
        },
        {
          $project: {
            _id: 0,
            date: "$_id",
            events: 1,
            visitors: {
              $size: {
                $filter: { input: "$visitors", as: "v", cond: { $eq: [{ $type: "$$v" }, "string"] } },
              },
            },
          },
        },
        { $sort: { date: 1 } },
      ])
      .toArray(),
    col.distinct("visitorId", { ...windowMatch, visitorId: { $type: "string" } }),
    col.distinct("visitorId", { projectId, timestamp: { $lt: since }, visitorId: { $type: "string" } }),
  ])

  const facet = facetRows[0]
  const totalEvents = facet?.total[0]?.count ?? 0
  const topEvents = facet?.top ?? []
  const priorSet = new Set(priorVisitors)
  const uniqueVisitors = inWindowVisitors.length
  const returningVisitors = inWindowVisitors.filter((v) => priorSet.has(v)).length

  return {
    windowDays: days,
    since,
    totalEvents,
    uniqueVisitors,
    returningVisitors,
    newVisitors: Math.max(0, uniqueVisitors - returningVisitors),
    topEvents,
    daily: dailyRows,
  }
}