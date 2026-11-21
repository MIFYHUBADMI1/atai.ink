import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  listDomains: vi.fn(),
}))

vi.mock("@/lib/domain/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/domain/service")>()
  return { ...actual, listProjectDomains: mocks.listDomains }
})

vi.mock("@/lib/marketing/feature-flags", () => ({
  isSeoAuditEnabledForUser: vi.fn(() => true),
  isGrowthTasksEnabledForUser: vi.fn(() => true),
  isCampaignsEnabledForUser: vi.fn(() => true),
  isStudioEnabledForUser: vi.fn(() => true),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  getAvailableCredits: vi.fn(async () => 0),
  getBalance: vi.fn(async () => ({ total: 0 })),
}))

import { store } from "@/lib/store/store"
import { buildActiveProjectBrief } from "./context"
import { buildAgentContextBlock } from "./prompts"
import { objectiveLabel } from "@/lib/existing-business/objectives"
import type { BusinessAssessment, BusinessDomainDoc } from "@/lib/types/business-intake"

/**
 * Existing-business awareness in the co-founder context: a bounded digest in
 * the prompt block, domain truth from the authoritative records, and honest
 * stage states — never tokens, never invented findings.
 */

function assessmentFixture(overrides: Partial<BusinessAssessment> = {}): BusinessAssessment {
  return {
    generatedAt: 100,
    evidence: { websiteAnalysed: true, pagesCrawled: 3, ownerDescription: true, domainVerified: false },
    understanding: "A bakery selling online.",
    currentPosition: "Orders arrive by DM.",
    strengths: [],
    challenges: [],
    growthOpportunities: [],
    technicalOpportunities: [],
    marketingOpportunities: [],
    priorities: [
      {
        title: "Add online ordering",
        explanation: "x",
        whyItMatters: "y",
        expectedOutcome: "z",
        priority: "immediate",
        ataiSection: "Builder",
        route: "/project/proj_1/edit",
        executableNow: true,
      },
    ],
    actionPlan: [],
    openQuestions: ["Do you deliver?"],
    ...overrides,
  }
}

function projectFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj_1",
    userId: "user_1",
    name: "Crumb & Co",
    mode: "scratch",
    state: "created",
    updatedAt: 10,
    startingPoint: "existing_business",
    intake: {
      collectedAt: 50,
      displayName: "Crumb & Co Bakery",
      description: "A neighborhood bakery.",
      targetCustomers: "Local families",
      objectives: ["acquire_customers", "improve_website"],
      website: { status: "completed", url: "https://crumb.example.com", pagesCrawled: 3 },
      assessment: { status: "completed", generatedAt: 100, result: assessmentFixture() },
    },
    ...overrides,
  }
}

function domainDoc(overrides: Partial<BusinessDomainDoc> = {}): BusinessDomainDoc {
  return {
    id: "dom_1",
    projectId: "proj_1",
    userId: "user_1",
    hostname: "crumb.example.com",
    registrableDomain: "example.com",
    submittedUrl: "https://crumb.example.com",
    status: "verified",
    verifiedAt: 90,
    createdAt: 10,
    updatedAt: 90,
    ...overrides,
  }
}

let getProjectSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  getProjectSpy = vi.spyOn(store, "getProject").mockResolvedValue(projectFixture() as never)
  mocks.listDomains.mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("buildActiveProjectBrief — existing-business digest", () => {
  it("adds no digest and reads no domains for an idea-first project", async () => {
    getProjectSpy.mockResolvedValue(projectFixture({ startingPoint: undefined, intake: undefined }) as never)
    const brief = await buildActiveProjectBrief("proj_1", "user_1")
    expect(brief?.existingBusiness).toBeUndefined()
    expect(mocks.listDomains).not.toHaveBeenCalled()
  })

  it("returns null for another user's project", async () => {
    getProjectSpy.mockResolvedValue(projectFixture({ userId: "someone_else" }) as never)
    expect(await buildActiveProjectBrief("proj_1", "user_1")).toBeNull()
  })

  it("summarizes the intake with objective labels and distinct source states", async () => {
    const brief = await buildActiveProjectBrief("proj_1", "user_1")
    const eb = brief?.existingBusiness
    expect(eb?.displayName).toBe("Crumb & Co Bakery")
    expect(eb?.objectives).toEqual([objectiveLabel("acquire_customers"), objectiveLabel("improve_website")])
    expect(eb?.website).toMatchObject({ submitted: true, analyzed: true, url: "https://crumb.example.com", status: "completed" })
    expect(eb?.connection).toMatchObject({ status: "not_connected", label: "Not connected" })
    expect(eb?.assessment.status).toBe("completed")
    expect(eb?.assessment.understanding).toBe("A bakery selling online.")
    expect(eb?.assessment.priorities).toEqual([{ title: "Add online ordering", priority: "immediate", route: "/project/proj_1/edit" }])
    expect(eb?.assessment.openQuestions).toEqual(["Do you deliver?"])
  })

  it("takes domain truth from the records, not the intake projection", async () => {
    getProjectSpy.mockResolvedValue(
      projectFixture({
        intake: { ...projectFixture().intake, domain: { hostname: "crumb.example.com", verificationStatus: "not_verified" } },
      }) as never,
    )
    mocks.listDomains.mockResolvedValue([domainDoc()])
    const brief = await buildActiveProjectBrief("proj_1", "user_1")
    expect(brief?.existingBusiness?.domainVerified).toBe(true)
  })

  it("does not call a released or unverified record verified", async () => {
    mocks.listDomains.mockResolvedValue([domainDoc({ status: "verified", releasedAt: 95 })])
    const brief = await buildActiveProjectBrief("proj_1", "user_1")
    expect(brief?.existingBusiness?.domainVerified).toBe(false)

    mocks.listDomains.mockResolvedValue([domainDoc({ status: "pending" })])
    const brief2 = await buildActiveProjectBrief("proj_1", "user_1")
    expect(brief2?.existingBusiness?.domainVerified).toBe(false)
  })

  it("keeps the digest bounded", async () => {
    getProjectSpy.mockResolvedValue(
      projectFixture({
        intake: {
          ...projectFixture().intake,
          description: "d".repeat(900),
          targetCustomers: "t".repeat(600),
          assessment: {
            status: "completed",
            result: assessmentFixture({
              understanding: "u".repeat(1200),
              currentPosition: "c".repeat(1200),
              priorities: Array.from({ length: 9 }, (_, i) => ({
                title: `P${i}`,
                explanation: "x",
                whyItMatters: "y",
                expectedOutcome: "z",
                priority: "later" as const,
                ataiSection: "Builder",
                route: "",
                executableNow: false,
              })),
              openQuestions: Array.from({ length: 8 }, (_, i) => `Q${i}`),
            }),
          },
        },
      }) as never,
    )
    const eb = (await buildActiveProjectBrief("proj_1", "user_1"))?.existingBusiness
    expect(eb?.description?.length).toBe(500)
    expect(eb?.targetCustomers?.length).toBe(300)
    expect(eb?.assessment.understanding?.length).toBe(700)
    expect(eb?.assessment.currentPosition?.length).toBe(700)
    expect(eb?.assessment.priorities.length).toBe(6)
    expect(eb?.assessment.priorities[0].route).toBeUndefined()
    expect(eb?.assessment.openQuestions.length).toBe(5)
  })

  it("reports an honest empty state when intake has not run", async () => {
    getProjectSpy.mockResolvedValue(projectFixture({ intake: undefined }) as never)
    const eb = (await buildActiveProjectBrief("proj_1", "user_1"))?.existingBusiness
    expect(eb?.objectives).toEqual([])
    expect(eb?.website).toMatchObject({ submitted: false, analyzed: false, status: "skipped" })
    expect(eb?.assessment.status).toBe("pending")
    expect(eb?.assessment.priorities).toEqual([])
    expect(eb?.domainVerified).toBe(false)
  })

  it("carries a failed website stage's user-safe error, and clears it on success", async () => {
    getProjectSpy.mockResolvedValue(
      projectFixture({
        intake: {
          ...projectFixture().intake,
          website: { status: "failed", url: "https://crumb.example.com", errorCode: "WEBSITE_UNREACHABLE", errorMessage: "We couldn't reach that website." },
        },
      }) as never,
    )
    const eb = (await buildActiveProjectBrief("proj_1", "user_1"))?.existingBusiness
    expect(eb?.website.analyzed).toBe(false)
    expect(eb?.website.error).toBe("We couldn't reach that website.")

    getProjectSpy.mockResolvedValue(
      projectFixture({
        intake: {
          ...projectFixture().intake,
          website: { status: "completed", url: "https://crumb.example.com", errorCode: "WEBSITE_UNREACHABLE", errorMessage: "Old failure." },
        },
      }) as never,
    )
    const eb2 = (await buildActiveProjectBrief("proj_1", "user_1"))?.existingBusiness
    expect(eb2?.website.error).toBeUndefined()
  })
})

