import { describe, expect, it } from "vitest"
import { mergeProgress, sanitizeProgress } from "./progress"

/**
 * Progress arrives from a browser and from storage, both of which an
 * interested party controls. Anything unusable is dropped rather than repaired
 * into a plausible-looking zero, because a invented record would silently
 * resume a founder at a stop they never reached.
 */

const VALID = { step: 3, status: "in-progress", updatedAt: 1_700_000_000_000, skipped: ["a"], paused: true }

describe("sanitising", () => {
  it("keeps a well-formed record", () => {
    expect(sanitizeProgress({ welcome: VALID })).toEqual({
      welcome: { ...VALID, skipped: ["a"], paused: true },
    })
  })

  it("drops a record with an unknown status", () => {
    expect(sanitizeProgress({ welcome: { ...VALID, status: "completed-by-admin" } })).toEqual({})
  })

  it("drops a record with no usable step", () => {
    for (const step of ["3", null, {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sanitizeProgress({ welcome: { ...VALID, step } }), String(step)).toEqual({})
    }
  })

  it("lifts a negative step back onto the first stop", () => {
    expect(sanitizeProgress({ welcome: { ...VALID, step: -2 } }).welcome?.step).toBe(0)
  })

  it("clamps a step that runs past any real tour", () => {
    const out = sanitizeProgress({ welcome: { ...VALID, step: 10_000 } })
    expect(out.welcome?.step).toBe(200)
  })

  it("survives non-object payloads", () => {
    for (const value of [null, undefined, 7, "progress", [], true]) {
      expect(sanitizeProgress(value)).toEqual({})
    }
  })

  it("keeps only string step ids, and only as many as fit", () => {
    const skipped = Array.from({ length: 400 }, (_, i) => `step-${i}`)
    const out = sanitizeProgress({ welcome: { ...VALID, skipped: [...skipped, 1, {}, null] } })
    expect(out.welcome?.skipped).toHaveLength(200)
    expect(out.welcome?.skipped?.[0]).toBe("step-0")
  })

  it("caps the number of tours so one field cannot grow forever", () => {
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`t${i}`, VALID]))
    expect(Object.keys(sanitizeProgress(many))).toHaveLength(200)
  })

  it("truncates an over-long key instead of storing it as sent", () => {
    const key = "x".repeat(300)
    const out = sanitizeProgress({ [key]: VALID })
    expect(Object.keys(out)[0]).toHaveLength(64)
  })
})

describe("merging the local mirror with the server", () => {
  const server = { welcome: { step: 1, status: "in-progress" as const, updatedAt: 100 } }

  it("uses the server alone when nothing is stored locally", () => {
    expect(mergeProgress(server, null)).toEqual(server)
  })

  it("prefers whichever entry is newer", () => {
    const newerLocal = { welcome: { step: 6, status: "in-progress" as const, updatedAt: 200 } }
    expect(mergeProgress(server, newerLocal).welcome.step).toBe(6)
    const newerServer = { welcome: { step: 2, status: "completed" as const, updatedAt: 300 } }
    expect(mergeProgress(newerServer, newerLocal).welcome.status).toBe("completed")
  })

  it("keeps tours that only exist on one side", () => {
    const merged = mergeProgress(server, { market: { step: 0, status: "completed" as const, updatedAt: 5 } })
    expect(Object.keys(merged).sort()).toEqual(["market", "welcome"])
  })

  it("does not mutate either input", () => {
    const local = { market: { step: 0, status: "completed" as const, updatedAt: 5 } }
    mergeProgress(server, local)
    expect(Object.keys(server)).toEqual(["welcome"])
    expect(Object.keys(local)).toEqual(["market"])
  })
})
