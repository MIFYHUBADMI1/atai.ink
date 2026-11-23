import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  scrape: vi.fn(),
  upload: vi.fn(),
  insert: vi.fn(),
  getProject: vi.fn(),
  updateProject: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  authorizeStorage: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/integrations/firecrawl/client", () => ({ scrapeUrl: h.scrape }))
vi.mock("@/lib/imagekit/upload", () => ({ uploadImageToImageKit: h.upload }))
vi.mock("@/lib/db/collections", () => ({ projectAssetsCol: async () => ({ insertOne: h.insert }) }))
vi.mock("@/lib/infrastructure/storage-reservations", () => ({
  reserveProjectStorage: h.reserve,
  releaseProjectStorage: h.release,
}))
vi.mock("@/lib/billing/entitlements/require", () => ({
  authorizeStorage: h.authorizeStorage,
  entitlementDenial: (check: { allowed: boolean; code?: string; reason?: string } | null) =>
    check && !check.allowed
      ? { code: check.code ?? "ENTITLEMENT_DENIED", message: check.reason ?? "denied" }
      : null,
}))
vi.mock("@/lib/store/store", () => ({
  cryptoId: () => "id",
  store: { getProject: h.getProject, updateProject: h.updateProject },
}))
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { captureAppPreview } from "./capture-app-preview"

const dataUri = `data:image/png;base64,${Buffer.from("screenshot-bytes").toString("base64")}`

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FIRECRAWL_API_KEY = "test-key"
  h.getProject.mockResolvedValue({ id: "p1", userId: "u1", understanding: { screenshots: [] } })
  h.scrape.mockResolvedValue({ data: { screenshot: dataUri } })
  h.upload.mockResolvedValue({ url: "https://ik.imagekit.io/test/preview.png" })
  h.insert.mockResolvedValue({})
  h.updateProject.mockResolvedValue({})
  h.reserve.mockResolvedValue({ holdId: "storage_hold" })
  h.release.mockResolvedValue(undefined)
  h.authorizeStorage.mockResolvedValue({ allowed: true })
})

describe("captureAppPreview storage accounting", () => {
  it("reserves the real screenshot bytes and records a countable asset", async () => {
    await captureAppPreview("p1", "https://app.example.com")

    expect(h.reserve).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", bytes: Buffer.byteLength("screenshot-bytes") }))
    expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      kind: "screenshot",
      size: Buffer.byteLength("screenshot-bytes"),
    }))
    expect(h.updateProject).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ understanding: expect.objectContaining({ screenshots: ["https://ik.imagekit.io/test/preview.png"] }) }),
    )
    expect(h.release).toHaveBeenCalledWith("storage_hold")
  })

  it("skips the preview when the plan does not include storage", async () => {
    h.authorizeStorage.mockResolvedValueOnce({ allowed: false, code: "EXPLORER_PLANNING_ONLY", reason: "No storage." })

    await captureAppPreview("p1", "https://app.example.com")

    expect(h.scrape).not.toHaveBeenCalled()
    expect(h.reserve).not.toHaveBeenCalled()
  })

  it("skips the preview when storage capacity is refused", async () => {
    h.reserve.mockResolvedValue({ denial: { code: "STORAGE_LIMIT_REACHED", message: "No room." } })

    await captureAppPreview("p1", "https://app.example.com")

    expect(h.upload).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.updateProject).not.toHaveBeenCalled()
  })

  it("releases the hold when the provider fails", async () => {
    h.upload.mockRejectedValueOnce(new Error("upload failed"))

    await captureAppPreview("p1", "https://app.example.com")

    expect(h.insert).not.toHaveBeenCalled()
    expect(h.release).toHaveBeenCalledWith("storage_hold")
  })
})
