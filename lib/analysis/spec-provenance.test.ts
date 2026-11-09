/**
 * RC-06 fix: a plan born from the silent heavy→legacy fallback must be
 * distinguishable from a deep plan or a chosen quick draft.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock("ai", () => ({ generateText: vi.fn() }))
vi.mock("./model", () => ({ MODEL: "test-model" }))
vi.mock("@/lib/projects/ai-artifacts", () => ({ recordAIArtifacts: vi.fn(async () => {}) }))
vi.mock("@/lib/types/ai-artifacts", () => ({ makeAIArtifact: vi.fn((x: unknown) => x) }))

const mocks = vi.hoisted(() => ({ executeIdeaPipeline: vi.fn() }))
vi.mock("@/lib/planning/orchestrator", () => ({
  PlanningOrchestrator: class {
    executeIdeaPipeline = mocks.executeIdeaPipeline
  },
}))

import { generateText } from "ai"
import { generateSpecificationFromIdea } from "./specification"

const SPEC_JSON = JSON.stringify({
  applicationType: "marketplace",
  title: "Dog Markets",
  description: "A dog-walking marketplace.",
  purpose: "Connect walkers with dog owners.",
  targetUsers: ["Berlin dog owners"],
  userRoles: [],
  coreFlows: [],
  suggestedFeatures: [],
  dataEntities: [],
  backendRequirements: [],
  integrations: [],
  additionalInstructions: "",
})

describe("generateSpecificationFromIdea — plan provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateText).mockResolvedValue({ text: SPEC_JSON } as never)
  })

  it("stamps plans drafted by the deep pipeline", async () => {
    mocks.executeIdeaPipeline.mockResolvedValue({ specification: { title: "Deep" } })
    const spec = await generateSpecificationFromIdea("an idea", "user-1", "proj-1", "heavy")
    expect(spec.planPipeline).toBe("enhanced")
  })

  it("stamps the silent fallback distinctly from a chosen quick draft", async () => {
    mocks.executeIdeaPipeline.mockRejectedValue(new Error("stage died"))
    const fallback = await generateSpecificationFromIdea("an idea", "user-1", "proj-1", "heavy")
    expect(fallback.planPipeline).toBe("legacy-fallback")
    expect(generateText).toHaveBeenCalled()

    const chosen = await generateSpecificationFromIdea("an idea", "user-1", "proj-1", "legacy")
    expect(chosen.planPipeline).toBe("legacy")
    expect(mocks.executeIdeaPipeline).toHaveBeenCalledTimes(1)
  })
})
