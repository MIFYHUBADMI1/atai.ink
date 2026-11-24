/**
 * Product analytics — the read model.
 *
 * A founder does not want a table of events. They want to know which pages
 * people reach, where they stop, what they press, and which single page to fix
 * first. This module turns a window of events into exactly that, and it is
 * pure: given the same events it always says the same thing, so every number
 * on screen can be reproduced in a test.
 *
 * Two honesty rules run through it:
 *   - a number is either measured or absent; a page with no sessions is not
 *     "0% exit", it is not in the list;
 *   - `signals` only says something the events support. When there is not
 *     enough data to say anything, it says that instead of inventing advice.
 */

import type { DeviceKind, ProductEventKind } from "./normalize"

/** The fields the read model needs; `AnalyticsEventDoc` is a superset. */
export interface ProductEvent {
  kind?: ProductEventKind
  name: string
  path?: string
  sessionId?: string
  visitorId?: string
  device?: DeviceKind
  referrerHost?: string
  durationMs?: number
  element?: { role?: string; label?: string }
  timestamp: number
}

export interface ProductPageStat {
  path: string
  views: number
  visitors: number
  /** Sessions that ended on this page. */
  exits: number
  /** Median time spent on the page, when the collector reported it. */
  medianMs?: number
}

export interface ProductClickStat {
  label: string
  role?: string
  path: string
  count: number
}

export interface ProductDayStat {
  date: string
  pageViews: number
  sessions: number
  visitors: number
}

export interface ProductJourney {
  /** Up to three consecutive pages, in order. */
  steps: string[]
  sessions: number
}

export interface ProductSummary {
  windowDays: number
  since: number
  /** True when the window held more events than the read cap; numbers are a floor. */
  sampled: boolean
  pageViews: number
  sessions: number
  visitors: number
  /** Visitors seen in more than one session inside the window. */
  returningVisitors: number
  newVisitors: number
  pagesPerSession: number
  /** Share of sessions that ended after a single page view (0–1). */
  bounceRate: number
  medianSessionMs?: number
  topPages: ProductPageStat[]
  entryPages: Array<{ path: string; sessions: number }>
  exitPages: Array<{ path: string; sessions: number }>
  topClicks: ProductClickStat[]
  daily: ProductDayStat[]
  devices: Array<{ device: string; sessions: number }>
  referrers: Array<{ host: string; sessions: number }>
  journeys: ProductJourney[]
  customEvents: Array<{ name: string; count: number }>
  /** Plain-language findings, strongest first. Empty when data is too thin. */
  signals: string[]
}

const MAX_TOP_PAGES = 8
const MAX_TOP_CLICKS = 8
const MAX_JOURNEYS = 5
const MAX_DAILY_DAYS = 90
/** Below this many sessions, a percentage is noise and no signal is offered. */
const MIN_SESSIONS_FOR_SIGNAL = 3


function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function kindOf(event: ProductEvent): ProductEventKind {
  return event.kind ?? (event.name === "page_view" ? "page_view" : event.name === "click" ? "click" : "custom")
}

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

/**
 * Summarise a window of events. Events may arrive in any order; anything
 * without a usable timestamp is ignored rather than counted as "now".
 */
