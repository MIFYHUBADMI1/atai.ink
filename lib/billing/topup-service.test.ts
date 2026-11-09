import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { mockFind, mockSort, mockLimit, mockToArray, mockUpdateOne, mockInsertOne } = vi.hoisted(() => ({
  mockFind: vi.fn(),
  mockSort: vi.fn(),
  mockLimit: vi.fn(),
  mockToArray: vi.fn(),
  mockUpdateOne: vi.fn(),
  mockInsertOne: vi.fn(),
}))

vi.mock("@/lib/db/collections", () => ({
  topupsCol: vi.fn().mockResolvedValue({
    findOne: vi.fn().mockResolvedValue(null),
    find: mockFind,
    updateOne: mockUpdateOne,
    insertOne: mockInsertOne,
  }),
}))

import * as topupService from "./topup-service"

// Phase 1 — the legacy top-up service must be read-only. The credit-granting
// write paths (createTopUp / uploadEvidence / awardCredits / rejectTopUp)
// were removed when the Mobile Money gateway was discontinued.

describe("legacy topup service is read-only", () => {
  it("exposes no credit-granting or write functions", () => {
    expect((topupService as Record<string, unknown>).createTopUp).toBeUndefined()
    expect((topupService as Record<string, unknown>).uploadEvidence).toBeUndefined()
    expect((topupService as Record<string, unknown>).awardCredits).toBeUndefined()
    expect((topupService as Record<string, unknown>).rejectTopUp).toBeUndefined()
  })

  it("still provides read-only historical access", async () => {
    mockFind.mockReturnValue({ sort: mockSort })
    mockSort.mockReturnValue({ limit: mockLimit })
    mockLimit.mockReturnValue({ toArray: mockToArray })
    mockToArray.mockResolvedValue([])

    await expect(topupService.listUserTopUps("u1")).resolves.toEqual([])
    await expect(topupService.listPendingTopUps(10)).resolves.toEqual([])

    expect(mockToArray).toHaveBeenCalledTimes(2)
    // No mutation ever issued by the read surface.
    expect(mockUpdateOne).not.toHaveBeenCalled()
    expect(mockInsertOne).not.toHaveBeenCalled()
  })
})
