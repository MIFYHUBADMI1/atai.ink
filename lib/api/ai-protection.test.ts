import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/lib/errors"
const mocks = vi.hoisted(() => ({ user: vi.fn(), rate: vi.fn(), acquire: vi.fn(), release: vi.fn() }))
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.user }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: mocks.rate }))
vi.mock("./ai-lease", () => ({ acquireAiLease: mocks.acquire, AI_DEADLINE_MS: 540000 }))
vi.mock("@/lib/logging/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
import { withAiProtection } from "./ai-protection"
import { aiSignal, trackAiCompletion } from "./ai-context"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ id: "trusted" })
  mocks.rate.mockResolvedValue(undefined)
  mocks.acquire.mockResolvedValue(mocks.release)
  mocks.release.mockResolvedValue(undefined)
})
const request = (body = "{}", signal?: AbortSignal) => new Request("http://localhost/api/test", { method: "POST", body, signal })

describe("AI route guard", () => {
  it("uses authenticated identity, preserves the body and releases after success", async () => {
    const handler = withAiProtection("chat", async (req) => Response.json(await req.json()))
    const response = await handler(request('{"userId":"victim"}'))
    expect(await response.json()).toEqual({ userId: "victim" })
    expect(mocks.acquire).toHaveBeenCalledWith("trusted", "chat")
    expect(mocks.rate.mock.calls.every(([p]) => p.identifier === "trusted")).toBe(true)
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })
  it("rejects unauthenticated traffic before storage or provider work", async () => {
    mocks.user.mockRejectedValue(new AppError("UNAUTHORIZED"))
    const work = vi.fn()
    expect((await withAiProtection("chat", work)(request())).status).toBe(401)
    expect(mocks.acquire).not.toHaveBeenCalled()
    expect(work).not.toHaveBeenCalled()
  })
  it("rejects limits without invoking billable work", async () => {
    const error = new AppError("RATE_LIMITED")
    error.retryAfterSeconds = 10
    mocks.rate.mockRejectedValue(error)
    const work = vi.fn()
    const response = await withAiProtection("visual", work)(request())
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("10")
    expect(work).not.toHaveBeenCalled()
    expect(mocks.acquire).not.toHaveBeenCalled()
  })
  it("rejects actual oversized bytes without Content-Length before billable work", async () => {
    const work = vi.fn()
    expect((await withAiProtection("chat", work)(request("x".repeat(262145)))).status).toBe(413)
    expect(work).not.toHaveBeenCalled()
    expect(mocks.acquire).not.toHaveBeenCalled()
  })
  it("releases on provider failure without leaking exception details", async () => {
    const response = await withAiProtection("chat", async () => { throw new Error("provider-secret") })(request())
    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(await response.text()).not.toContain("provider-secret")
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })
  it("keeps streaming leases until execution settles, including cancellation", async () => {
    let finish!: () => void
    let signal!: AbortSignal
    const abort = new AbortController()
    const handler = withAiProtection("chat", async () => {
      signal = aiSignal()
      trackAiCompletion(new Promise<void>((resolve) => { finish = resolve }))
      return new Response("stream")
    })
    expect((await handler(request("{}", abort.signal))).status).toBe(200)
    expect(mocks.release).not.toHaveBeenCalled()
    abort.abort()
    expect(signal.aborted).toBe(true)
    expect(mocks.release).not.toHaveBeenCalled()
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })
})
