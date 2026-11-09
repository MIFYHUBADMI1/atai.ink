import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Composer attachment staging: server-side validation must independently
 * enforce the same caps the landing composer enforces client-side — 6 files,
 * 1 MB decoded per file, 2.5 MB total — and only accept well-formed data URIs.
 */

const mocks = vi.hoisted(() => ({
  col: vi.fn(),
  cryptoId: vi.fn(() => "att-id"),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db/collections", () => ({ projectAttachmentsCol: mocks.col }))
vi.mock("@/lib/store/store", () => ({ cryptoId: mocks.cryptoId }))

import { MAX_ATTACHMENT_BYTES, MAX_PROJECT_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES, saveProjectAttachments } from "./attachments"

function dataUri(bytes: number, type = "text/plain") {
  const payload = Buffer.from(new Uint8Array(bytes).fill(65)).toString("base64")
  return `data:${type};base64,${payload}`
}

function colWith(docs: unknown[] = []) {
  return {
    find: vi.fn(() => ({ sort: vi.fn(() => ({ toArray: vi.fn(async () => docs) })) })),
    deleteMany: vi.fn(async () => ({ deletedCount: docs.length })),
    insertMany: vi.fn(async (incoming: unknown[]) => {
      docs.push(...incoming)
      return { insertedCount: incoming.length }
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("saveProjectAttachments", () => {
  it("stores nothing when no files arrive", async () => {
    const col = colWith()
    mocks.col.mockResolvedValue(col)
    expect(await saveProjectAttachments("p1", "u1", undefined)).toEqual([])
    expect(await saveProjectAttachments("p1", "u1", [])).toEqual([])
    expect(col.insertMany).not.toHaveBeenCalled()
  })

  it("stores a valid data URI with decoded size and content type", async () => {
    const col = colWith()
    mocks.col.mockResolvedValue(col)
    const saved = await saveProjectAttachments("p1", "u1", [{ name: "brief.txt", content: dataUri(10) }])
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ projectId: "p1", userId: "u1", name: "brief.txt", size: 10, contentType: "text/plain" })
    expect(col.insertMany).toHaveBeenCalledTimes(1)
  })

  it("rejects content that is not a base64 data URI", async () => {
    const col = colWith()
    mocks.col.mockResolvedValue(col)
    const saved = await saveProjectAttachments("p1", "u1", [
      { name: "no.txt", content: "just text" },
      { name: "bad.txt", content: "data:text/plain,notbase64" },
    ])
    expect(saved).toEqual([])
    expect(col.insertMany).not.toHaveBeenCalled()
  })

  it("rejects files over the 1 MB decoded cap", async () => {
    const col = colWith()
    mocks.col.mockResolvedValue(col)
    const saved = await saveProjectAttachments("p1", "u1", [
      { name: "big.bin", content: dataUri(MAX_ATTACHMENT_BYTES + 1) },
      { name: "ok.bin", content: dataUri(100) },
    ])
    expect(saved.map((f) => f.name)).toEqual(["ok.bin"])
  })

  it("caps the set at 6 files and 2.5 MB in total", async () => {
    const col = colWith()
    mocks.col.mockResolvedValue(col)
    // 300 KB each: the count cap (6) binds before the total cap (2.5 MB).
    const files = Array.from({ length: 9 }, (_, i) => ({ name: `f${i}.bin`, content: dataUri(300 * 1024) }))
    const saved = await saveProjectAttachments("p1", "u1", files)
    expect(saved).toHaveLength(MAX_PROJECT_ATTACHMENTS)
    const total = saved.reduce((sum, f) => sum + f.size, 0)
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_ATTACHMENT_BYTES)
  })

  it("stops at the 2.5 MB total before the file count", async () => {
    const col = colWith()
    mocks.col.mockResolvedValue(col)
    // 600 KB each: the total cap binds at 4 files (2.4 MB).
    const files = Array.from({ length: 9 }, (_, i) => ({ name: `f${i}.bin`, content: dataUri(600 * 1024) }))
    const saved = await saveProjectAttachments("p1", "u1", files)
    expect(saved).toHaveLength(4)
  })

  it("sanitizes names and drops nameless entries", async () => {
    const col = colWith()
    mocks.col.mockResolvedValue(col)
    const saved = await saveProjectAttachments("p1", "u1", [
      { name: "a/b\\c.txt", content: dataUri(5) },
      { name: "   ", content: dataUri(5) },
      { name: "ok.txt", content: dataUri(5) },
    ])
    expect(saved.map((f) => f.name)).toEqual(["a_b_c.txt", "ok.txt"])
  })
})