export function summariseProduct(
  events: ProductEvent[],
  options: { windowDays: number; since: number; sampled?: boolean },
): ProductSummary {
  const windowDays = Math.max(1, Math.min(MAX_DAILY_DAYS, Math.floor(options.windowDays)))
  const since = options.since

  const usable = events
    .filter((event) => Number.isFinite(event.timestamp) && event.timestamp >= since)
    .sort((a, b) => a.timestamp - b.timestamp)

  const visitors = new Set<string>()
  const sessions = new Map<string, ProductEvent[]>()
  const pageViewsByPath = new Map<string, { views: number; visitors: Set<string>; exits: number; durations: number[] }>()
  const clicks = new Map<string, ProductClickStat>()
  const daily = new Map<string, { pageViews: number; sessions: Set<string>; visitors: Set<string> }>()
  const devices = new Map<string, Set<string>>()
  const referrers = new Map<string, Set<string>>()
  const customEvents = new Map<string, number>()

  let pageViews = 0

  for (const event of usable) {
    const sessionKey = event.sessionId || event.visitorId || "anonymous"
    const kind = kindOf(event)
    if (event.visitorId) visitors.add(event.visitorId)

    if (!sessions.has(sessionKey)) sessions.set(sessionKey, [])
    sessions.get(sessionKey)?.push(event)

    if (event.device) {
      const set = devices.get(event.device) ?? new Set<string>()
      set.add(sessionKey)
      devices.set(event.device, set)
    }
    if (event.referrerHost) {
      const set = referrers.get(event.referrerHost) ?? new Set<string>()
      set.add(sessionKey)
      referrers.set(event.referrerHost, set)
    }

    const day = daily.get(dayKey(event.timestamp)) ?? { pageViews: 0, sessions: new Set<string>(), visitors: new Set<string>() }
    day.sessions.add(sessionKey)
    if (event.visitorId) day.visitors.add(event.visitorId)

    if (kind === "page_view" && event.path) {
      pageViews++
      day.pageViews++
      const stat = pageViewsByPath.get(event.path) ?? { views: 0, visitors: new Set<string>(), exits: 0, durations: [] }
      stat.views++
      if (event.visitorId) stat.visitors.add(event.visitorId)
      pageViewsByPath.set(event.path, stat)
    } else if (kind === "click") {
      const label = event.element?.label ?? event.element?.role ?? "unlabelled"
      const key = `${event.path ?? "?"}\u0000${label}`
      const existing = clicks.get(key)
      if (existing) existing.count++
      else {
        clicks.set(key, {
          label,
          ...(event.element?.role ? { role: event.element.role } : {}),
          path: event.path ?? "?",
          count: 1,
        })
      }
    } else if (kind === "page_leave" && event.path && typeof event.durationMs === "number") {
      const stat = pageViewsByPath.get(event.path)
      if (stat) stat.durations.push(event.durationMs)
    } else if (kind === "custom" || kind === "conversion") {
      customEvents.set(event.name, (customEvents.get(event.name) ?? 0) + 1)
    }

    daily.set(dayKey(event.timestamp), day)
  }

  // ── Per-session shape: entry, exit, depth, duration ───────────────────────
  const entryPages = new Map<string, number>()
  const exitPages = new Map<string, number>()
  const journeys = new Map<string, { steps: string[]; sessions: number }>()
  const sessionDurations: number[] = []
  let bounced = 0

  for (const [, sessionEvents] of sessions) {
    const views = sessionEvents.filter((event) => kindOf(event) === "page_view" && event.path)
    if (views.length === 0) continue
    const paths = views.map((event) => event.path as string)
    const entry = paths[0]
    const exit = paths[paths.length - 1]
    entryPages.set(entry, (entryPages.get(entry) ?? 0) + 1)
    exitPages.set(exit, (exitPages.get(exit) ?? 0) + 1)
    const exitStat = pageViewsByPath.get(exit)
    if (exitStat) exitStat.exits++
    if (views.length === 1) bounced++

    const spent = sessionEvents.reduce(
      (total, event) => total + (kindOf(event) === "page_leave" && typeof event.durationMs === "number" ? event.durationMs : 0),
      0,
    )
    if (spent > 0) sessionDurations.push(spent)

    const steps = [...new Set(paths)].slice(0, 3)
    const key = steps.join(" → ")
    const journey = journeys.get(key) ?? { steps, sessions: 0 }
    journey.sessions++
    journeys.set(key, journey)
  }

  const sessionCount = sessions.size
  const topPages: ProductPageStat[] = [...pageViewsByPath.entries()]
    .map(([path, stat]) => ({
      path,
      views: stat.views,
      visitors: stat.visitors.size,
      exits: stat.exits,
      ...(median(stat.durations) !== undefined ? { medianMs: median(stat.durations) } : {}),
    }))
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))
    .slice(0, MAX_TOP_PAGES)

  const topClicks = [...clicks.values()].sort((a, b) => b.count - a.count).slice(0, MAX_TOP_CLICKS)
  const topJourneys = [...journeys.values()].sort((a, b) => b.sessions - a.sessions).slice(0, MAX_JOURNEYS)

  const sessionsByVisitor = new Map<string, number>()
  for (const [, list] of sessions) {
    const visitor = list.find((event) => event.visitorId)?.visitorId
    if (!visitor) continue
    sessionsByVisitor.set(visitor, (sessionsByVisitor.get(visitor) ?? 0) + 1)
  }
  const returning = [...sessionsByVisitor.values()].filter((count) => count > 1).length

  const summary: ProductSummary = {
    windowDays,
    since,
    sampled: options.sampled ?? false,
    pageViews,
    sessions: sessionCount,
    visitors: visitors.size,
    returningVisitors: returning,
    newVisitors: Math.max(0, visitors.size - returning),
    pagesPerSession: sessionCount > 0 ? Math.round((pageViews / sessionCount) * 10) / 10 : 0,
    bounceRate: sessionCount > 0 ? Math.round((bounced / sessionCount) * 100) / 100 : 0,
    ...(median(sessionDurations) !== undefined ? { medianSessionMs: median(sessionDurations) } : {}),
    topPages,
    entryPages: [...entryPages.entries()]
      .map(([path, count]) => ({ path, sessions: count }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, MAX_TOP_PAGES),
    exitPages: [...exitPages.entries()]
      .map(([path, count]) => ({ path, sessions: count }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, MAX_TOP_PAGES),
    topClicks,
    daily: [...daily.entries()]
      .map(([date, day]) => ({ date, pageViews: day.pageViews, sessions: day.sessions.size, visitors: day.visitors.size }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    devices: [...devices.entries()]
      .map(([device, set]) => ({ device, sessions: set.size }))
      .sort((a, b) => b.sessions - a.sessions),
    referrers: [...referrers.entries()]
      .map(([host, set]) => ({ host, sessions: set.size }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, MAX_TOP_PAGES),
    journeys: topJourneys,
    customEvents: [...customEvents.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_TOP_PAGES),
    signals: [],
  }

  summary.signals = productSignals(summary)
  return summary
}

/**
 * What the numbers mean, in the founder's words.
 *
 * Each signal is a complete sentence with the number that justifies it, so it
 * can be read on its own — in the panel, in a digest, or in an email — without
 * the chart next to it. Nothing is said below the sample size where it would be
 * noise, and nothing is said at all when there is nothing measured.
 */
export function productSignals(summary: ProductSummary): string[] {
  if (summary.sessions === 0) return []

  const signals: string[] = []

  // Where they stop: the page that ends the most visits, relative to the
  // visits that reached it. This is the single most actionable number here.
  const worstExit = [...summary.topPages]
    .filter((page) => page.views >= MIN_SESSIONS_FOR_SIGNAL && page.exits > 0)
    .map((page) => ({ page, rate: page.exits / page.views }))
    .sort((a, b) => b.rate - a.rate)[0]

  if (worstExit && worstExit.rate >= 0.4 && summary.sessions >= MIN_SESSIONS_FOR_SIGNAL) {
    signals.push(
      `${worstExit.page.path} is where people stop: ${percent(worstExit.page.exits, worstExit.page.views)}% of the visits that reached it ended there. That is the page to fix first.`,
    )
  }

  const busiest = summary.topPages[0]
  if (busiest && summary.pageViews > 0) {
    const share = percent(busiest.views, summary.pageViews)
    if (share >= 30) {
      signals.push(`${busiest.path} is your front door — ${share}% of all page views land there.`)
    }
  }

  if (summary.sessions >= MIN_SESSIONS_FOR_SIGNAL) {
    if (summary.bounceRate >= 0.6) {
      signals.push(
        `${Math.round(summary.bounceRate * 100)}% of visits end after a single page. A clearer next step on the first page is the cheapest fix.`,
      )
    } else if (summary.pagesPerSession >= 2.5) {
      signals.push(`Visitors look at ${summary.pagesPerSession} pages per visit on average — people are exploring, not bouncing.`)
    }
  }

  const topClick = summary.topClicks[0]
  if (topClick && topClick.count >= MIN_SESSIONS_FOR_SIGNAL) {
    signals.push(`The most pressed thing is “${topClick.label}” on ${topClick.path} (${topClick.count} presses).`)
  }

  const journey = summary.journeys[0]
  if (journey && journey.steps.length >= 2 && journey.sessions >= MIN_SESSIONS_FOR_SIGNAL) {
    signals.push(`The usual path is ${journey.steps.join(" → ")} — ${journey.sessions} visits took it.`)
  }

  if (summary.referrers[0] && summary.referrers[0].sessions >= MIN_SESSIONS_FOR_SIGNAL) {
    signals.push(`Most visits arrive from ${summary.referrers[0].host}.`)
  }

  return signals.slice(0, 4)
}

/** The summary of a project with nothing measured — what a failed read falls back to. */
export function emptyProductSummary(windowDays: number): ProductSummary {
  const days = Math.max(1, Math.min(MAX_DAILY_DAYS, Math.floor(windowDays)))
  return summariseProduct([], { windowDays: days, since: Date.now() - days * 24 * 60 * 60 * 1000 })
}
