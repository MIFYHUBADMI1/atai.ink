import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MirrorProject } from "@/lib/types/project"

const { find, generate, docs } = vi.hoisted(() => ({ find: vi.fn(), generate: vi.fn(), docs: [] as unknown[] }))
vi.mock("@/lib/db/collections", () => ({ contentItemsCol: async () => ({ find }) }))
vi.mock("./studio/market-service", () => ({ generateMarketContent: generate }))
import { competitionContextHash, generateCompetitionSnapshot, listCompetitionSnapshots } from "./competition-snapshot"

const project = { id: "p1", userId: "u1", name: "Ledgerly", updatedAt: 1, specification: { marketingPlan: "## Positioning\nFor bookkeepers.", targetUsers: ["Bookkeepers"] } } as MirrorProject

beforeEach(() => {
  vi.clearAllMocks()
  docs.length = 0
  find.mockReturnValue({ sort: () => ({ limit: () => ({ toArray: async () => docs }) }) })
})

describe("Competition snapshot service", () => {
  it("scopes history to both owner and project and preserves older drafts", async () => {
    docs.push({ id: "new", title: "New", body: "## New", createdAt: 2, kitInput: { contextHash: "hash" } }, { id: "old", title: "Old", body: "## Old", createdAt: 1 })
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

  it("rejects a mismatched project before generation", async () => {
    await expect(generateCompetitionSnapshot({ userId: "u2", projectId: "p1", project })).rejects.toThrow()
    await expect(generateCompetitionSnapshot({ userId: "u1", projectId: "p2", project })).rejects.toThrow()
    expect(generate).not.toHaveBeenCalled()
  })

  it("stamps the actual context version on the appended snapshot", async () => {
    await generateCompetitionSnapshot({ userId: "u1", projectId: "p1", project })
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      kit: "competition", kitSlot: "snapshot", kitInput: { contextHash: competitionContextHash(project) },
      messages: expect.objectContaining({ prompt: expect.stringContaining("For bookkeepers.") }),
    }))
  })
})
