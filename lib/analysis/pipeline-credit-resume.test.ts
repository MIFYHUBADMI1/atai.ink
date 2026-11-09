import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MirrorProject } from "@/lib/types/project"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  claimBuildSlot: vi.fn(),
  updateProject: vi.fn(),
  createBuildRun: vi.fn(),
  updateBuildRun: vi.fn(),
  appendEvent: vi.fn(),
  getTierCost: vi.fn(),
  classifyComplexity: vi.fn(),
  hasSufficientCredits: vi.fn(),
  reserveCredits: vi.fn(),
  refundReservation: vi.fn(),
  recordCreditBlock: vi.fn(),
  isTotalumConfigured: vi.fn(),
  launchProject: vi.fn(),
  isProjectIdAvailable: vi.fn(),
  buildInitialBuildPrompt: vi.fn(),
  initializeProjectInfrastructure: vi.fn(),
}))

vi.mock("@/lib/store/store", () => ({
  cryptoId: vi.fn(() => "build-run"),
  store: {
    getProject: mocks.getProject,
    claimBuildSlot: mocks.claimBuildSlot,
    updateProject: mocks.updateProject,
    createBuildRun: mocks.createBuildRun,
    updateBuildRun: mocks.updateBuildRun,
    appendEvent: mocks.appendEvent,
  },
}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/credits/credits", () => ({
  getTierCost: mocks.getTierCost,
  classifyComplexity: mocks.classifyComplexity,
  hasSufficientCredits: mocks.hasSufficientCredits,
  reserveCredits: mocks.reserveCredits,
  refundReservation: mocks.refundReservation,
  chargeScrapeCredits: vi.fn(),
  chargePlanCredits: vi.fn(),
  chargeDeepCrawlCredits: vi.fn(),
  getScrapeCost: vi.fn(),
  getDeepCrawlCost: vi.fn(),
}))
vi.mock("@/lib/credits/credit-block", () => ({ recordCreditBlock: mocks.recordCreditBlock }))
vi.mock("@/lib/integrations/totalum/service", () => ({
  isTotalumConfigured: mocks.isTotalumConfigured,
  launchProject: mocks.launchProject,
  isProjectIdAvailable: mocks.isProjectIdAvailable,
}))
vi.mock("@/lib/infrastructure/service", () => ({
  initializeProjectInfrastructure: mocks.initializeProjectInfrastructure,
}))
vi.mock("@/lib/infrastructure/plans", () => ({
  getInfrastructurePlan: vi.fn(() => ({ totalumInfrastructureCredits: 5 })),
}))
vi.mock("@/lib/integrations/firecrawl/service", () => ({
  crawlWebsite: vi.fn(), crawlWebsiteDeep: vi.fn(), isFirecrawlConfigured: vi.fn(),
}))
vi.mock("@/lib/analysis/prompt-builder", () => ({ buildInitialBuildPrompt: mocks.buildInitialBuildPrompt }))
vi.mock("@/lib/analysis/understanding", () => ({ analyzeWebsite: vi.fn() }))
vi.mock("@/lib/analysis/specification", () => ({
  generateSpecificationFromUnderstanding: vi.fn(), generateSpecificationFromIdea: vi.fn(),
}))
vi.mock("@/lib/projects/ai-artifacts", () => ({ recordAIArtifacts: vi.fn() }))
vi.mock("@/lib/types/ai-artifacts", () => ({
  makeAIArtifact: vi.fn(), rawTextFromError: vi.fn(), stageFromError: vi.fn(),
}))

import { autoLaunchBuild } from "./pipeline"

type BuildProject = Pick<MirrorProject,
  "id" | "userId" | "state" | "specification" | "requestedProjectId" |
  "pipelineMode" | "creditBlock" | "preferences" | "idea"
>

