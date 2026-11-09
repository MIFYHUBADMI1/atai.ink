import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { createHash } from "node:crypto"

const mocks = vi.hoisted(() => ({ findUser: vi.fn(), balance: vi.fn(), projects: vi.fn(), limit: vi.fn() }))
vi.mock("@/lib/auth/users", () => ({ findUserByEmail: mocks.findUser }))
vi.mock("@/lib/billing/credit-service", () => ({ getAvailableCredits: mocks.balance }))
vi.mock("@/lib/store/store", () => ({ store: { listProjects: mocks.projects } }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: mocks.limit }))
vi.mock("@/lib/logging/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
import { GET as credits } from "@/app/api/internal/credits/route"
import { GET as projects } from "@/app/api/internal/projects/route"
import { AppError } from "@/lib/errors"

const testKey = "isolated-internal-api-test-secret"
const request = (key: string | null = testKey, ip = "192.0.2.1", email = "test@example.com") => {
  const headers = new Headers({ "x-forwarded-for": ip, "x-real-ip": ip })
  if (key !== null) headers.set("x-internal-key", key)
  return new NextRequest(`http://localhost/api/internal/credits?email=${encodeURIComponent(email)}`, { headers })
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("ATAI_INTERNAL_KEY", testKey)
  vi.spyOn(console, "warn").mockImplementation(() => {})
  mocks.limit.mockResolvedValue(undefined)
  mocks.findUser.mockResolvedValue({ id: "user-1", subscriptionCredits: 10, permanentCredits: 20 })
  mocks.balance.mockResolvedValue(30)
  mocks.projects.mockResolvedValue([])
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe.each([{ name: "credits", route: credits }, { name: "projects", route: projects }])("internal $name route", ({ route }) => {
  it.each([null, "wrong-test-key"])("denies invalid credentials before quotas and user lookup (%s)", async (key) => {
    const response = await route(request(key))
    expect(response.status).toBe(401)
    expect(mocks.limit).not.toHaveBeenCalled()
    expect(mocks.findUser).not.toHaveBeenCalled()
    expect(mocks.balance).not.toHaveBeenCalled()
    expect(mocks.projects).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain(testKey)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(testKey)
  })

  it("fails closed when the shared secret is not configured", async () => {
    vi.stubEnv("ATAI_INTERNAL_KEY", "")
    expect((await route(request())).status).toBe(503)
    expect(mocks.limit).not.toHaveBeenCalled()
    expect(mocks.findUser).not.toHaveBeenCalled()
  })

  it("uses one hashed credential bucket despite changing identity headers", async () => {
    expect((await route(request(testKey, "192.0.2.1"))).status).toBe(200)
    expect((await route(request(testKey, "198.51.100.2"))).status).toBe(200)
    const expected = { action: "internal_api", identifier: createHash("sha256").update(testKey).digest("hex"), limit: 120, windowMs: 60_000 }
    expect(mocks.limit.mock.calls).toEqual([[expected], [expected]])
    expect(mocks.limit.mock.invocationCallOrder[0]).toBeLessThan(mocks.findUser.mock.invocationCallOrder[0])
    expect(JSON.stringify(mocks.limit.mock.calls)).not.toContain(testKey)
  })

  it("rejects throttled calls before sensitive lookup and supplies Retry-After", async () => {
    const error = new AppError("RATE_LIMITED")
    error.retryAfterSeconds = 17
    mocks.limit.mockRejectedValueOnce(error)
    const response = await route(request())
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("17")
    expect(mocks.findUser).not.toHaveBeenCalled()
    expect(mocks.balance).not.toHaveBeenCalled()
    expect(mocks.projects).not.toHaveBeenCalled()
  })

  it("does not continue when quota storage is unavailable", async () => {
    mocks.limit.mockRejectedValueOnce(new AppError("DATABASE_UNAVAILABLE"))
    expect((await route(request())).status).toBe(503)
    expect(mocks.findUser).not.toHaveBeenCalled()
  })

  it("bounds query identifiers before lookup", async () => {
    expect((await route(request(testKey, "192.0.2.1", "x".repeat(255)))).status).toBe(422)
    expect(mocks.findUser).not.toHaveBeenCalled()
  })
})
