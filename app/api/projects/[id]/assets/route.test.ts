import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ user: vi.fn(), project: vi.fn(), limit: vi.fn(), lease: vi.fn(), release: vi.fn(), upload: vi.fn(), insert: vi.fn() }))
vi.mock("@/lib/auth/session", () => ({ requireUser: h.user }))
vi.mock("@/lib/store/store", () => ({ store: { getProject: h.project }, cryptoId: () => "asset-test" }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: h.limit }))
vi.mock("@/lib/api/ai-lease", () => ({ acquireAiLease: h.lease }))
vi.mock("@/lib/imagekit/upload", () => ({ uploadImageToImageKit: h.upload }))
vi.mock("@/lib/db/collections", () => ({ ensureIndexes: async () => {}, projectAssetsCol: async () => ({ insertOne: h.insert }) }))
vi.mock("@/lib/logging/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
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
})
