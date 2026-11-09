import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { find, sort, limit, toArray, updateOne, insertOne, deleteOne, findOne } = vi.hoisted(() => {
  const toArray = vi.fn()
  const limit = vi.fn(() => ({ toArray }))
  const sort = vi.fn(() => ({ limit }))
  const find = vi.fn(() => ({ sort }))
  return { find, sort, limit, toArray, updateOne: vi.fn(), insertOne: vi.fn(), deleteOne: vi.fn(), findOne: vi.fn() }
})

vi.mock("@/lib/db/collections", () => ({
  contentItemsCol: async () => ({ find, updateOne, insertOne, deleteOne, findOne }),
}))

vi.mock("@/lib/store/store", () => ({ cryptoId: () => "cid" }))

import {
  deleteContentItem,
  duplicateContentItem,
  searchContentItems,
  updateContentItem,
} from "./library"
import type { ContentItemDoc } from "@/lib/types/db"

function doc(overrides: Partial<ContentItemDoc> = {}): ContentItemDoc {
  return {
    _id: "x" as never,
    id: "content_1",
    userId: "u1",
    projectId: "p1",
    kind: "marketing_asset",
    template: "market_studio",
    status: "draft",
    title: "Launch announcement",
    body: "We launched.",
    version: 1,
    origin: "ai_generated_marketing_content",
    creditsCharged: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

beforeEach(() => {
  find.mockClear()
  sort.mockClear()
  limit.mockClear()
  toArray.mockReset()
  updateOne.mockReset()
  insertOne.mockReset()
  deleteOne.mockReset()
  findOne.mockReset()
})

describe("searchContentItems", () => {
  it("always scopes to the project and applies search + filters", async () => {
    toArray.mockResolvedValue([doc()])

    await searchContentItems("p1", { q: "launch", kind: "social", status: "draft", planned: "planned" })

    const filter = find.mock.calls[0][0] as { projectId: string; $and: Array<Record<string, unknown>> }
    expect(filter.projectId).toBe("p1")
    const serialized = JSON.stringify(filter.$and)
    expect(serialized).toContain("launch")
    expect(serialized).toContain("assetKind")
    expect(serialized).toContain("plannedAt")
  })

  it("escapes regex metacharacters in the search term", async () => {
    toArray.mockResolvedValue([])
    await searchContentItems("p1", { q: "a.*b(" })
    const serialized = JSON.stringify(find.mock.calls[0][0])
    expect(serialized).toContain("a\\\\.\\\\*b\\\\(")
  })

  it("returns a cursor only when another page exists", async () => {
    toArray.mockResolvedValue([doc({ id: "a" }), doc({ id: "b" })])
    const first = await searchContentItems("p1", { limit: 1 })
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).toBe("1_a")

    toArray.mockResolvedValue([doc({ id: "a" })])
    const only = await searchContentItems("p1", { limit: 1 })
    expect(only.nextCursor).toBeNull()
  })

  it("caps an oversized limit instead of returning everything", async () => {
    toArray.mockResolvedValue([])
    await searchContentItems("p1", { limit: 10_000 })
    expect(limit).toHaveBeenCalledWith(51)
  })
})

describe("updateContentItem", () => {
  it("rejects an unknown status without touching the database", async () => {
    await expect(
      updateContentItem({ projectId: "p1", contentId: "content_1", status: "published" as never }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
    expect(updateOne).not.toHaveBeenCalled()
  })

  it("clears a planned date with $unset rather than storing null", async () => {
    updateOne.mockResolvedValue({ matchedCount: 1 })
    findOne.mockResolvedValue(doc({ plannedAt: undefined }))

    await updateContentItem({ projectId: "p1", contentId: "content_1", plannedAt: null })

    const update = updateOne.mock.calls[0][1] as { $unset?: Record<string, 1> }
    expect(update.$unset?.plannedAt).toBe(1)
    expect(updateOne.mock.calls[0][0]).toEqual({ projectId: "p1", id: "content_1" })
  })

  it("returns null when the item does not belong to this project", async () => {
    updateOne.mockResolvedValue({ matchedCount: 0 })
    await expect(updateContentItem({ projectId: "p1", contentId: "other", title: "New" })).resolves.toBeNull()
  })
})

describe("duplicateContentItem", () => {
  it("inserts a new v1 draft and leaves the source untouched", async () => {
    const source = doc()
    findOne.mockResolvedValue(source)
    insertOne.mockResolvedValue({ acknowledged: true })

    const copy = await duplicateContentItem({ userId: "u1", projectId: "p1", contentId: "content_1" })

    expect(copy.id).not.toBe(source.id)
    expect(copy.version).toBe(1)
    expect(copy.title).toBe("Launch announcement (copy)")
    expect(copy.projectId).toBe("p1")
    expect(insertOne).toHaveBeenCalledTimes(1)
    expect(updateOne).not.toHaveBeenCalled()
  })

  it("refuses to duplicate an item from another project", async () => {
    findOne.mockResolvedValue(null)
    await expect(
      duplicateContentItem({ userId: "u1", projectId: "p1", contentId: "other" }),
    ).rejects.toMatchObject({ status: 404 })
    expect(insertOne).not.toHaveBeenCalled()
  })
})

describe("deleteContentItem", () => {
  it("is project-scoped and reports whether anything was removed", async () => {
    deleteOne.mockResolvedValueOnce({ deletedCount: 0 })
    await expect(deleteContentItem({ projectId: "p1", contentId: "content_1" })).resolves.toBe(false)
    expect(deleteOne).toHaveBeenCalledWith({ projectId: "p1", id: "content_1" })

    deleteOne.mockResolvedValueOnce({ deletedCount: 1 })
    await expect(deleteContentItem({ projectId: "p1", contentId: "content_1" })).resolves.toBe(true)
  })
})
