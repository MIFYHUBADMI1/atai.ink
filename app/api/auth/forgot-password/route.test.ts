import { beforeEach, describe, expect, it, vi } from "vitest"

const mock = vi.hoisted(() => ({
  after: vi.fn(), user: vi.fn(), insert: vi.fn(), updateMany: vi.fn(), mail: vi.fn(), limit: vi.fn(), accountLimit: vi.fn(), error: vi.fn(),
}))
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mock.after }))
vi.mock("@/lib/auth/users", () => ({ findUserByEmail: mock.user }))
vi.mock("@/lib/db/collections", () => ({ verificationTokensCol: async () => ({ insertOne: mock.insert, updateMany: mock.updateMany }) }))
vi.mock("@/lib/auth/request-limit", () => ({ checkAuthRequest: mock.limit }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: mock.accountLimit }))
vi.mock("@/lib/email/mailer", () => ({ sendMail: mock.mail }))
vi.mock("@/lib/env", () => ({
  getAppUrl: () => "http://localhost:3000",
  getPublicBaseUrl: () => "http://localhost:3000",
}))
vi.mock("@/lib/logging/logger", () => ({ logger: { error: mock.error } }))

import { POST } from "./route"
import { hashToken } from "@/lib/auth/crypto"
import { AppError } from "@/lib/errors"

const request = (email: unknown) => new Request("http://localhost/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) })
const deliver = async () => { await mock.after.mock.calls[0][0]() }
beforeEach(() => {
  vi.resetAllMocks()
  mock.user.mockResolvedValue({ id: "u1", name: "User", email: "user@example.com", passwordHash: "existing" })
})

describe("forgot-password neutral response", () => {
  it("defers ALL account-dependent work until after the neutral response", async () => {
    const response = await POST(request(" User@Example.com "))
    expect(await response.json()).toEqual({ ok: true, data: { sent: true } })
    expect(mock.user).not.toHaveBeenCalled()
    expect(mock.mail).not.toHaveBeenCalled()
    await deliver()
    expect(mock.user).toHaveBeenCalledWith("user@example.com")
    expect(mock.mail).toHaveBeenCalledOnce()
  })
  it.each([null, { id: "oauth", passwordHash: null }])("returns the same envelope for unavailable password accounts %#", async (user) => {
    mock.user.mockResolvedValue(user)
    const response = await POST(request("user@example.com"))
    expect(await response.json()).toEqual({ ok: true, data: { sent: true } })
    await deliver()
    expect(mock.insert).not.toHaveBeenCalled()
    expect(mock.mail).not.toHaveBeenCalled()
  })
  it("stores only a hash with a one-hour expiration and emails the implemented URL", async () => {
    await POST(request("user@example.com"))
    await deliver()
    const stored = mock.insert.mock.calls[0][0]
    const mail = mock.mail.mock.calls[0][0]
    expect(mock.updateMany).toHaveBeenCalledWith(
      { userId: "u1", purpose: "password_reset", usedAt: { $exists: false } },
      { $set: { usedAt: expect.any(Number) } },
    )
    const url = mail.text.match(/http:\/\/localhost:3000\/reset-password\?token=([\w-]+)/)
    expect(url).not.toBeNull()
    expect(url[1]).toHaveLength(43)
    expect(stored.tokenHash).toBe(hashToken(url[1]))
    expect(stored.expiresAt.getTime() - stored.createdAt).toBe(3_600_000)
    expect(JSON.stringify(stored)).not.toContain(url[1])
  })
  it.each(["user", "insert", "mail"] as const)("keeps %s failures out of account-dependent responses and logs", async (step) => {
    mock[step].mockRejectedValueOnce(new Error("sensitive diagnostic"))
    const response = await POST(request("user@example.com"))
    expect(response.status).toBe(200)
    await deliver()
    expect(mock.error).toHaveBeenCalledWith("api.auth.forgot_password", "Reset email could not be issued or delivered.")
  })
  it.each([undefined, null, {}, "", "invalid", "x".repeat(255)])("accepts invalid email inputs neutrally without issuing a token %#", async (email) => {
    expect((await POST(request(email))).status).toBe(200)
    expect(mock.after).not.toHaveBeenCalled()
  })
  it("rejects ingress throttling before creating identifier rows or queueing mail", async () => {
    mock.limit.mockRejectedValueOnce(new AppError("RATE_LIMITED"))
    expect((await POST(request("user@example.com"))).status).toBe(429)
    expect(mock.accountLimit).not.toHaveBeenCalled()
    expect(mock.after).not.toHaveBeenCalled()
  })
})
