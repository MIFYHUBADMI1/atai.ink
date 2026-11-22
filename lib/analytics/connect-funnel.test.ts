import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const track = vi.hoisted(() => vi.fn())
vi.mock("@vercel/analytics", () => ({ track }))

import {
  beginConnectFlow,
  trackConnectClaimBlocked,
  trackConnectCompleted,
  trackConnectReadCompleted,
  trackConnectSubmitted,
  trackConnectVerified,
} from "./connect-funnel"

/** Only primitives, and nothing that names the business or the person. */
const ALLOWED = new Set([
  "flow_id",
  "surface",
  "state",
  "method",
  "attempts",
  "time_to_submit_ms",
  "time_to_read_ms",
  "time_to_connect_ms",
])

function fakeSessionStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}

beforeEach(() => {
  vi.stubGlobal("window", { sessionStorage: fakeSessionStorage() })
  track.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function emitted() {
  return track.mock.calls.map(([name, properties]) => ({ name, properties }))
}

describe("connect funnel", () => {
  it("emits connect_started once and reuses the flow across steps", () => {
    beginConnectFlow("wizard")
    beginConnectFlow("wizard")
    trackConnectSubmitted({ surface: "wizard" })

    const events = emitted()
    expect(events.map((event) => event.name)).toEqual(["connect_started", "connect_submitted"])
    expect(events[0].properties.flow_id).toBe(events[1].properties.flow_id)
  })

  it("records why a business was blocked", () => {
    beginConnectFlow("wizard")
    trackConnectClaimBlocked({ surface: "wizard", state: "held_by_other" })

    const blocked = emitted().find((event) => event.name === "connect_claim_blocked")
    expect(blocked?.properties).toMatchObject({ surface: "wizard", state: "held_by_other" })
  })

  it("carries the remaining steps", () => {
    beginConnectFlow("project")
    trackConnectReadCompleted({ surface: "project" })
    trackConnectVerified({ method: "meta_tag", attempts: 2 })
    trackConnectCompleted({ surface: "project" })

    expect(emitted().map((event) => event.name)).toEqual([
      "connect_started",
      "connect_read_completed",
      "connect_verified",
      "connect_completed",
    ])
  })

  it("sends only allowlisted, non-identifying properties", () => {
    beginConnectFlow("wizard")
    trackConnectClaimBlocked({ surface: "wizard", state: "held_by_same_account" })
    trackConnectSubmitted({ surface: "wizard" })
    trackConnectReadCompleted({ surface: "wizard" })
    trackConnectVerified({ method: "html_file", attempts: 1 })
    trackConnectCompleted({ surface: "wizard" })

    for (const { properties } of emitted()) {
      for (const [key, value] of Object.entries(properties)) {
        expect(ALLOWED.has(key)).toBe(true)
        expect(["string", "number", "boolean", "undefined"].includes(typeof value)).toBe(true)
      }
    }
  })
})
