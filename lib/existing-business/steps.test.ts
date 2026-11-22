import { describe, expect, it } from "vitest"
import type { DomainView } from "@/lib/domain/service"
import { businessSteps, unresolvedDomainClaims } from "./steps"
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

function claim(overrides: Partial<DomainView> = {}): DomainView {
  return {
    id: "dom-1",
    hostname: "bakery.example",
    registrableDomain: "bakery.example",
    submittedUrl: "https://bakery.example",
    status: "pending",
    method: "meta_tag",
    token: "token-1",
    metaSnippet: null,
    fileName: null,
    tokenExpiresAt: null,
    attempts: 0,
    lastAttemptAt: null,
    lastCheckedAt: null,
    claimExpiresAt: null,
    verifiedAt: null,
    verifiedMethod: null,
    needsAttention: false,
    lastFailure: null,
    matchesRead: null,
    history: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/**
 * A proof settles one address, not the addresses next to it. Each waiting claim
 * reserves a hostname nobody else can connect, so the step stays open until the
 * founder either proves it or removes it.
 */
describe("businessSteps — unproved addresses keep the domain step open", () => {
  const assessed = withResult as IntakeView["assessment"]

  it("does not finish the domain step while another address is still waiting", () => {
    const { steps, current } = businessSteps(
      view({
        assessment: assessed,
        domain: { records: [claim({ status: "verified" }), claim({ id: "dom-2", hostname: "shop.bakery.example" })], verified: true },
      }),
    )
    expect(current).toBe(1)
    expect(steps[1].done).toBe(false)
    expect(steps[1].requirement).toContain("proved or removed")
  })

  it("finishes the step once every address is proved", () => {
    const { steps, current } = businessSteps(
      view({
        assessment: assessed,
        domain: {
          records: [claim({ status: "verified" }), claim({ id: "dom-2", hostname: "shop.bakery.example", status: "verified" })],
          verified: true,
        },
      }),
    )
    expect(current).toBe(2)
    expect(steps[1].done).toBe(true)
  })

  it("finishes the step once the extra address is removed", () => {
    const { steps } = businessSteps(
      view({
        assessment: assessed,
        domain: { records: [claim({ status: "verified" }), claim({ id: "dom-2", status: "revoked" })], verified: true },
      }),
    )
    expect(steps[1].done).toBe(true)
  })

  it("counts an expired or failed challenge as still waiting", () => {
    for (const status of ["pending", "failed", "expired", "in_progress"] as const) {
      const { steps } = businessSteps(
        view({
          assessment: assessed,
          domain: { records: [claim({ status: "verified" }), claim({ id: "dom-2", status })], verified: true },
        }),
      )
      expect(steps[1].done, status).toBe(false)
    }
  })

  it("lets the step close once the reservation has run out, because nothing is blocked any more", () => {
    const { steps } = businessSteps(
      view({
        assessment: assessed,
        domain: {
          records: [
            claim({ status: "verified" }),
            claim({ id: "dom-2", hostname: "shop.bakery.example", claimExpiresAt: Date.now() - 1 }),
          ],
          verified: true,
        },
      }),
    )
    expect(steps[1].done).toBe(true)
  })

  it("reports the addresses that still need a decision", () => {
    const records = [
      claim({ status: "verified" }),
      claim({ id: "dom-2", hostname: "shop.bakery.example" }),
      claim({ id: "dom-3", hostname: "old.bakery.example", status: "revoked" }),
    ]
    expect(unresolvedDomainClaims(records).map((d) => d.hostname)).toEqual(["shop.bakery.example"])
  })
})
