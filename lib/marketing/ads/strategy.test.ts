import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { mockGetProject, mockCol, mockLoggerInfo } = vi.hoisted(() => {
  const mockCol = {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    insertOne: vi.fn(),
  }
  return {
    mockGetProject: vi.fn(),
    mockCol,
    mockLoggerInfo: vi.fn(),
  }
})

vi.mock("@/lib/db/ads-collections", () => ({
  adStrategiesCol: async () => mockCol,
  ensureAdsIndexes: async () => {},
}))

vi.mock("@/lib/store/store", () => ({
  store: { getProject: mockGetProject },
  cryptoId: () => "testid",
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: mockLoggerInfo, warn: vi.fn(), error: vi.fn() },
}))

import { getAdStrategy, upsertAdStrategy } from "./strategy"

const OWNED = { id: "proj_1", userId: "user_1", name: "Sweet Crust Bakery" }

describe("upsertAdStrategy", () => {
  beforeEach(() => {
    mockGetProject.mockReset().mockResolvedValue(OWNED)
    mockCol.findOne.mockReset()
    mockCol.findOneAndUpdate.mockReset().mockResolvedValue(null)
    mockCol.insertOne.mockReset().mockResolvedValue(undefined)
    mockLoggerInfo.mockReset()
  })

  it("creates one normalized doc when none exists", async () => {
    mockCol.findOne.mockResolvedValue(null)

    const doc = await upsertAdStrategy({
      userId: "user_1",
      projectId: "proj_1",
      strategy: {
        positioning: "  The   bakery  that beats the queue.  ",
        icp: "Families in Kampala",
        objectives: ["Fill weekends", "", "Fill weekends", 42, "Grow repeats"],
        channels: ["Facebook", "Instagram"],
        budgetNote: 123 as unknown as string,
      },
    })

    expect(doc.id).toBe("adstrat_testid")
    expect(doc.userId).toBe("user_1")
    expect(doc.projectId).toBe("proj_1")
    expect(doc.positioning).toBe("The bakery that beats the queue.")
    expect(doc.objectives).toEqual(["Fill weekends", "Grow repeats"])
    expect(doc.channels).toEqual(["Facebook", "Instagram"])
    expect(doc.budgetNote).toBe("")
    expect(doc.brandVoice).toBe("")
    expect(mockCol.insertOne).toHaveBeenCalledTimes(1)
    expect(mockLoggerInfo).toHaveBeenCalled()
  })

  it("replaces the fields of an existing doc via findOneAndUpdate", async () => {
    const existing = { projectId: "proj_1", positioning: "old" }
    mockCol.findOne.mockResolvedValue(existing)
    const updated = { ...existing, positioning: "new words", updatedAt: 99 }
    mockCol.findOneAndUpdate.mockResolvedValue(updated)

    const doc = await upsertAdStrategy({ userId: "user_1", projectId: "proj_1", strategy: { positioning: "new words" } })

    expect(doc).toBe(updated)
    expect(mockCol.findOneAndUpdate).toHaveBeenCalledWith(
      { projectId: "proj_1" },
      expect.objectContaining({ $set: expect.objectContaining({ positioning: "new words" }) }),
      { returnDocument: "after" },
    )
    expect(mockCol.insertOne).not.toHaveBeenCalled()
  })

  it("fails closed when the project is missing or owned by someone else", async () => {
    mockGetProject.mockResolvedValue({ ...OWNED, userId: "someone_else" })
    await expect(
      upsertAdStrategy({ userId: "user_1", projectId: "proj_1", strategy: { positioning: "x" } }),
    ).rejects.toThrow(/access to this project/i)
    mockGetProject.mockResolvedValue(null)
    await expect(
      upsertAdStrategy({ userId: "user_1", projectId: "proj_1", strategy: { positioning: "x" } }),
    ).rejects.toThrow(/access to this project/i)
    expect(mockCol.insertOne).not.toHaveBeenCalled()
    expect(mockCol.findOneAndUpdate).not.toHaveBeenCalled()
  })
})

describe("getAdStrategy", () => {
  beforeEach(() => {
    mockCol.findOne.mockReset()
  })

  it("returns the saved strategy or null", async () => {
    mockCol.findOne.mockResolvedValue({ projectId: "proj_1", positioning: "words" })
    await expect(getAdStrategy("proj_1")).resolves.toEqual({ projectId: "proj_1", positioning: "words" })

    mockCol.findOne.mockResolvedValue(null)
    await expect(getAdStrategy("proj_1")).resolves.toBeNull()
    expect(mockCol.findOne).toHaveBeenCalledWith({ projectId: "proj_1" })
  })
})
