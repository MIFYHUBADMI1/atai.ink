import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TotalumError } from "@/lib/integrations/totalum/errors"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  updateProject: vi.fn(),
  claimBuildSlot: vi.fn(),
  createBuildRun: vi.fn(),
  updateBuildRun: vi.fn(),
  appendEvent: vi.fn(),
  cryptoId: vi.fn(() => "run-1"),
  launchProject: vi.fn(),
  isProjectIdAvailable: vi.fn(),
  isTotalumConfigured: vi.fn(),
  initializeProjectInfrastructure: vi.fn(),
  getInfrastructurePlan: vi.fn(),
  reserveCredits: vi.fn(),
  refundReservation: vi.fn(),
  getTierCost: vi.fn(),
  classifyComplexity: vi.fn(),
  hasSufficientCredits: vi.fn(),
  buildInitialBuildPrompt: vi.fn(() => "build brief"),
}))

vi.mock("@/lib/store/store", () => ({
  store: {
    getProject: mocks.getProject,
    updateProject: mocks.updateProject,
    claimBuildSlot: mocks.claimBuildSlot,
    createBuildRun: mocks.createBuildRun,
    updateBuildRun: mocks.updateBuildRun,
    appendEvent: mocks.appendEvent,
  },
  cryptoId: mocks.cryptoId,
}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock("@/lib/integrations/firecrawl/service", () => ({
  crawlWebsite: vi.fn(),
  crawlWebsiteDeep: vi.fn(),
  isFirecrawlConfigured: vi.fn(() => false),
}))
vi.mock("@/lib/integrations/totalum/service", () => ({
  launchProject: mocks.launchProject,
  isProjectIdAvailable: mocks.isProjectIdAvailable,
  isTotalumConfigured: mocks.isTotalumConfigured,
}))
vi.mock("@/lib/infrastructure/service", () => ({
  initializeProjectInfrastructure: mocks.initializeProjectInfrastructure,
}))
vi.mock("@/lib/infrastructure/plans", () => ({
  getInfrastructurePlan: mocks.getInfrastructurePlan.mockReturnValue({ totalumInfrastructureCredits: 5 }),
}))
vi.mock("@/lib/credits/credits", () => ({
  chargeScrapeCredits: vi.fn(),
  chargePlanCredits: vi.fn(),
  chargeDeepCrawlCredits: vi.fn(),
  reserveCredits: mocks.reserveCredits,
  refundReservation: mocks.refundReservation,
  getTierCost: mocks.getTierCost.mockResolvedValue(1000),
  classifyComplexity: mocks.classifyComplexity.mockReturnValue("medium"),
  hasSufficientCredits: mocks.hasSufficientCredits,
  getScrapeCost: vi.fn(),
  getDeepCrawlCost: vi.fn(),
}))
vi.mock("@/lib/analysis/prompt-builder", () => ({
  buildInitialBuildPrompt: mocks.buildInitialBuildPrompt,
}))
vi.mock("@/lib/analysis/understanding", () => ({ analyzeWebsite: vi.fn() }))
vi.mock("@/lib/analysis/specification", () => ({
  generateSpecificationFromUnderstanding: vi.fn(),
  generateSpecificationFromIdea: vi.fn(),
}))
vi.mock("@/lib/projects/ai-artifacts", () => ({ recordAIArtifacts: vi.fn() }))
vi.mock("@/lib/credits/credit-block", () => ({ recordCreditBlock: vi.fn() }))

import { autoLaunchBuild } from "./pipeline"

const PROJECT_ID = "project-launch"
const USER_ID = "owner-launch"
const REQUESTED_ID = "my-app"

function makeProject() {
  return {
    id: PROJECT_ID,
    userId: USER_ID,
    state: "plan_ready",
    requestedProjectId: REQUESTED_ID,
    pipelineMode: "heavy",
    specification: { complexity: "medium" },
  }
}

describe("autoLaunchBuild — ambiguous launch reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mocks.getProject.mockResolvedValue(makeProject())
    mocks.isTotalumConfigured.mockReturnValue(true)
    mocks.claimBuildSlot.mockResolvedValue(true)
    mocks.hasSufficientCredits.mockResolvedValue(true)
    mocks.createBuildRun.mockResolvedValue({})
    mocks.updateBuildRun.mockResolvedValue({})
    mocks.updateProject.mockResolvedValue({})
    mocks.appendEvent.mockResolvedValue({})
    mocks.reserveCredits.mockResolvedValue(true)
    mocks.refundReservation.mockResolvedValue(true)
    mocks.initializeProjectInfrastructure.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("treats a timed-out launch as success when Totalum has the project", async () => {
    mocks.launchProject.mockRejectedValueOnce(new TotalumError("SERVER_NOT_READY", "timeout"))
    mocks.isProjectIdAvailable.mockResolvedValue(false)

    await autoLaunchBuild(PROJECT_ID)

    expect(mocks.isProjectIdAvailable).toHaveBeenCalledWith(REQUESTED_ID)
    expect(mocks.updateBuildRun).toHaveBeenCalledWith("run-1", {
      status: "running",
      totalumProjectId: REQUESTED_ID,
    })
    expect(mocks.updateProject).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ state: "building", totalumProjectId: REQUESTED_ID }),
    )
    expect(mocks.refundReservation).not.toHaveBeenCalled()
    expect(mocks.reserveCredits).toHaveBeenCalledTimes(1)
  })

  it("recovers from a non-Totalum launch throw when Totalum has the project", async () => {
    mocks.launchProject.mockRejectedValueOnce(new SyntaxError("Unexpected token < in JSON"))
    mocks.isProjectIdAvailable.mockResolvedValue(false)

    await autoLaunchBuild(PROJECT_ID)

    expect(mocks.updateBuildRun).toHaveBeenCalledWith("run-1", {
      status: "running",
      totalumProjectId: REQUESTED_ID,
    })
    expect(mocks.refundReservation).not.toHaveBeenCalled()
  })

  it("refunds only after Totalum confirms the launch never landed", async () => {
    vi.useFakeTimers()
    mocks.launchProject.mockRejectedValueOnce(new TotalumError("SERVER_NOT_READY", "timeout"))
    // Totalum answers "not found" on every poll — the launch never landed.
    mocks.isProjectIdAvailable.mockResolvedValue(true)

    const pending = autoLaunchBuild(PROJECT_ID)
    await vi.waitFor(() => expect(mocks.isProjectIdAvailable).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(2_000)
    await pending

    expect(mocks.isProjectIdAvailable).toHaveBeenCalledTimes(2)
    expect(mocks.refundReservation).toHaveBeenCalledWith(USER_ID, 1000, "run-1", PROJECT_ID)
    expect(mocks.updateBuildRun).toHaveBeenCalledWith("run-1", {
      status: "failed",
      error: "timeout",
    })
    expect(mocks.updateProject).toHaveBeenCalledWith(PROJECT_ID, { state: "plan_ready" })
  })

  it("does not reconcile a definite Totalum rejection", async () => {
    mocks.launchProject.mockRejectedValueOnce(new TotalumError("RATE_LIMIT_EXCEEDED", "rate limited", 429))

    await autoLaunchBuild(PROJECT_ID)

    expect(mocks.isProjectIdAvailable).not.toHaveBeenCalled()
    expect(mocks.refundReservation).toHaveBeenCalled()
    expect(mocks.updateBuildRun).toHaveBeenCalledWith("run-1", { status: "failed", error: "rate limited" })
  })
})
