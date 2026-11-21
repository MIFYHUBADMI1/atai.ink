import { describe, expect, it } from "vitest"
import type { BusinessDomainDoc } from "@/lib/types/business-intake"
import type { MirrorProject } from "@/lib/types/project"
import { buildIntakeView } from "./view"

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
