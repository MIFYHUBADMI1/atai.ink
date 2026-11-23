import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireUser, restoreBusiness, isBusinessWorkspaceEnabled } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  restoreBusiness: vi.fn(),
  isBusinessWorkspaceEnabled: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser }))
vi.mock("@/lib/business/service", () => ({ restoreBusiness }))
vi.mock("@/lib/business/flags", () => ({ isBusinessWorkspaceEnabled }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => {}) }))

const { POST } = await import("./route")

const context = { params: Promise.resolve({ businessId: "biz_1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: "u1" })
  isBusinessWorkspaceEnabled.mockReturnValue(true)
})

describe("POST /api/businesses/[businessId]/restore", () => {
  it("hides the surface when the rollout is off", async () => {
    isBusinessWorkspaceEnabled.mockReturnValue(false)

    const response = await POST(new Request("http://localhost", { method: "POST" }), context)

    expect(response.status).toBe(404)
    expect(restoreBusiness).not.toHaveBeenCalled()
  })

  it("restores for the acting user", async () => {
    restoreBusiness.mockResolvedValue({ id: "biz_1", status: "active" })

    const response = await POST(new Request("http://localhost", { method: "POST" }), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.business).toMatchObject({ id: "biz_1", status: "active" })
    expect(restoreBusiness).toHaveBeenCalledWith({ businessId: "biz_1", actor: { kind: "user", id: "u1" } })
  })

  it("passes a refusal through with its status", async () => {
    const { AppError } = await import("@/lib/errors")
    restoreBusiness.mockRejectedValue(new AppError("BUSINESS_FORBIDDEN"))

    const response = await POST(new Request("http://localhost", { method: "POST" }), context)

    expect(response.status).toBe(403)
  })
})
