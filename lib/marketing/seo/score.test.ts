import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { calculateSeoScore, SEO_SCORE_VERSION, SEVERITY_WEIGHTS } from "./score"
import type { SeoFinding } from "@/lib/types/db"

/**
 * The score must be reproducible from the same findings, must EXCLUDE checks
 * whose evidence was missing, and must never collapse "unknown" into zero.
 */

function finding(overrides: Partial<SeoFinding> & Pick<SeoFinding, "id" | "status">): SeoFinding {
  return { ...overrides, label: overrides.label ?? overrides.id }
}

describe("calculateSeoScore", () => {
  it("weights passing and failing eligible checks by severity", () => {
    const score = calculateSeoScore([
      finding({ id: "a", status: "pass", severity: "high" }), // 6
      finding({ id: "b", status: "fail", severity: "low" }), // 1
      finding({ id: "c", status: "not_observed", severity: "critical" }), // excluded
    ])

    expect(score.passedWeight).toBe(6)
    expect(score.failedWeight).toBe(1)
    expect(score.notApplicable).toBe(1)
    expect(score.value).toBe(86) // round(600 / 7)
    expect(score.version).toBe(SEO_SCORE_VERSION)
  })

  it("excludes not_observed findings entirely — missing evidence is not a failure", () => {
    const withMissing = calculateSeoScore([
      finding({ id: "a", status: "pass", severity: "medium" }),
      finding({ id: "b", status: "not_observed", severity: "critical" }),
    ])
    const withoutMissing = calculateSeoScore([finding({ id: "a", status: "pass", severity: "medium" })])

    expect(withMissing.value).toBe(100)
    expect(withMissing.value).toBe(withoutMissing.value)
    expect(withMissing.notApplicable).toBe(1)
  })

  it("returns null — never 0 — when nothing was eligible to score", () => {
    expect(calculateSeoScore([]).value).toBeNull()
    const allMissing = calculateSeoScore([
      finding({ id: "a", status: "not_observed", severity: "high" }),
      finding({ id: "b", status: "not_observed", severity: "low" }),
    ])
    expect(allMissing.value).toBeNull()
    expect(allMissing.notApplicable).toBe(2)
  })

  it("returns null when only zero-weight informational checks were evaluated", () => {
    const score = calculateSeoScore([finding({ id: "a", status: "pass", severity: "info" })])
    expect(score.passedWeight).toBe(0)
    expect(score.value).toBeNull()
  })

  it("is reproducible — identical findings yield an identical score", () => {
    const findings: SeoFinding[] = [
      finding({ id: "a", status: "pass", severity: "critical" }),
      finding({ id: "b", status: "fail", severity: "high" }),
      finding({ id: "c", status: "fail", severity: "medium" }),
    ]
    expect(calculateSeoScore(findings)).toEqual(calculateSeoScore(findings))
  })

  it("assumes a default severity for legacy findings stored without one", () => {
    const score = calculateSeoScore([finding({ id: "legacy", status: "fail" })])
    expect(score.failedWeight).toBe(SEVERITY_WEIGHTS.medium)
    expect(score.value).toBe(0)
  })
})
