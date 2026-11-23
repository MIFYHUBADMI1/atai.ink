import { describe, expect, it } from "vitest"

import { summariseProduct, type ProductEvent } from "./summary"

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000
const SINCE = NOW - 7 * DAY

function view(sessionId: string, path: string, at: number, visitorId = sessionId): ProductEvent {
  return { kind: "page_view", name: "page_view", path, sessionId, visitorId, timestamp: at, device: "desktop" }
}

function click(sessionId: string, path: string, label: string, at: number): ProductEvent {
  return {
    kind: "click",
    name: "click",
    path,
    sessionId,
    visitorId: sessionId,
    timestamp: at,
    element: { role: "button", label },
  }
}

function leave(sessionId: string, path: string, durationMs: number, at: number): ProductEvent {
  return { kind: "page_leave", name: "page_leave", path, sessionId, visitorId: sessionId, durationMs, timestamp: at }
}

describe("summariseProduct", () => {
  it("counts pages, sessions and visitors, and says nothing when there is nothing", () => {
    const empty = summariseProduct([], { windowDays: 7, since: SINCE })
    expect(empty.sessions).toBe(0)
    expect(empty.topPages).toEqual([])
    expect(empty.signals).toEqual([])
  })

  it("groups a visit into entry, exit, depth and duration", () => {
    const events = [
      view("s1", "/", NOW - 3 * DAY),
      view("s1", "/pricing", NOW - 3 * DAY + 40_000),
      leave("s1", "/pricing", 90_000, NOW - 3 * DAY + 130_000),
    ]

    const summary = summariseProduct(events, { windowDays: 7, since: SINCE })

    expect(summary.sessions).toBe(1)
    expect(summary.pageViews).toBe(2)
    expect(summary.pagesPerSession).toBe(2)
    expect(summary.entryPages).toEqual([{ path: "/", sessions: 1 }])
    expect(summary.exitPages).toEqual([{ path: "/pricing", sessions: 1 }])
    expect(summary.topPages.find((page) => page.path === "/pricing")?.exits).toBe(1)
    expect(summary.medianSessionMs).toBe(90_000)
  })

  it("counts a single-page visit as a bounce and says so once there is a sample", () => {
    const events = [
      view("s1", "/", NOW - DAY),
      view("s2", "/", NOW - DAY + 1_000),
      view("s3", "/", NOW - DAY + 2_000),
    ]

    const summary = summariseProduct(events, { windowDays: 7, since: SINCE })

    expect(summary.bounceRate).toBe(1)
    expect(summary.signals.join(" ")).toMatch(/end after a single page/)
  })

  it("names the page where people stop, with the number behind it", () => {
    const events: ProductEvent[] = []
    for (let i = 0; i < 4; i++) {
      events.push(view(`s${i}`, "/", NOW - DAY + i * 1_000))
      events.push(view(`s${i}`, "/checkout", NOW - DAY + i * 1_000 + 500))
    }
    // A fifth visit that goes further, so /checkout is not 100% exit.
    events.push(view("s9", "/", NOW - DAY + 9_000))
    events.push(view("s9", "/checkout", NOW - DAY + 9_500))
    events.push(view("s9", "/thanks", NOW - DAY + 10_000))

    const summary = summariseProduct(events, { windowDays: 7, since: SINCE })
    const stop = summary.signals.find((signal) => signal.includes("/checkout"))

    expect(stop).toBeDefined()
    expect(stop).toMatch(/ended there/)
    expect(stop).toMatch(/80%/)
  })

  it("reports the most pressed thing, by its label", () => {
    const events = [
      view("s1", "/pricing", NOW - DAY),
      click("s1", "/pricing", "Start free trial", NOW - DAY + 100),
      click("s1", "/pricing", "Start free trial", NOW - DAY + 200),
      click("s1", "/pricing", "Start free trial", NOW - DAY + 300),
    ]

    const summary = summariseProduct(events, { windowDays: 7, since: SINCE })

    expect(summary.topClicks[0]).toMatchObject({ label: "Start free trial", role: "button", count: 3 })
    expect(summary.signals.join(" ")).toMatch(/most pressed thing is “Start free trial”/)
  })

  it("keeps the usual journey in order and collapses a revisit", () => {
    const events = [
      view("s1", "/", NOW - DAY),
      view("s1", "/pricing", NOW - DAY + 1_000),
      view("s1", "/", NOW - DAY + 2_000),
      view("s2", "/", NOW - DAY + 3_000),
      view("s2", "/pricing", NOW - DAY + 4_000),
    ]

    const summary = summariseProduct(events, { windowDays: 7, since: SINCE })

    expect(summary.journeys[0]).toEqual({ steps: ["/", "/pricing"], sessions: 2 })
  })

  it("separates a returning visitor from a new one without guessing", () => {
    const events = [
      view("s1", "/", NOW - 3 * DAY, "v1"),
      view("s2", "/", NOW - 2 * DAY, "v1"),
      view("s3", "/", NOW - DAY, "v2"),
    ]

    const summary = summariseProduct(events, { windowDays: 7, since: SINCE })

    expect(summary.visitors).toBe(2)
    expect(summary.returningVisitors).toBe(1)
    expect(summary.newVisitors).toBe(1)
  })

  it("ignores events outside the window and events without a timestamp", () => {
    const events = [
      view("s1", "/", SINCE - 1),
      { kind: "page_view", name: "page_view", path: "/x", sessionId: "s2", timestamp: Number.NaN } as ProductEvent,
      view("s3", "/", NOW - 1_000),
    ]

    const summary = summariseProduct(events, { windowDays: 7, since: SINCE })

    expect(summary.pageViews).toBe(1)
    expect(summary.sessions).toBe(1)
  })

  it("counts custom events by the name the app gave them", () => {
    const events: ProductEvent[] = [
      view("s1", "/", NOW - DAY),
      { kind: "conversion", name: "signup", sessionId: "s1", timestamp: NOW - DAY + 5 },
      { kind: "conversion", name: "signup", sessionId: "s1", timestamp: NOW - DAY + 6 },
    ]

    const summary = summariseProduct(events, { windowDays: 7, since: SINCE })

    expect(summary.customEvents).toEqual([{ name: "signup", count: 2 }])
  })

  it("marks a capped read as sampled so the number is not read as exact", () => {
    const summary = summariseProduct([view("s1", "/", NOW - DAY)], {
      windowDays: 7,
      since: SINCE,
      sampled: true,
    })

    expect(summary.sampled).toBe(true)
  })
})
