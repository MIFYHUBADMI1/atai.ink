import { describe, expect, it } from "vitest"
import { businessSteps } from "./steps"
import type { IntakeView } from "./view"

function view(overrides: Partial<IntakeView> = {}): IntakeView {
  return {
    startingPoint: "existing_business",
    objectives: [],
    overall: "completed",
    website: { submitted: true, analyzed: true, status: "completed", url: "https://bakery.example" },
    domain: { records: [], verified: false },
    connection: { status: "not_connected", label: "Not connected" },
    assessment: { status: "pending" },
    ...overrides,
  }
}

const withResult = {
  status: "completed" as const,
  result: {
    evidence: { websiteAnalysed: true, pagesCrawled: 3, ownerDescription: true, domainVerified: false },
    summary: "A bakery",
    findings: [],
    priorities: [],
  },
}

/**
 * The profile walks three steps in dependency order. The connection can only be
 * verified with domain proof, so a verified connection implies a verified
 * domain — the stepper must never claim otherwise.
 */
describe("businessSteps", () => {
  it("starts at the assessment when nothing has happened yet", () => {
    const { steps, current } = businessSteps(view())
    expect(current).toBe(0)
    expect(steps.map((s) => s.done)).toEqual([false, false, false])
  })

  it("moves to domain proof once the assessment exists", () => {
    const { steps, current } = businessSteps(view({ assessment: withResult as IntakeView["assessment"] }))
    expect(current).toBe(1)
    expect(steps.map((s) => s.done)).toEqual([true, false, false])
  })

  it("moves to the connection once the domain is verified", () => {
    const { steps, current } = businessSteps(
      view({ assessment: withResult as IntakeView["assessment"], domain: { records: [], verified: true } }),
    )
    expect(current).toBe(2)
    expect(steps.map((s) => s.done)).toEqual([true, true, false])
  })

  it("reports every step done, with no current step, once the connection is verified", () => {
    const { steps, current } = businessSteps(
      view({
        assessment: withResult as IntakeView["assessment"],
        domain: { records: [], verified: true },
        connection: { status: "verified", label: "Connected", firstSeenAt: 1, lastSeenAt: 1 },
      }),
    )
    expect(current).toBe(-1)
    expect(steps.every((s) => s.done)).toBe(true)
  })

  it("does not treat a half-finished connection as done", () => {
    for (const status of ["awaiting_domain", "awaiting_app", "stale", "revoked"] as const) {
      const { steps } = businessSteps(
        view({ assessment: withResult as IntakeView["assessment"], connection: { status, label: status } }),
      )
      expect(steps[2].done, status).toBe(false)
    }
  })
})
