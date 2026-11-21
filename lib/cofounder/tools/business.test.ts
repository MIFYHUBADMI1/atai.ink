import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  listDomains: vi.fn(),
}))

// Keep the REAL toDomainView (its token gating is part of what we verify) and
// only replace the query that would hit Mongo.
vi.mock("@/lib/domain/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/domain/service")>()
  return { ...actual, listProjectDomains: mocks.listDomains }
})

import { store } from "@/lib/store/store"
import { getBusinessAssessmentTool } from "./business"
import type { ToolContext } from "../types"
import type { BusinessAssessment, BusinessDomainDoc } from "@/lib/types/business-intake"

/**
 * get_business_assessment tool tests. The tool must be read-only,
 * tenant-isolated, refuse idea-first projects honestly, return the founder's
 * assessment IN FULL, and never carry verification tokens to the model.
 */

const ctx: ToolContext = {
  user: { id: "user_1", name: "F", email: "f@example.com", emailVerified: true },
  credits: { available: 100, balance: 100, reserved: 0 },
}

const assessment: BusinessAssessment = {
  generatedAt: 100,
  evidence: { websiteAnalysed: true, pagesCrawled: 4, ownerDescription: true, domainVerified: false },
  understanding: "A neighborhood bakery selling online.",
  currentPosition: "Orders come through Instagram DMs; no checkout on the site.",
  strengths: [{ title: "Loyal locals", detail: "Repeat customers mention the sourdough.", basis: "observed", evidence: "homepage testimonials" }],
  challenges: [{ title: "No online checkout", detail: "Customers cannot pay on the site.", basis: "observed", evidence: "homepage" }],
  growthOpportunities: [],
  technicalOpportunities: [],
  marketingOpportunities: [],
  priorities: [
    {
      title: "Add online ordering",
      explanation: "Let customers order and pay on the site.",
      whyItMatters: "DM orders are lost after hours.",
      expectedOutcome: "Orders captured around the clock.",
      priority: "immediate",
      ataiSection: "Builder",
      route: "/project/proj_1/edit",
      executableNow: true,
    },
  ],
  actionPlan: [{ horizon: "immediate", items: ["Add online ordering"] }],
  openQuestions: ["Do you deliver beyond the neighborhood?"],
}

function projectFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj_1",
    userId: "user_1",
    name: "Crumb & Co",
    mode: "scratch",
    state: "created",
    startingPoint: "existing_business",
    intake: {
      collectedAt: 50,
      displayName: "Crumb & Co Bakery",
      description: "A neighborhood bakery with a small website.",
      targetCustomers: "Local families and offices",
      objectives: ["acquire_customers", "improve_website"],
      website: { status: "completed", url: "https://crumb.example.com", pagesCrawled: 4, fromCache: false },
      repo: { status: "skipped" },
      assessment: { status: "completed", generatedAt: 100, result: assessment },
    },
    ...overrides,
  }
}

const domainDoc: BusinessDomainDoc = {
  id: "dom_1",
  projectId: "proj_1",
  userId: "user_1",
  hostname: "crumb.example.com",
  registrableDomain: "example.com",
  submittedUrl: "https://crumb.example.com",
  status: "verified",
  method: "meta_tag",
  token: "SUPER-SECRET-TOKEN-VALUE",
  tokenHash: "hashhashhash",
  fileName: "atai-verification-SUPER-SECRET-TOKEN-VALUE.html",
  verifiedAt: 90,
  verifiedMethod: "meta_tag",
  createdAt: 10,
  updatedAt: 90,
}

let getProjectSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  getProjectSpy = vi.spyOn(store, "getProject").mockResolvedValue(projectFixture() as never)
  mocks.listDomains.mockResolvedValue([domainDoc])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("get_business_assessment tool", () => {
  it("is registered as a READ tool that never requires confirmation", () => {
    expect(getBusinessAssessmentTool.risk).toBe("READ")
    expect(getBusinessAssessmentTool.requiresConfirmation).toBe(false)
    expect(getBusinessAssessmentTool.prepare).toBeUndefined()
    expect(getBusinessAssessmentTool.executeApproved).toBeUndefined()
  })

  it("refers another tenant's project with the uniform access failure", async () => {
    getProjectSpy.mockResolvedValue(projectFixture({ userId: "someone_else" }) as never)
    const result = await getBusinessAssessmentTool.execute!({ projectId: "proj_1" }, ctx)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe("UNAUTHORIZED_PROJECT_ACCESS")
    expect(mocks.listDomains).not.toHaveBeenCalled()
  })

  it("refers a missing project the same way (no existence leak)", async () => {
    getProjectSpy.mockResolvedValue(null as never)
    const result = await getBusinessAssessmentTool.execute!({ projectId: "nope" }, ctx)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe("UNAUTHORIZED_PROJECT_ACCESS")
  })

  it("ignores a model-supplied userId — ownership comes from the session only", async () => {
    getProjectSpy.mockResolvedValue(projectFixture({ userId: "victim" }) as never)
    const result = await getBusinessAssessmentTool.execute!({ projectId: "proj_1", userId: "victim" }, ctx)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe("UNAUTHORIZED_PROJECT_ACCESS")
  })

  it("refuses an idea-first project honestly and points at get_plan", async () => {
    getProjectSpy.mockResolvedValue(projectFixture({ startingPoint: undefined, intake: undefined }) as never)
    const result = await getBusinessAssessmentTool.execute!({ projectId: "proj_1" }, ctx)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe("NOT_EXISTING_BUSINESS")
      expect(result.error.message).toContain("get_plan")
    }
    expect(mocks.listDomains).not.toHaveBeenCalled()
  })

  it("returns the full assessment verbatim with a business navigation target", async () => {
    const result = await getBusinessAssessmentTool.execute!({ projectId: "proj_1" }, ctx)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.type).toBe("business_assessment")
      expect(result.navigation).toEqual({ target: "business", projectId: "proj_1" })
      const data = result.data as { intake: { assessment: { result: BusinessAssessment } } }
      expect(data.intake.assessment.result).toEqual(assessment)
    }
  })

  it("reports the website states and the connection state distinctly", async () => {
    const result = await getBusinessAssessmentTool.execute!({ projectId: "proj_1" }, ctx)
    expect(result.success).toBe(true)
    if (result.success) {
      const intake = (result.data as {
        intake: { website: Record<string, unknown>; connection: Record<string, unknown> }
      }).intake
      expect(intake.website.submitted).toBe(true)
      expect(intake.website.analyzed).toBe(true)
      expect(intake.website.pagesCrawled).toBe(4)
      expect(intake.connection.status).toBe("not_connected")
      expect(intake).not.toHaveProperty("repository")
    }
  })

  it("never carries verification tokens, snippets or file names to the model", async () => {
    const result = await getBusinessAssessmentTool.execute!({ projectId: "proj_1" }, ctx)
    expect(result.success).toBe(true)
    if (result.success) {
      const serialized = JSON.stringify(result.data)
      expect(serialized).not.toContain("SUPER-SECRET-TOKEN-VALUE")
      expect(serialized).not.toContain("hashhashhash")
      const domains = (result.data as { domains: Array<Record<string, unknown>> }).domains
      expect(domains[0]).toEqual({
        hostname: "crumb.example.com",
        status: "verified",
        method: "meta_tag",
        verifiedAt: 90,
        needsAttention: false,
      })
    }
  })

  it("serves an honest empty state when intake has not run yet", async () => {
    getProjectSpy.mockResolvedValue(projectFixture({ intake: undefined }) as never)
    mocks.listDomains.mockResolvedValue([])
    const result = await getBusinessAssessmentTool.execute!({ projectId: "proj_1" }, ctx)
    expect(result.success).toBe(true)
    if (result.success) {
      const intake = (result.data as { intake: { assessment: { status: string; result: unknown }; website: { status: string } } }).intake
      expect(intake.assessment.status).toBe("pending")
      expect(intake.assessment.result).toBeNull()
      expect(intake.website.status).toBe("skipped")
    }
  })

  it("surfaces a stage error only while the stage is actually failed", async () => {
    getProjectSpy.mockResolvedValue(
      projectFixture({
        intake: {
          ...projectFixture().intake,
          website: {
            status: "failed",
            url: "https://crumb.example.com",
            errorCode: "WEBSITE_UNREACHABLE",
            errorMessage: "We couldn't reach that website.",
          },
        },
      }) as never,
    )
    const result = await getBusinessAssessmentTool.execute!({ projectId: "proj_1" }, ctx)
    expect(result.success).toBe(true)
    if (result.success) {
      const website = (result.data as { intake: { website: { analyzed: boolean; error?: { code: string } } } }).intake.website
      expect(website.analyzed).toBe(false)
      expect(website.error?.code).toBe("WEBSITE_UNREACHABLE")
    }
  })

  it("clears a stale error once the stage later succeeded", async () => {
    getProjectSpy.mockResolvedValue(
      projectFixture({
        intake: {
          ...projectFixture().intake,
          website: {
            status: "completed",
            url: "https://crumb.example.com",
            pagesCrawled: 4,
            errorCode: "WEBSITE_UNREACHABLE",
            errorMessage: "Old failure.",
          },
        },
      }) as never,
    )
    const result = await getBusinessAssessmentTool.execute!({ projectId: "proj_1" }, ctx)
    expect(result.success).toBe(true)
    if (result.success) {
      const website = (result.data as { intake: { website: { error?: unknown } } }).intake.website
      expect(website.error).toBeUndefined()
    }
  })

  it("wraps unexpected failures without leaking internals", async () => {
    mocks.listDomains.mockRejectedValue(new Error("boom internal stack"))
    const result = await getBusinessAssessmentTool.execute!({ projectId: "proj_1" }, ctx)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe("UNKNOWN")
      expect(result.error.message).not.toContain("boom")
    }
  })
})