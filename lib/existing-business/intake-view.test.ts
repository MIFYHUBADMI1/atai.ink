import { describe, expect, it } from "vitest"

import { completeAssessmentResult, completeIntakeView } from "./intake-view"

describe("completeIntakeView", () => {
  it("turns an empty payload into a full, renderable view", () => {
    const view = completeIntakeView({})

    expect(view.startingPoint).toBe("from_scratch")
    expect(view.objectives).toEqual([])
    expect(view.overall).toBe("pending")
    expect(view.website).toEqual({ submitted: false, analyzed: false, status: "skipped" })
    expect(view.claim).toEqual({ state: "unclaimed" })
    expect(view.domain).toEqual({ records: [], verified: false })
    expect(view.connection).toEqual({ status: "not_connected", label: "Not connected" })
    expect(view.assessment).toEqual({ status: "pending" })
  })

  it("fills a partial assessment result so the report never reads undefined", () => {
    const view = completeIntakeView({
      assessment: { status: "completed", result: { understanding: "A bakery." } },
    })

    const result = view.assessment.result
    expect(result?.understanding).toBe("A bakery.")
    expect(result?.strengths).toEqual([])
    expect(result?.priorities).toEqual([])
    expect(result?.actionPlan).toEqual([])
    expect(result?.evidence).toEqual({
      websiteAnalysed: false,
      pagesCrawled: 0,
      ownerDescription: false,
      domainVerified: false,
    })
  })

  it("coerces unknown statuses to the neutral value instead of crashing the rail", () => {
    const view = completeIntakeView({
      overall: "not-a-status",
      website: { status: "also-not-a-status" },
      connection: { status: "weird", label: 42 },
    })

    expect(view.overall).toBe("pending")
    expect(view.website.status).toBe("skipped")
    expect(view.connection.status).toBe("not_connected")
    expect(view.connection.label).toBe("Not connected")
  })

  it("drops malformed objectives and domain rows but keeps valid ones", () => {
    const view = completeIntakeView({
      objectives: [{ id: "sales", label: "Sell online" }, { label: "no id" }, "nope"],
      domain: {
        records: [{ id: "d1", hostname: "bakery.example" }, { hostname: "no-id.example" }, null],
      },
    })

    expect(view.objectives).toEqual([{ id: "sales", label: "Sell online" }])
    expect(view.domain.records).toHaveLength(1)
    expect(view.domain.records[0].id).toBe("d1")
  })

  it("is idempotent on a complete view", () => {
    const complete = completeIntakeView({
      startingPoint: "existing_business",
      displayName: "Corner Bakery",
      objectives: [{ id: "sales", label: "Sell online" }],
      overall: "completed",
      website: { submitted: true, analyzed: true, url: "https://bakery.example", pagesCrawled: 3, status: "completed" },
      claim: { state: "yours", hostname: "bakery.example" },
      domain: { hostname: "bakery.example", records: [], verified: true },
      connection: { status: "verified", label: "Connected", firstSeenAt: 1, lastSeenAt: 2 },
      assessment: {
        status: "completed",
        generatedAt: 5,
        result: {
          generatedAt: 5,
          evidence: { websiteAnalysed: true, pagesCrawled: 3, ownerDescription: true, domainVerified: true },
          understanding: "A bakery.",
          currentPosition: "No ordering.",
          strengths: [],
          challenges: [],
          growthOpportunities: [],
          technicalOpportunities: [],
          marketingOpportunities: [],
          priorities: [],
          actionPlan: [],
          openQuestions: [],
        },
      },
    })

    expect(completeIntakeView(complete)).toEqual(complete)
  })
})

describe("completeAssessmentResult", () => {
  it("returns undefined for a non-object", () => {
    expect(completeAssessmentResult(null)).toBeUndefined()
    expect(completeAssessmentResult("nope")).toBeUndefined()
  })
})
