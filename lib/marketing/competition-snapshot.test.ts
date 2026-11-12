import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MirrorProject } from "@/lib/types/project"

const { find, generate, charge, refund, runResearch } = vi.hoisted(() => ({
  find: vi.fn(),
  generate: vi.fn(),
  charge: vi.fn(),
  refund: vi.fn(),
  runResearch: vi.fn(),
}))
vi.mock("@/lib/db/collections", () => ({ contentItemsCol: async () => ({ find }) }))
vi.mock("./studio/market-service", () => ({ generateMarketContent: generate }))
vi.mock("./competition-research", () => ({
  chargeCompetitionResearchCredits: charge,
  refundCompetitionResearchCredits: refund,
  getCompetitionResearchCost: () => 15,
  runCompetitionResearch: runResearch,
}))
import { competitionContextHash, generateCompetitionSnapshot, listCompetitionSnapshots } from "./competition-snapshot"

const project = { id: "p1", userId: "u1", name: "Ledgerly", updatedAt: 1, specification: { marketingPlan: "## Positioning\nFor bookkeepers.", targetUsers: ["Bookkeepers"] } } as MirrorProject

beforeEach(() => {
  vi.clearAllMocks()
  charge.mockResolvedValue(true)
  refund.mockResolvedValue("refunded")
  runResearch.mockResolvedValue({
    research: { queries: ["bookkeeping software competitors"], collectedAt: 1, sources: [], researchCreditsCharged: 0 },
  })
})

describe("Competition snapshot service", () => {
  it("scopes history to both owner and project and preserves older drafts", async () => {
    const docs = [
      { id: "new", title: "New", body: "## New", createdAt: 2, kitInput: { contextHash: "hash" } },
      { id: "old", title: "Old", body: "## Old", createdAt: 1 },
    ]
    find.mockReturnValue({ sort: () => ({ limit: () => ({ toArray: async () => docs }) }) })
    const result = await listCompetitionSnapshots("u1", "p1")
    expect(find).toHaveBeenCalledWith({ userId: "u1", projectId: "p1", kind: "marketing_asset", kit: "competition", kitSlot: "snapshot" }, expect.any(Object))
    expect(result.map((item) => item.id)).toEqual(["new", "old"])
    expect(result[0].contextHash).toBe("hash")
    expect(result[1].contextHash).toBeUndefined()
  })

  it("detects plan changes but not unrelated project updates", () => {
    const original = competitionContextHash(project)
    expect(competitionContextHash({ ...project, updatedAt: 999 })).toBe(original)
    expect(competitionContextHash({ ...project, specification: { ...project.specification!, marketingPlan: "Changed plan" } })).not.toBe(original)
  })

  it("rejects a mismatched project before charging or researching", async () => {
    await expect(generateCompetitionSnapshot({ userId: "u2", projectId: "p1", project })).rejects.toThrow()
    await expect(generateCompetitionSnapshot({ userId: "u1", projectId: "p2", project })).rejects.toThrow()
    expect(charge).not.toHaveBeenCalled()
    expect(runResearch).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  })

  it("refuses to run research when the founder cannot afford it", async () => {
    charge.mockResolvedValue(false)
    await expect(generateCompetitionSnapshot({ userId: "u1", projectId: "p1", project })).rejects.toThrow(/credits/)
    expect(runResearch).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
    expect(refund).not.toHaveBeenCalled()
  })

  it("stamps the context version and attaches the live research to the generated snapshot", async () => {
    await generateCompetitionSnapshot({ userId: "u1", projectId: "p1", project })
    expect(runResearch).toHaveBeenCalledWith({ userId: "u1", projectId: "p1", project })
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      kit: "competition",
      kitSlot: "snapshot",
      kitInput: { contextHash: competitionContextHash(project) },
      messages: expect.objectContaining({ prompt: expect.stringContaining("For bookkeepers.") }),
      research: expect.objectContaining({ queries: ["bookkeeping software competitors"], researchCreditsCharged: 15 }),
    }))
    expect(refund).not.toHaveBeenCalled()
  })

  it("refunds the research charge when the run or the analysis fails", async () => {
    runResearch.mockRejectedValue(new Error("search down"))
    await expect(generateCompetitionSnapshot({ userId: "u1", projectId: "p1", project })).rejects.toThrow("search down")
    expect(refund).toHaveBeenCalledWith("u1", "p1", 15)

    refund.mockClear()
    runResearch.mockResolvedValue({
      research: { queries: ["q"], collectedAt: 1, sources: [], researchCreditsCharged: 0 },
    })
    generate.mockRejectedValue(new Error("text failed"))
    await expect(generateCompetitionSnapshot({ userId: "u1", projectId: "p1", project })).rejects.toThrow("text failed")
    expect(refund).toHaveBeenCalledWith("u1", "p1", 15)
  })
})
