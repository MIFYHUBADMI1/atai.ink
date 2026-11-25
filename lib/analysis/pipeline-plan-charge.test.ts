import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  updateProject: vi.fn(),
  appendEvent: vi.fn(),
  generateSpecificationFromIdea: vi.fn(),
  classifyComplexity: vi.fn(),
  chargePlanCredits: vi.fn(),
  refundPlanCredits: vi.fn(),
  hasSufficientCredits: vi.fn(),
  getPlanCost: vi.fn(),
  recordCreditBlock: vi.fn(),
  getProjectAttachmentContext: vi.fn(),
  recordAIArtifacts: vi.fn(),
}))

vi.mock("@/lib/store/store", () => ({
  cryptoId: vi.fn(() => "id"),
  store: {
    getProject: mocks.getProject,
    updateProject: mocks.updateProject,
    appendEvent: mocks.appendEvent,
  },
}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock("@/lib/integrations/firecrawl/service", () => ({
  crawlWebsite: vi.fn(),
  crawlWebsiteDeep: vi.fn(),
  isFirecrawlConfigured: vi.fn(() => true),
}))
vi.mock("@/lib/integrations/totalum/service", () => ({
  launchProject: vi.fn(),
  isProjectIdAvailable: vi.fn(),
  isTotalumConfigured: vi.fn(() => false),
}))
vi.mock("@/lib/infrastructure/service", () => ({ initializeProjectInfrastructure: vi.fn() }))
vi.mock("@/lib/infrastructure/plans", () => ({ getInfrastructurePlan: vi.fn() }))
vi.mock("@/lib/credits/credits", () => ({
  chargeScrapeCredits: vi.fn(),
  chargePlanCredits: mocks.chargePlanCredits,
  refundPlanCredits: mocks.refundPlanCredits,
  chargeDeepCrawlCredits: vi.fn(),
  reserveCredits: vi.fn(),
  refundReservation: vi.fn(),
  getTierCost: vi.fn(),
  classifyComplexity: mocks.classifyComplexity,
  hasSufficientCredits: mocks.hasSufficientCredits,
  getPlanCost: mocks.getPlanCost,
  getScrapeCost: vi.fn(),
  getDeepCrawlCost: vi.fn(),
}))
vi.mock("@/lib/analysis/prompt-builder", () => ({ buildInitialBuildPrompt: vi.fn() }))
vi.mock("@/lib/analysis/understanding", () => ({ analyzeWebsite: vi.fn() }))
vi.mock("@/lib/analysis/specification", () => ({
  generateSpecificationFromUnderstanding: vi.fn(),
  generateSpecificationFromIdea: mocks.generateSpecificationFromIdea,
}))
vi.mock("@/lib/projects/ai-artifacts", () => ({ recordAIArtifacts: mocks.recordAIArtifacts }))
vi.mock("@/lib/projects/attachments", () => ({ getProjectAttachmentContext: mocks.getProjectAttachmentContext }))
vi.mock("@/lib/credits/credit-block", () => ({ recordCreditBlock: mocks.recordCreditBlock }))
vi.mock("@/lib/billing/entitlements/require", () => ({ authorizeProductionWork: vi.fn() }))
vi.mock("@/lib/types/ai-artifacts", () => ({
  makeAIArtifact: vi.fn(),
  rawTextFromError: vi.fn(() => undefined),
  stageFromError: vi.fn(),
}))

import { runScratchAnalysis } from "./pipeline"

const SPEC = { title: "Plan", complexity: "simple" }

function primeProject() {
  mocks.getProject.mockResolvedValue({ id: "p1", userId: "u1", idea: "A dog-walking marketplace." })
}

describe("runScratchAnalysis plan charging", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset()
    mocks.updateProject.mockResolvedValue(undefined)
    mocks.appendEvent.mockResolvedValue(undefined)
    mocks.recordAIArtifacts.mockResolvedValue(undefined)
    mocks.recordCreditBlock.mockResolvedValue(undefined)
    mocks.refundPlanCredits.mockResolvedValue(undefined)
    mocks.getProjectAttachmentContext.mockResolvedValue("")
    mocks.getPlanCost.mockResolvedValue(5)
    mocks.classifyComplexity.mockReturnValue("simple")
    mocks.hasSufficientCredits.mockResolvedValue(true)
    mocks.chargePlanCredits.mockResolvedValue({ amount: 5, idempotencyKey: "plan_p1_abc" })
    mocks.generateSpecificationFromIdea.mockResolvedValue({ ...SPEC })
    primeProject()
  })

  it("charges the plan before generating it", async () => {
    await runScratchAnalysis("p1", "legacy")

    expect(mocks.chargePlanCredits).toHaveBeenCalledWith("u1", "p1", "legacy")
    expect(mocks.chargePlanCredits.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generateSpecificationFromIdea.mock.invocationCallOrder[0],
    )
    expect(mocks.refundPlanCredits).not.toHaveBeenCalled()
  })

  it("never generates a plan the account cannot afford", async () => {
    mocks.hasSufficientCredits.mockResolvedValue(false)

    await runScratchAnalysis("p1", "legacy")

    expect(mocks.chargePlanCredits).not.toHaveBeenCalled()
    expect(mocks.generateSpecificationFromIdea).not.toHaveBeenCalled()
    expect(mocks.recordCreditBlock).toHaveBeenCalledWith(
      "p1",
      "u1",
      expect.objectContaining({ required: 5, resume: "analysis" }),
    )
    expect(mocks.updateProject).toHaveBeenCalledWith("p1", expect.objectContaining({ state: "plan_failed" }))
  })

  it("refunds the plan charge when generation fails", async () => {
    const charge = { amount: 5, idempotencyKey: "plan_p1_abc" }
    mocks.chargePlanCredits.mockResolvedValue(charge)
    mocks.generateSpecificationFromIdea.mockRejectedValue(new Error("model down"))

    await runScratchAnalysis("p1", "legacy")

    expect(mocks.refundPlanCredits).toHaveBeenCalledWith("u1", "p1", charge)
    expect(mocks.updateProject).toHaveBeenCalledWith("p1", expect.objectContaining({ state: "plan_failed" }))
  })
})
