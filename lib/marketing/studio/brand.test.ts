import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { updateOne, findOne, getProject } = vi.hoisted(() => ({
  updateOne: vi.fn(),
  findOne: vi.fn(),
  getProject: vi.fn(),
}))

vi.mock("@/lib/db/collections", () => ({
  brandProfilesCol: async () => ({ updateOne, findOne }),
}))

vi.mock("@/lib/store/store", () => ({
  cryptoId: () => "cid",
  store: { getProject },
}))

import { brandContextLines, saveBrandProfile, getBrandProfile } from "./brand"
import type { BrandProfileDoc } from "@/lib/types/db"

function profile(overrides: Partial<BrandProfileDoc> = {}): BrandProfileDoc {
  return {
    _id: "x" as never,
    id: "brand_1",
    userId: "u1",
    projectId: "p1",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe("brandContextLines", () => {
  it("returns nothing for a missing profile", () => {
    expect(brandContextLines(null)).toEqual({ lines: [], sources: [] })
  })

  it("includes only the fields the founder actually set, and names its sources", () => {
    const { lines, sources } = brandContextLines(
      profile({ tone: "warm", audience: "indie founders", avoid: ["guaranteed"], brandName: "  " }),
    )
    expect(lines).toEqual(["Preferred tone: warm", "Audience: indie founders", "Words/claims to avoid: guaranteed"])
    expect(sources).toEqual(["Preferred tone", "Audience", "Claims to avoid"])
    // An empty brand name is omitted rather than rendered as an empty line.
    expect(lines.join("\n")).not.toContain("Brand name")
  })
})

describe("saveBrandProfile", () => {
  beforeEach(() => {
    updateOne.mockReset()
    findOne.mockReset()
  })

  it("refuses to write when the caller does not own the project", async () => {
    getProject.mockResolvedValue({ id: "p1", userId: "someone_else" })

    await expect(saveBrandProfile({ userId: "u1", projectId: "p1", tone: "warm" })).rejects.toMatchObject({
      code: "UNAUTHORIZED_PROJECT_ACCESS",
    })
    expect(updateOne).not.toHaveBeenCalled()
  })

  it("clears fields the founder emptied instead of keeping stale values", async () => {
    getProject.mockResolvedValue({ id: "p1", userId: "u1" })
    findOne.mockResolvedValue(profile())
    updateOne.mockResolvedValue({ matchedCount: 1, upsertedCount: 0 })

    await saveBrandProfile({
      userId: "u1",
      projectId: "p1",
      tone: "direct",
      audience: "",
      differentiators: [],
    })

    const update = updateOne.mock.calls[0][1] as { $set: Record<string, unknown>; $unset: Record<string, 1> }
    expect(update.$set.tone).toBe("direct")
    expect(update.$unset.audience).toBe(1)
    expect(update.$unset.differentiators).toBe(1)
  })

  it("scopes the upsert to the project and never trusts a client owner id", async () => {
    getProject.mockResolvedValue({ id: "p1", userId: "u1" })
    findOne.mockResolvedValue(profile())
    updateOne.mockResolvedValue({ matchedCount: 1 })

    await saveBrandProfile({ userId: "u1", projectId: "p1", callToAction: "Start free" })

    expect(updateOne.mock.calls[0][0]).toEqual({ projectId: "p1" })
    const update = updateOne.mock.calls[0][1] as { $setOnInsert: Record<string, unknown> }
    expect(update.$setOnInsert.userId).toBe("u1")
    expect(update.$setOnInsert.projectId).toBe("p1")
  })
})

describe("getBrandProfile", () => {
  it("returns null when the project has no profile", async () => {
    findOne.mockResolvedValue(null)
    await expect(getBrandProfile("p1")).resolves.toBeNull()
  })
})