function makeProject(overrides: Partial<BuildProject> = {}): BuildProject {
  return {
    id: "project-build",
    userId: "owner-build",
    state: "awaiting_build_confirmation",
    requestedProjectId: "build-app",
    pipelineMode: "heavy",
    creditBlock: { required: 4500, available: 0, action: "your build", at: 1, resume: "build" },
    preferences: { appName: "Build App" },
    idea: "A dog-walking marketplace in Berlin with verified walkers.",
    specification: {
      applicationType: "marketplace",
      title: "Build App",
      description: "A ready application plan.",
      purpose: "Exercise credit resumes.",
      targetUsers: [],
      userRoles: [],
      suggestedFeatures: [],
      dataEntities: [],
      coreFlows: [],
      backendRequirements: [],
      integrations: [],
      additionalInstructions: "",
      complexity: "medium",
    },
    ...overrides,
  }
}

function expectBuildClaim() {
  expect(mocks.claimBuildSlot).toHaveBeenCalledWith(
    "project-build", { state: "building" }, ["plan_ready", "awaiting_build_confirmation"],
  )
}

function expectCreditBlockRecorded() {
  expect(mocks.recordCreditBlock).toHaveBeenCalledExactlyOnceWith(
    "project-build", "owner-build", { required: 4500, action: "your build", resume: "build" },
  )
}

