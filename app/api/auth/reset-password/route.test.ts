import { beforeEach, describe, expect, it, vi } from "vitest"

const mock = vi.hoisted(() => ({ reset: vi.fn(), limit: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/auth/password-reset", () => ({ resetPassword: mock.reset }))
vi.mock("@/lib/auth/request-limit", () => ({ checkAuthRequest: mock.limit }))
vi.mock("@/lib/logging/logger", () => ({ logger: { error: mock.error } }))

import { POST } from "./route"
import { AppError } from "@/lib/errors"

const token = "a".repeat(43)
const request = (body: unknown) => new Request("http://localhost/api/auth/reset-password", { method: "POST", body: JSON.stringify(body) })
beforeEach(() => {
  vi.resetAllMocks()
  mock.reset.mockResolvedValue(undefined)
  mock.limit.mockResolvedValue(undefined)
})

describe("reset password API", () => {
  it("returns success only after the reset completes", async () => {
    const response = await POST(request({ token, password: "password123" }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: { reset: true } })
    expect(mock.reset).toHaveBeenCalledWith(token, "password123")
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
  it.each([null, [], {}, { token }, { password: "password123" }, { token: {}, password: "password123" }, { token, password: 42 }, { token, password: "short" }, { token, password: "a".repeat(1025) }])("rejects invalid input %# before reset", async (body) => {
    const response = await POST(request(body))
    expect(response.status).toBe(422)
    expect(mock.reset).not.toHaveBeenCalled()
  })
  it("rejects malformed JSON", async () => {
    expect((await POST(new Request("http://localhost", { method: "POST", body: "{" }))).status).toBe(422)
  })
  it("rejects malformed tokens", async () => {
    expect((await POST(request({ token: "bad", password: "password123" }))).status).toBe(400)
    expect(mock.reset).not.toHaveBeenCalled()
  })
  it("limits actual body bytes even without Content-Length", async () => {
    expect((await POST(request({ token, password: "a".repeat(9000) }))).status).toBe(413)
    expect(mock.reset).not.toHaveBeenCalled()
  })
  it("does not parse the request or reset after an ingress rejection", async () => {
    mock.limit.mockRejectedValueOnce(new AppError("RATE_LIMITED"))
    const req = request({ token, password: "password123" })
    const response = await POST(req)
    expect(response.status).toBe(429)
    expect(req.bodyUsed).toBe(false)
    expect(mock.reset).not.toHaveBeenCalled()
  })
  it.each([["VERIFICATION_INVALID", 400], ["VERIFICATION_EXPIRED", 410]] as const)("returns safe %s responses", async (code, status) => {
    mock.reset.mockRejectedValueOnce(new AppError(code))
    expect((await POST(request({ token, password: "password123" }))).status).toBe(status)
  })
  it("returns a retryable error without leaking raw tokens or driver details", async () => {
    mock.reset.mockRejectedValueOnce(new Error(`driver diagnostic ${token}`))
    const response = await POST(request({ token, password: "password123" }))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain(token)
    expect(JSON.stringify(mock.error.mock.calls)).not.toContain(token)
  })
})
