import { describe, expect, it } from "vitest"
import {
  failureRate,
  measured,
  notInstrumented,
  percentile,
  unavailable,
} from "./metric-trust"
import { intelligenceSections } from "./overview"

/**
 * Phase 1 unit tests: the honest-data-state guarantees (a real measured zero
 * ≠ a failed read ≠ a capability that does not exist yet) and the section
 * registry the IA depends on.
 */

describe("metric trust — availability states", () => {
  it("keeps measured zero distinct from available", () => {
    const zero = measured(0, { definition: "d", caveat: "c", source: "s" })
    const avail = measured(5, { definition: "d", caveat: "c", source: "s" })
    expect(zero.state).toBe("measured_zero")
    expect(zero.value).toBe(0)
    expect(avail.state).toBe("available")
    expect(avail.value).toBe(5)
  })

  it("marks unavailable reads without a value", () => {
    const m = unavailable("read failed", { definition: "d", caveat: "c", source: "s" })
    expect(m.state).toBe("unavailable")
    expect(m.value).toBeNull()
    expect(m.reason).toBe("read failed")
  })

  it("marks uninstrumented capabilities without any source", () => {
    const m = notInstrumented("no ingestion exists", { definition: "d", caveat: "c" })
    expect(m.state).toBe("not_instrumented")
    expect(m.value).toBeNull()
    expect(m.source).toBeUndefined()
  })
})

describe("failure rate", () => {
  it("returns null for an empty sample rather than a fake 100% success", () => {
    expect(failureRate(0, 0)).toBeNull()
  })
  it("computes the fraction for real samples", () => {
    expect(failureRate(1, 4)).toBe(0.25)
    expect(failureRate(0, 10)).toBe(0)
  })
})

describe("percentile", () => {
  it("returns null for empty samples", () => {
    expect(percentile([], 50)).toBeNull()
  })
  it("interpolates p50 and p95 over sorted samples", () => {
    const sorted = [10, 20, 30, 40, 50]
    expect(percentile(sorted, 50)).toBe(30)
    // Linear interpolation between ranks: rank 3.8 → 40 + (50-40)*0.8 = 48.
    // Consumers (overview.ts) round the result, so the fractional part is intentional.
    expect(percentile(sorted, 95)).toBe(48)
    expect(percentile([100], 95)).toBe(100)
  })
})

describe("intelligence sections", () => {
  it("registers the full IA with overview live and everything else honestly gated", () => {
    const sections = intelligenceSections()
    const byId = new Map(sections.map((s) => [s.id, s]))
    expect(byId.get("overview")?.status).toBe("live")
    expect(byId.get("health")?.status).toBe("partial")
    for (const id of ["analytics", "journeys", "retention", "insights", "recommendations", "experiments", "instrumentation"] as const) {
      expect(byId.get(id)?.status).toBe("pending_ingestion")
    }
  })

  it("does not duplicate section ids", () => {
    const ids = intelligenceSections().map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