describe("autoLaunchBuild — credit resume and atomic slot ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.getProject.mockResolvedValue(makeProject())
    mocks.claimBuildSlot.mockResolvedValue({ ...makeProject(), state: "building" })
    mocks.isTotalumConfigured.mockReturnValue(true)
    mocks.getTierCost.mockImplementation(async (_tier, mode) => mode === "heavy" ? 4500 : 1200)
    mocks.classifyComplexity.mockReturnValue("medium")
    mocks.hasSufficientCredits.mockResolvedValue(true)
    mocks.reserveCredits.mockResolvedValue(true)
    mocks.refundReservation.mockResolvedValue(undefined)
    mocks.recordCreditBlock.mockResolvedValue(undefined)
    mocks.launchProject.mockResolvedValue({ projectId: "build-app" })
    mocks.buildInitialBuildPrompt.mockReturnValue("the complete build prompt")
    mocks.initializeProjectInfrastructure.mockResolvedValue(undefined)
    mocks.updateProject.mockResolvedValue(undefined)
    mocks.createBuildRun.mockResolvedValue(undefined)
    mocks.updateBuildRun.mockResolvedValue(undefined)
    mocks.appendEvent.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(["plan_ready", "awaiting_build_confirmation"] as const)(
    "claims %s before checking affordability or reserving credits",
    async (state) => {
      mocks.getProject.mockResolvedValue(makeProject({ state }))

      await autoLaunchBuild("project-build")

      expectBuildClaim()
      expect(mocks.claimBuildSlot).toHaveBeenCalledTimes(1)
      expect(mocks.hasSufficientCredits).toHaveBeenCalledExactlyOnceWith("owner-build", 4500)
      expect(mocks.claimBuildSlot.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.hasSufficientCredits.mock.invocationCallOrder[0],
      )
      expect(mocks.claimBuildSlot.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.reserveCredits.mock.invocationCallOrder[0],
      )
    },
  )

  it("does nothing to credits, runs, or project state when the build-slot claim loses", async () => {
    mocks.claimBuildSlot.mockResolvedValue(null)
    mocks.hasSufficientCredits.mockResolvedValue(false)

    await autoLaunchBuild("project-build")

    expectBuildClaim()
    expect(mocks.hasSufficientCredits).not.toHaveBeenCalled()
    expect(mocks.reserveCredits).not.toHaveBeenCalled()
    expect(mocks.refundReservation).not.toHaveBeenCalled()
    expect(mocks.recordCreditBlock).not.toHaveBeenCalled()
    expect(mocks.createBuildRun).not.toHaveBeenCalled()
    expect(mocks.updateBuildRun).not.toHaveBeenCalled()
    expect(mocks.launchProject).not.toHaveBeenCalled()
    expect(mocks.updateProject).not.toHaveBeenCalled()
    expect(mocks.appendEvent).not.toHaveBeenCalled()
  })

  it.each([
    { mode: "heavy", cost: 4500, label: "Heavy Mode" },
    { mode: "legacy", cost: 1200, label: "Legacy" },
    { mode: undefined, cost: 1200, label: "Legacy" },
  ] as const)("preserves $mode pricing and reservation metadata on a paid resume", async ({ mode, cost, label }) => {
    const project = makeProject({ pipelineMode: mode })
    mocks.getProject.mockResolvedValue(project)

    await autoLaunchBuild("project-build")

    expect(mocks.getTierCost).toHaveBeenCalledExactlyOnceWith("medium", mode ?? "legacy")
    expect(mocks.classifyComplexity).not.toHaveBeenCalled()
    expect(mocks.hasSufficientCredits).toHaveBeenCalledExactlyOnceWith("owner-build", cost)
    expect(mocks.createBuildRun).toHaveBeenCalledWith(expect.objectContaining({
      id: "build-run", userId: "owner-build", mirrorProjectId: "project-build",
      kind: "initial", status: "reserved", creditsReserved: cost,
    }))
    expect(mocks.reserveCredits).toHaveBeenCalledExactlyOnceWith(
      "owner-build", cost, "build-run", `Medium application build (${label})`, "project-build",
    )
    expect(mocks.buildInitialBuildPrompt).toHaveBeenCalledExactlyOnceWith(
      project.specification, undefined, project.preferences,
      "A dog-walking marketplace in Berlin with verified walkers.",
    )
    expect(mocks.launchProject).toHaveBeenCalledExactlyOnceWith({
      projectId: "build-app", prompt: "the complete build prompt", maxInfrastructureCreditsPerMonth: 5,
    })
    expect(mocks.updateProject).toHaveBeenCalledExactlyOnceWith("project-build", {
      state: "building", totalumProjectId: "build-app", creditBlock: undefined,
    })
    expect(mocks.recordCreditBlock).not.toHaveBeenCalled()
    expect(project.pipelineMode).toBe(mode)
  })

  it("classifies a plan without explicit complexity while retaining heavy-mode pricing", async () => {
    const project = makeProject()
    project.specification = { ...project.specification!, complexity: undefined }
    mocks.getProject.mockResolvedValue(project)
    mocks.classifyComplexity.mockReturnValue("complex")

    await autoLaunchBuild("project-build")

    expect(mocks.classifyComplexity).toHaveBeenCalledExactlyOnceWith(project.specification)
    expect(mocks.getTierCost).toHaveBeenCalledExactlyOnceWith("complex", "heavy")
    expect(mocks.reserveCredits).toHaveBeenCalledWith(
      "owner-build", 4500, "build-run", "Complex application build (Heavy Mode)", "project-build",
    )
  })

  it("resets unaffordable claimed builds to plan_ready and records a resumable block without reserving", async () => {
    mocks.hasSufficientCredits.mockResolvedValue(false)

    await autoLaunchBuild("project-build")

    expectBuildClaim()
    expect(mocks.claimBuildSlot.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.hasSufficientCredits.mock.invocationCallOrder[0],
    )
    expect(mocks.updateProject).toHaveBeenCalledExactlyOnceWith("project-build", { state: "plan_ready" })
    expectCreditBlockRecorded()
    expect(mocks.updateProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordCreditBlock.mock.invocationCallOrder[0],
    )
    expect(mocks.createBuildRun).not.toHaveBeenCalled()
    expect(mocks.reserveCredits).not.toHaveBeenCalled()
    expect(mocks.launchProject).not.toHaveBeenCalled()
    expect(mocks.refundReservation).not.toHaveBeenCalled()
  })

  it("resets a failed reservation to plan_ready, fails the run, and records a resumable block", async () => {
    mocks.reserveCredits.mockResolvedValue(false)

    await autoLaunchBuild("project-build")

    expectBuildClaim()
    expect(mocks.hasSufficientCredits).toHaveBeenCalledExactlyOnceWith("owner-build", 4500)
    expect(mocks.reserveCredits).toHaveBeenCalledTimes(1)
    expect(mocks.updateBuildRun).toHaveBeenCalledExactlyOnceWith("build-run", {
      status: "failed", error: "insufficient credits",
    })
    expect(mocks.updateProject).toHaveBeenCalledExactlyOnceWith("project-build", { state: "plan_ready" })
    expectCreditBlockRecorded()
    expect(mocks.launchProject).not.toHaveBeenCalled()
    expect(mocks.refundReservation).not.toHaveBeenCalled()
  })

  it("clears a stored credit block only after the provider launch succeeds", async () => {
    let finish!: () => void
    const providerPending = new Promise<void>((resolve) => { finish = resolve })
    mocks.launchProject.mockImplementationOnce(async () => {
      await providerPending
      return { projectId: "build-app" }
    })
    const pendingBuild = autoLaunchBuild("project-build")

    try {
      await vi.waitFor(() => expect(mocks.launchProject).toHaveBeenCalledTimes(1))
      expect(mocks.reserveCredits).toHaveBeenCalledTimes(1)
      expect(mocks.updateProject).not.toHaveBeenCalled()
      expect(mocks.updateBuildRun).not.toHaveBeenCalled()
      expect(mocks.recordCreditBlock).not.toHaveBeenCalled()
    } finally {
      finish()
    }
    await pendingBuild

    expect(mocks.updateBuildRun).toHaveBeenCalledExactlyOnceWith("build-run", {
      status: "running", totalumProjectId: "build-app",
    })
    expect(mocks.updateProject).toHaveBeenCalledExactlyOnceWith("project-build", {
      state: "building", totalumProjectId: "build-app", creditBlock: undefined,
    })
    expect(mocks.initializeProjectInfrastructure).toHaveBeenCalledExactlyOnceWith("project-build", "build-app")
  })

  it("does not clear the stored block on provider failure and refunds the reservation", async () => {
    // A generic throw is ambiguous, so the reconcile poll runs: Totalum answers
    // "not found" (project absent) both times, confirming the launch never landed.
    mocks.isProjectIdAvailable.mockResolvedValue(true)
    mocks.launchProject.mockRejectedValue(new Error("Build provider unavailable"))

    await autoLaunchBuild("project-build")

    expect(mocks.isProjectIdAvailable).toHaveBeenCalledTimes(2)
    expect(mocks.refundReservation).toHaveBeenCalledExactlyOnceWith("owner-build", 4500, "build-run", "project-build")
    expect(mocks.updateBuildRun).toHaveBeenCalledExactlyOnceWith("build-run", {
      status: "failed", error: "Build provider unavailable",
    })
    expect(mocks.updateProject).toHaveBeenCalledExactlyOnceWith("project-build", { state: "plan_ready" })
    expect(mocks.recordCreditBlock).not.toHaveBeenCalled()
    expect(mocks.initializeProjectInfrastructure).not.toHaveBeenCalled()
  }, 10_000)

  it("launches and reserves only once for concurrent callers without the loser reopening state", async () => {
    mocks.claimBuildSlot.mockResolvedValueOnce({ ...makeProject(), state: "building" }).mockResolvedValueOnce(null)

    await Promise.all([autoLaunchBuild("project-build"), autoLaunchBuild("project-build")])

    expect(mocks.claimBuildSlot).toHaveBeenCalledTimes(2)
    expectBuildClaim()
    expect(mocks.hasSufficientCredits).toHaveBeenCalledTimes(1)
    expect(mocks.createBuildRun).toHaveBeenCalledTimes(1)
    expect(mocks.reserveCredits).toHaveBeenCalledTimes(1)
    expect(mocks.launchProject).toHaveBeenCalledTimes(1)
    expect(mocks.updateProject).toHaveBeenCalledExactlyOnceWith("project-build", {
      state: "building", totalumProjectId: "build-app", creditBlock: undefined,
    })
    expect(mocks.recordCreditBlock).not.toHaveBeenCalled()
  })
})
