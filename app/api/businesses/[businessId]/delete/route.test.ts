import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireUser, requireWorkspace, deleteConnectedBusiness, verifyPassword, checkRateLimit } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireWorkspace: vi.fn(),
  deleteConnectedBusiness: vi.fn(),
  verifyPassword: vi.fn(),
  checkRateLimit: vi.fn(async () => {}),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser }))
vi.mock("@/lib/business/http", () => ({
  requireWorkspace,
  actorOf: (user: { id: string }) => ({ kind: "user", id: user.id }),
}))
vi.mock("@/lib/connected-business/deletion", () => ({ deleteConnectedBusiness }))
vi.mock("@/lib/auth/crypto", () => ({ verifyPassword }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit }))

const { POST } = await import("./route")

const params = { params: Promise.resolve({ businessId: "biz_1" }) }

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/businesses/biz_1/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const passwordUser = {
  id: "u1",
  email: "owner@example.com",
  authProvider: "password" as const,
  passwordHash: "hash",
}

const oauthUser = {
  id: "u1",
  email: "owner@example.com",
  authProvider: "github" as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue(passwordUser)
  deleteConnectedBusiness.mockResolvedValue({
    businessId: "biz_1",
    deletedProjectIds: ["proj_1"],
    releasedClaims: 2,
  })
  verifyPassword.mockResolvedValue(true)
})

describe("POST /api/businesses/[businessId]/delete", () => {
  it("permanently deletes when email and password both match", async () => {
    const response = await POST(request({ confirmEmail: "Owner@Example.com", currentPassword: "secret" }), params)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, data: { deleted: true, releasedClaims: 2 } })
    expect(verifyPassword).toHaveBeenCalledWith("secret", "hash")
    expect(deleteConnectedBusiness).toHaveBeenCalledWith({
      businessId: "biz_1",
      actor: { kind: "user", id: "u1" },
    })
  })

  it("refuses a mismatched email without touching the business", async () => {
    const response = await POST(request({ confirmEmail: "someone@example.com", currentPassword: "secret" }), params)
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error.message).toMatch(/email does not match/i)
    expect(deleteConnectedBusiness).not.toHaveBeenCalled()
  })

  it("refuses a wrong password without touching the business", async () => {
    verifyPassword.mockResolvedValue(false)
    const response = await POST(request({ confirmEmail: "owner@example.com", currentPassword: "wrong" }), params)

    expect(response.status).toBe(422)
    expect(deleteConnectedBusiness).not.toHaveBeenCalled()
  })

  it("requires a password for a password account", async () => {
    const response = await POST(request({ confirmEmail: "owner@example.com" }), params)

    expect(response.status).toBe(422)
    expect(deleteConnectedBusiness).not.toHaveBeenCalled()
  })

  it("accepts email-only confirmation for a social account", async () => {
    requireUser.mockResolvedValue(oauthUser)
    const response = await POST(request({ confirmEmail: "owner@example.com" }), params)

    expect(response.status).toBe(200)
    expect(deleteConnectedBusiness).toHaveBeenCalled()
  })

  it("requires a confirmation email", async () => {
    const response = await POST(request({}), params)

    expect(response.status).toBe(422)
    expect(deleteConnectedBusiness).not.toHaveBeenCalled()
  })

  it("propagates an authorisation refusal", async () => {
    const { AppError } = await import("@/lib/errors")
    deleteConnectedBusiness.mockRejectedValue(new AppError("BUSINESS_FORBIDDEN", "Only the business owner can delete it."))
    const response = await POST(request({ confirmEmail: "owner@example.com", currentPassword: "secret" }), params)

    expect(response.status).toBe(403)
  })
})
