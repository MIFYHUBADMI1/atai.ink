import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { check } = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: check }))
import { checkAuthRequest } from "./request-limit"
import { AppError } from "@/lib/errors"

beforeEach(() => {
  check.mockReset()
  check.mockResolvedValue(undefined)
  vi.stubEnv("VERCEL", "1")
  vi.stubEnv("NODE_ENV", "production")
})
afterEach(() => vi.unstubAllEnvs())
const request = (ip = "203.0.113.1", spoof = "192.0.2.1") => new Request("http://localhost", { headers: { "x-vercel-forwarded-for": ip, "x-forwarded-for": spoof } })

describe("authentication ingress layers", () => {
  it("enforces shared capacity before per-IP storage and ignores spoofed forwarding", async () => {
    await checkAuthRequest(request(), "login")
    await checkAuthRequest(request("203.0.113.1", "192.0.2.2"), "login")
    expect(check.mock.calls[0][0]).toMatchObject({ action: "auth_ingress", identifier: "shared" })
    expect(check.mock.calls[1][0].identifier).toBe(check.mock.calls[3][0].identifier)
    expect(check.mock.calls[1][0].identifier).toHaveLength(64)
  })
  it("uses the same shared capacity bucket for distributed request identities", async () => {
    await checkAuthRequest(request("203.0.113.1"), "login")
    await checkAuthRequest(request("203.0.113.2"), "register")
    expect(check.mock.calls[0][0]).toEqual(check.mock.calls[2][0])
    expect(check.mock.calls[1][0].identifier).not.toBe(check.mock.calls[3][0].identifier)
  })
  it("does not mint a new IP row after shared rejection", async () => {
    check.mockRejectedValueOnce(new AppError("RATE_LIMITED"))
    await expect(checkAuthRequest(request(), "login")).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(check).toHaveBeenCalledOnce()
  })
  it("fails closed when storage is unavailable", async () => {
    check.mockRejectedValueOnce(new Error("database unavailable"))
    await expect(checkAuthRequest(request(), "login")).rejects.toThrow("database unavailable")
    expect(check).toHaveBeenCalledOnce()
  })
  it("rejects unverifiable production requests before touching storage", async () => {
    vi.stubEnv("VERCEL", "")
    vi.stubEnv("TRUSTED_PROXY_HOPS", "")
    await expect(checkAuthRequest(request(), "login")).rejects.toMatchObject({ status: 503 })
    expect(check).not.toHaveBeenCalled()
  })
})
