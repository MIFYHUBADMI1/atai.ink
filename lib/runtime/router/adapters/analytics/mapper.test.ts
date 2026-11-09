import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  ANALYTICS_RETENTION_DAYS,
  parseSummaryWindow,
  toAnalyticsEvents,
  toSummaryResult,
  toTrackResult,
} from "./mapper"
import { ProviderExecutionError } from "@/lib/runtime/router/adapter"

/**
 * First-party analytics mapper guarantees: events are scoped to the trusted
 * project id, properties are reduced to bounded scalars (never credentials),
 * client clocks are clamped, and invalid input is refused loudly.
 */

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

describe("toAnalyticsEvents — project scoping", () => {
  it("stamps the trusted project id and environment, not anything from input", () => {
    const docs = toAnalyticsEvents({ events: [{ name: "signup" }] }, "proj_trusted", "production", NOW)
    expect(docs).toHaveLength(1)
    expect(docs[0].projectId).toBe("proj_trusted")
    expect(docs[0].environment).toBe("production")
    expect(docs[0].recordedAt).toBe(NOW)
  })

  it("rejects an attempt to inject a project id through the event body", () => {
    expect(() =>
      toAnalyticsEvents({ events: [{ name: "signup", projectId: "proj_evil" }] }, "proj_trusted", "development", NOW),
    ).toThrow(ProviderExecutionError)
  })

  it("sets a 90-day TTL expiry", () => {
    const [doc] = toAnalyticsEvents({ events: [{ name: "x" }] }, "p", "development", NOW)
    expect(doc.expiresAt.getTime()).toBe(NOW + ANALYTICS_RETENTION_DAYS * DAY)
  })
})

describe("toAnalyticsEvents — property sanitization", () => {
  it("drops credential-like keys", () => {
    const [doc] = toAnalyticsEvents(
      {
        events: [
          {
            name: "x",
            properties: {
              api_key: "sk-live-123",
              apiKey: "secret",
              token: "abc",
              secret: "s",
              authorization: "Bearer x",
              password: "p",
              credential: "c",
              cookie: "sess",
              plan: "pro",
            },
          },
        ],
      },
      "p",
      "development",
      NOW,
    )
    expect(doc.properties).toEqual({ plan: "pro" })
  })

  it("keeps only scalar values and drops objects/arrays/null", () => {
    const [doc] = toAnalyticsEvents(
      { events: [{ name: "x", properties: { s: "ok", n: 3, b: true, obj: { a: 1 }, arr: [1], nil: null } }] },
      "p",
      "development",
      NOW,
    )
    expect(doc.properties).toEqual({ s: "ok", n: 3, b: true })
  })

  it("truncates long string values to 500 chars", () => {
    const [doc] = toAnalyticsEvents(
      { events: [{ name: "x", properties: { big: "a".repeat(900) } }] },
      "p",
      "development",
      NOW,
    )
    expect((doc.properties?.big as string).length).toBe(500)
  })

  it("omits properties entirely when nothing scalar survives", () => {
    const [doc] = toAnalyticsEvents(
      { events: [{ name: "x", properties: { token: "x", obj: {} } }] },
      "p",
      "development",
      NOW,
    )
    expect(doc.properties).toBeUndefined()
  })
})

describe("toAnalyticsEvents — timestamp clamping", () => {
  it("keeps an in-range client timestamp", () => {
    const ts = NOW - DAY
    const [doc] = toAnalyticsEvents({ events: [{ name: "x", timestamp: ts }] }, "p", "development", NOW)
    expect(doc.timestamp).toBe(ts)
  })

  it("falls back to server time for far-past or future timestamps", () => {
    const [past] = toAnalyticsEvents({ events: [{ name: "x", timestamp: NOW - 30 * DAY }] }, "p", "development", NOW)
    const [future] = toAnalyticsEvents({ events: [{ name: "x", timestamp: NOW + DAY }] }, "p", "development", NOW)
    expect(past.timestamp).toBe(NOW)
    expect(future.timestamp).toBe(NOW)
  })
})

describe("toAnalyticsEvents — validation", () => {
  it("refuses an empty batch", () => {
    expect(() => toAnalyticsEvents({ events: [] }, "p", "development", NOW)).toThrow(ProviderExecutionError)
  })

  it("refuses more than 100 events", () => {
    const events = Array.from({ length: 101 }, (_, i) => ({ name: `e${i}` }))
    expect(() => toAnalyticsEvents({ events }, "p", "development", NOW)).toThrow(ProviderExecutionError)
  })

  it("refuses a blank event name", () => {
    expect(() => toAnalyticsEvents({ events: [{ name: "   " }] }, "p", "development", NOW)).toThrow(ProviderExecutionError)
  })
})

describe("parseSummaryWindow", () => {
  it("defaults to 7 days", () => {
    expect(parseSummaryWindow({})).toBe(7)
    expect(parseSummaryWindow(undefined)).toBe(7)
  })
  it("accepts a valid window", () => {
    expect(parseSummaryWindow({ windowDays: 30 })).toBe(30)
  })
  it("refuses out-of-range or non-integer windows", () => {
    expect(() => parseSummaryWindow({ windowDays: 0 })).toThrow(ProviderExecutionError)
    expect(() => parseSummaryWindow({ windowDays: 91 })).toThrow(ProviderExecutionError)
    expect(() => parseSummaryWindow({ windowDays: 1.5 })).toThrow(ProviderExecutionError)
  })
})

describe("result envelopes", () => {
  it("tags results as the first-party atai provider", () => {
    expect(toTrackResult(2)).toEqual({ provider: "atai", data: { accepted: 2 } })
    const summary = { windowDays: 7, since: NOW, totalEvents: 0, uniqueVisitors: 0, returningVisitors: 0, newVisitors: 0, topEvents: [], daily: [] }
    expect(toSummaryResult(summary)).toEqual({ provider: "atai", data: summary })
  })
})