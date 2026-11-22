import { describe, expect, it } from "vitest"
import type { BusinessDomainDoc } from "@/lib/types/business-intake"
import type { MirrorProject } from "@/lib/types/project"
import { buildIntakeView, readHostnameOf } from "./view"

function project(overrides: Partial<MirrorProject> = {}): MirrorProject {
  return {
    id: "proj-1",
    userId: "user-1",
    name: "Corner Bakery",
    mode: "scratch",
    startingPoint: "existing_business",
    state: "created",
    ...overrides,
  } as MirrorProject
}

function domain(overrides: Partial<BusinessDomainDoc> = {}): BusinessDomainDoc {
  return {
    id: "dom-1",
    projectId: "proj-1",
    userId: "user-1",
    hostname: "bakery.example",
    registrableDomain: "example.com",
    submittedUrl: "https://bakery.example",
    status: "verified",
    method: "meta_tag",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  } as BusinessDomainDoc
}

describe("buildIntakeView — connection state", () => {
  it("reports not_connected for a business whose app has never called", () => {
    expect(buildIntakeView(project()).connection).toMatchObject({
      status: "not_connected",
      label: "Not connected",
    })
  })

  it("stays not_connected when only the domain is proven and no key was issued", () => {
    const view = buildIntakeView(project(), [domain()])
    expect(view.connection.status).toBe("not_connected")
    expect(view.domain.verified).toBe(true)
  })

  it("waits for the app once a guide was issued and the domain is proven", () => {
    const view = buildIntakeView(project({ connection: { guideIssuedAt: 5 } } as Partial<MirrorProject>), [domain()])
    expect(view.connection.status).toBe("awaiting_app")
  })

  it("waits for the domain when the app has called but ownership is unproven", () => {
    const view = buildIntakeView(project({ connection: { firstSeenAt: 10, lastSeenAt: 20 } } as Partial<MirrorProject>))
    expect(view.connection.status).toBe("awaiting_domain")
  })

  it("is verified only when both halves are true", () => {
    const view = buildIntakeView(
      project({ connection: { firstSeenAt: 10, lastSeenAt: Date.now() } } as Partial<MirrorProject>),
      [domain()],
    )
    expect(view.connection).toMatchObject({ status: "verified", label: "Connected", firstSeenAt: 10 })
  })

  it("never exposes repository evidence on the view", () => {
    const view = buildIntakeView(project(), [domain()])
    expect(view).not.toHaveProperty("repository")
  })
})

describe("buildIntakeView — a failed stage says why", () => {
  it("carries the recorded reason alongside the sentence", () => {
    const view = buildIntakeView(
      project({
        intake: {
          collectedAt: 1,
          objectives: ["acquire_customers"],
          assessment: {
            status: "failed",
            errorCode: "ASSESSMENT_FAILED",
            errorMessage: "The co-founder could not produce a dependable assessment this time.",
            errorDetail: "test-model returned HTTP 429 — the provider is rate-limiting Atai",
          },
        },
      } as Partial<MirrorProject>),
    )

    expect(view.assessment.error).toMatchObject({
      code: "ASSESSMENT_FAILED",
      detail: "test-model returned HTTP 429 — the provider is rate-limiting Atai",
    })
  })

  it("carries the engine and the failure reason so the UI can name the engine", () => {
    const view = buildIntakeView(
      project({
        intake: {
          collectedAt: 1,
          objectives: [],
          assessment: {
            status: "failed",
            errorCode: "ASSESSMENT_FAILED",
            errorMessage: "The co-founder could not produce a dependable assessment this time.",
            errorReason: "timeout",
            engine: { tierId: "spark", tierName: "Spark", modelId: "nvidia/nemotron-3-ultra-550b-a55b:free" },
          },
        },
      } as Partial<MirrorProject>),
    )

    expect(view.assessment.engine).toEqual({
      tierId: "spark",
      tierName: "Spark",
      modelId: "nvidia/nemotron-3-ultra-550b-a55b:free",
    })
    expect(view.assessment.error).toMatchObject({ code: "ASSESSMENT_FAILED", reason: "timeout" })
  })

  it("omits the reason when the stage has none", () => {
    const view = buildIntakeView(
      project({
        intake: {
          collectedAt: 1,
          objectives: [],
          assessment: { status: "failed", errorCode: "ASSESSMENT_FAILED", errorMessage: "It failed." },
        },
      } as Partial<MirrorProject>),
    )

    expect(view.assessment.error).toEqual({ code: "ASSESSMENT_FAILED", message: "It failed." })
  })
})

describe("buildIntakeView — business claim", () => {
  it("reports an unclaimed business before anything was reserved", () => {
    expect(buildIntakeView(project()).claim).toEqual({ state: "unclaimed" })
  })

  it("reports the founder's own business once a domain record exists", () => {
    const view = buildIntakeView(project(), [domain({ status: "pending" })])
    expect(view.claim).toEqual({ hostname: "bakery.example", state: "yours" })
  })

  it("reports a business held by another account without naming the holder", () => {
    const view = buildIntakeView(
      project({
        intake: {
          collectedAt: 1,
          objectives: [],
          claim: { hostname: "bakery.example", state: "held_by_other", at: 2 },
        },
      }),
    )
    expect(view.claim).toEqual({ hostname: "bakery.example", state: "held_by_other" })
    expect(JSON.stringify(view)).not.toContain("user-2")
  })
})

describe("buildIntakeView — is the verified address the one we read?", () => {
  const read = { intake: { website: { url: "https://bakery.example", status: "completed" } } }

  it("reports the address Atai read as a hostname", () => {
    expect(readHostnameOf(project(read as Partial<MirrorProject>))).toBe("bakery.example")
    expect(readHostnameOf(project())).toBeUndefined()
  })

  it("falls back to where the read actually landed", () => {
    const project_ = project({
      intake: { website: { url: "", status: "completed", reading: { finalUrl: "https://www.bakery.example/" } } },
    } as Partial<MirrorProject>)
    expect(readHostnameOf(project_)).toBe("www.bakery.example")
  })

  it("marks the claim that is the site we read", () => {
    const view = buildIntakeView(project(read as Partial<MirrorProject>), [domain()])
    expect(view.domain.records[0]?.matchesRead).toBe(true)
  })

  it("marks a claim on another site as not the one we read", () => {
    const view = buildIntakeView(project(read as Partial<MirrorProject>), [
      domain({ id: "dom-2", hostname: "another-shop.example.net", registrableDomain: "example.net" }),
    ])
    expect(view.domain.records[0]?.matchesRead).toBe(false)
  })

  it("counts a sibling subdomain as the same site", () => {
    const view = buildIntakeView(project(read as Partial<MirrorProject>), [
      domain({ id: "dom-3", hostname: "shop.bakery.example" }),
    ])
    expect(view.domain.records[0]?.matchesRead).toBe(true)
  })

  it("says unknown when no address was read", () => {
    const view = buildIntakeView(project(), [domain()])
    expect(view.domain.records[0]?.matchesRead).toBeNull()
  })
})
