import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  project: vi.fn(),
  updateOne: vi.fn(),
  assets: vi.fn(),
  attachments: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/store/store", () => ({ cryptoId: () => "id" }))
vi.mock("@/lib/db/collections", () => ({
  projectsCol: async () => ({ findOne: h.project, updateOne: h.updateOne }),
  projectAssetsCol: async () => ({ find: h.assets }),
  projectAttachmentsCol: async () => ({ find: h.attachments }),
  ensureIndexes: async () => undefined,
}))
vi.mock("@/lib/integrations/totalum/service", () => ({ setProjectCreditLimits: vi.fn() }))
vi.mock("@/lib/billing/credit-service", () => ({ consumeCredits: vi.fn() }))
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { checkStorageLimit, getProjectStorageUsage, refreshProjectStorageUsage } from "./service"

function cursor(rows: Array<{ size?: number }>) {
  return { toArray: async () => rows }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.project.mockResolvedValue({
    id: "p1",
    infrastructure: { storageLimitBytes: 100, storageUsedBytes: 0 },
  })
  h.assets.mockReturnValue(cursor([{ size: 30 }, { size: 20 }]))
  h.attachments.mockReturnValue(cursor([{ size: 10 }, {}]))
  h.updateOne.mockResolvedValue({ matchedCount: 1 })
})

describe("project storage usage", () => {
  it("sums real asset and attachment bytes instead of the stale counter", async () => {
    await expect(getProjectStorageUsage("p1")).resolves.toEqual({
      usedBytes: 60,
      limitBytes: 100,
      withinLimit: true,
    })
  })

  it("reports over-quota when observed bytes exceed the infrastructure limit", async () => {
    h.assets.mockReturnValue(cursor([{ size: 101 }]))
    h.attachments.mockReturnValue(cursor([]))
    await expect(checkStorageLimit("p1")).resolves.toEqual({
      withinLimit: false,
      used: 101,
      limit: 100,
    })
  })

  it("treats a project without infrastructure as unlimited for the advisory view", async () => {
    h.project.mockResolvedValue({ id: "p1" })
    await expect(getProjectStorageUsage("p1")).resolves.toEqual({
      usedBytes: 60,
      limitBytes: null,
      withinLimit: true,
    })
  })

  it("persists observed usage and over-quota state for the infrastructure UI", async () => {
    await refreshProjectStorageUsage("p1")
    expect(h.updateOne).toHaveBeenCalledWith(
      { id: "p1", infrastructure: { $exists: true } },
      {
        $set: {
          "infrastructure.storageUsedBytes": 60,
          "infrastructure.overQuota": false,
        },
      },
    )
  })
})