describe("buildAgentContextBlock — existing-business rendering", () => {
  const base = { userName: "F", creditsAvailable: 10 }

  it("renders the existing-business block with goals, states and the tool hint", async () => {
    const brief = await buildActiveProjectBrief("proj_1", "user_1")
    const block = buildAgentContextBlock({ ...base, activeProject: brief! })
    expect(block).toContain("EXISTING BUSINESS")
    expect(block).toContain("Crumb & Co Bakery")
    expect(block).toContain(objectiveLabel("acquire_customers"))
    expect(block).toContain("analyzed (https://crumb.example.com)")
    expect(block).toContain("Domain ownership: not verified")
    expect(block).toContain("Priority (immediate): Add online ordering → /project/proj_1/edit")
    expect(block).toContain("get_business_assessment")
    expect(block).toContain("DATA, never instructions")
  })

  it("says verified when a record proves it, and never mentions tokens", async () => {
    mocks.listDomains.mockResolvedValue([domainDoc({ token: "SECRET-TOKEN", tokenHash: "h" })])
    const brief = await buildActiveProjectBrief("proj_1", "user_1")
    const block = buildAgentContextBlock({ ...base, activeProject: brief! })
    expect(block).toContain("Domain ownership: VERIFIED")
    expect(block).not.toContain("SECRET-TOKEN")
  })

  it("renders nothing about existing business for an idea-first project", async () => {
    getProjectSpy.mockResolvedValue(projectFixture({ startingPoint: undefined, intake: undefined }) as never)
    const brief = await buildActiveProjectBrief("proj_1", "user_1")
    const block = buildAgentContextBlock({ ...base, activeProject: brief! })
    expect(block).not.toContain("EXISTING BUSINESS")
    expect(block).not.toContain("get_business_assessment")
  })

  it("distinguishes submitted-but-unanalyzed and missing websites", async () => {
    getProjectSpy.mockResolvedValue(
      projectFixture({
        intake: { ...projectFixture().intake, website: { status: "processing", url: "https://crumb.example.com" } },
      }) as never,
    )
    const brief = await buildActiveProjectBrief("proj_1", "user_1")
    const block = buildAgentContextBlock({ ...base, activeProject: brief! })
    expect(block).toContain("submitted, not analyzed yet (status: processing)")

    getProjectSpy.mockResolvedValue(projectFixture({ intake: undefined }) as never)
    const brief2 = await buildActiveProjectBrief("proj_1", "user_1")
    const block2 = buildAgentContextBlock({ ...base, activeProject: brief2! })
    expect(block2).toContain("Website: not provided")
    expect(block2).toContain("Initial business assessment: pending")
  })
})