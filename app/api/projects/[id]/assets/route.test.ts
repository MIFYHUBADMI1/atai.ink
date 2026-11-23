import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  user: vi.fn(),
  project: vi.fn(),
  limit: vi.fn(),
  lease: vi.fn(),
  release: vi.fn(),
  upload: vi.fn(),
  insert: vi.fn(),
  storage: vi.fn(),
  usage: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock("@/lib/auth/session", () => ({ requireUser: h.user }))
vi.mock("@/lib/store/store", () => ({ store: { getProject: h.project }, cryptoId: () => "asset-test" }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: h.limit }))
vi.mock("@/lib/api/ai-lease", () => ({ acquireAiLease: h.lease }))
vi.mock("@/lib/imagekit/upload", () => ({ uploadImageToImageKit: h.upload }))
vi.mock("@/lib/db/collections", () => ({ ensureIndexes: async () => {}, projectAssetsCol: async () => ({ insertOne: h.insert }) }))
vi.mock("@/lib/logging/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/billing/entitlements/require", () => ({
  authorizeStorage: h.storage,
  entitlementDenial: (check: { allowed: boolean; code?: string; reason?: string } | null) =>
    check && !check.allowed
      ? { code: check.code ?? "ENTITLEMENT_DENIED", message: check.reason ?? "denied" }
      : null,
}))
vi.mock("@/lib/infrastructure/service", () => ({
  getProjectStorageUsage: h.usage,
  refreshProjectStorageUsage: h.refresh,
}))
import { POST } from "./route"
import { AppError } from "@/lib/errors"

const context = { params: Promise.resolve({ id: "owned" }) }
const request = () => {
  const body = new FormData()
  body.set("file", new File(["bytes validated by the separately tested upload helper"], "image.png", { type: "image/png" }))
  body.set("userId", "spoofed")
  body.set("projectId", "other")
  return new Request("http://localhost/api/projects/owned/assets", { method: "POST", body })
}
beforeEach(() => {
  vi.resetAllMocks()
  h.user.mockResolvedValue({ id: "owner" })
  h.project.mockResolvedValue({ id: "owned", userId: "owner" })
  h.lease.mockResolvedValue(h.release)
  h.storage.mockResolvedValue(null)
  h.usage.mockResolvedValue({ usedBytes: 0, limitBytes: null, withinLimit: true })
  h.refresh.mockResolvedValue({ usedBytes: 0, limitBytes: null, withinLimit: true })
  h.upload.mockResolvedValue({ fileId: "image", filePath: "/Atai/projects/owned/image.png", url: "https://ik.imagekit.io/test/image.png" })
})
describe("project upload ownership and resource admission", () => {
  it("requires authentication before parsing or processing bytes", async () => {
    h.user.mockRejectedValueOnce(new AppError("UNAUTHORIZED"))
    const req = request()
    expect((await POST(req, context)).status).toBe(401)
    expect(req.bodyUsed).toBe(false)
    expect(h.upload).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })
  it.each([null, { id: "owned", userId: "someone-else" }])("uses the same 404 for absent and foreign projects", async (project) => {
    h.project.mockResolvedValueOnce(project)
    expect((await POST(request(), context)).status).toBe(404)
    expect(h.upload).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })
  it("derives association and folder from authenticated ownership, not multipart fields", async () => {
    expect((await POST(request(), context)).status).toBe(200)
    expect(h.upload).toHaveBeenCalledWith(expect.objectContaining({ folder: "/Atai/projects/owned" }))
    expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", projectId: "owned" }))
    expect(h.lease).toHaveBeenCalledWith("owner", "image_upload")
    expect(h.release).toHaveBeenCalledOnce()
  })
  it("does not process or store an upload when concurrency is exhausted", async () => {
    h.lease.mockRejectedValueOnce(new AppError("RATE_LIMITED"))
    expect((await POST(request(), context)).status).toBe(429)
    expect(h.upload).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })
  it("releases after validation/provider failure without attaching an asset", async () => {
    h.upload.mockRejectedValueOnce(new AppError("IMAGE_UPLOAD_FAILED"))
    expect((await POST(request(), context)).status).toBeGreaterThanOrEqual(400)
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.release).toHaveBeenCalledOnce()
  })
  it("refuses storage the plan does not include before reading or uploading bytes", async () => {
    h.storage.mockResolvedValueOnce({ allowed: false, code: "STORAGE_UNAVAILABLE", reason: "No storage on this plan." })
    const response = await POST(request(), context)
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({ error: { code: "STORAGE_UNAVAILABLE" } })
    expect(h.upload).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })
  it("refuses an upload that would exceed the infrastructure storage quota", async () => {
    h.usage.mockResolvedValueOnce({ usedBytes: 49, limitBytes: 50, withinLimit: true })
    const response = await POST(request(), context)
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({ error: { code: "STORAGE_LIMIT_REACHED" } })
    expect(h.upload).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })
  it("refreshes observed usage after a successful upload", async () => {
    expect((await POST(request(), context)).status).toBe(200)
    expect(h.refresh).toHaveBeenCalledWith("owned")
  })
})
