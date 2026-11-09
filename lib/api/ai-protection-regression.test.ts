import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  user: vi.fn(), check: vi.fn(), acquire: vi.fn(), release: vi.fn(), warn: vi.fn(),
}))
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.user }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: mocks.check }))
vi.mock("./ai-lease", () => ({ acquireAiLease: mocks.acquire, AI_DEADLINE_MS: 540_000 }))
vi.mock("@/lib/logging/logger", () => ({ logger: { warn: mocks.warn, error: vi.fn() } }))
import { AI_LIMITS, withAiProtection } from "./ai-protection"
import { aiContext, aiSignal, trackAiCompletion } from "./ai-context"
import { AppError } from "@/lib/errors"

const request = (body = "{}", signal?: AbortSignal, headers?: HeadersInit) => new Request("http://localhost/api/operation?view=full", {
  method: "POST", body, signal, headers,
})
const handler = vi.fn(async () => Response.json({ charged: true }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.user.mockResolvedValue({ id: "verified-user" })
  mocks.check.mockResolvedValue(undefined)
  mocks.release.mockResolvedValue(undefined)
  mocks.acquire.mockResolvedValue(mocks.release)
  handler.mockResolvedValue(Response.json({ charged: true }))
})
afterEach(() => vi.restoreAllMocks())

describe("AI request protection boundaries", () => {
  it.each(Object.keys(AI_LIMITS) as (keyof typeof AI_LIMITS)[])("applies %s quotas to the authenticated account before execution", async (kind) => {
    const response = await withAiProtection(kind, handler)(request('{"userId":"forged-user"}'))
    expect(response.status).toBe(200)
    expect(mocks.check.mock.calls.map(([params]) => params)).toEqual([
      { action: `ai_${kind}_burst`, identifier: "verified-user", limit: AI_LIMITS[kind].minute, windowMs: 60_000 },
      { action: `ai_${kind}_volume`, identifier: "verified-user", limit: AI_LIMITS[kind].hour, windowMs: 3_600_000 },
    ])
    expect(mocks.check.mock.invocationCallOrder[1]).toBeLessThan(mocks.acquire.mock.invocationCallOrder[0])
    expect(mocks.acquire.mock.invocationCallOrder[0]).toBeLessThan(handler.mock.invocationCallOrder[0])
    expect(mocks.acquire).toHaveBeenCalledWith("verified-user", kind)
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("rejects unauthenticated requests without creating buckets or executing work", async () => {
    mocks.user.mockRejectedValue(new AppError("UNAUTHORIZED"))
    expect((await withAiProtection("visual", handler)(request())).status).toBe(401)
    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.acquire).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([0, 1])("rejects quota layer %i without charging and supplies retry information", async (layer) => {
    const error = new AppError("RATE_LIMITED")
    error.retryAfterSeconds = 23
    if (layer) mocks.check.mockResolvedValueOnce(undefined)
    mocks.check.mockRejectedValueOnce(error)
    const response = await withAiProtection("resources", handler)(request())
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("23")
    expect(mocks.acquire).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it.each(["check", "acquire"] as const)("fails closed when %s storage fails", async (operation) => {
    mocks[operation].mockRejectedValue(new AppError("DATABASE_UNAVAILABLE"))
    expect((await withAiProtection("resources", handler)(request())).status).toBe(503)
    expect(handler).not.toHaveBeenCalled()
  })

  it("rejects a full concurrency pool without executing the handler", async () => {
    mocks.acquire.mockRejectedValue(new AppError("RATE_LIMITED"))
    expect((await withAiProtection("chat", handler)(request())).status).toBe(429)
    expect(handler).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it.each(["declared", "actual"])("caps %s body bytes before acquiring a slot", async (mode) => {
    const req = mode === "declared" ? request("{}", undefined, { "content-length": String(256 * 1024 + 1) }) : request("x".repeat(256 * 1024 + 1))
    expect((await withAiProtection("chat", handler)(req)).status).toBe(413)
    expect(mocks.acquire).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it("preserves the full allowed body, URL, cookies and route context", async () => {
    const body = "x".repeat(256 * 1024)
    const context = { params: Promise.resolve({ id: "project-1" }) }
    const inspect = vi.fn(async (req: NextRequest, passed: typeof context) => {
      expect(req).toBeInstanceOf(NextRequest)
      expect(await req.text()).toBe(body)
      expect(req.cookies.get("session")?.value).toBe("opaque-test-cookie")
      expect(req.nextUrl.searchParams.get("view")).toBe("full")
      expect(passed).toBe(context)
      expect(aiContext.getStore()?.signal).toBeDefined()
      return new Response(null, { status: 204 })
    })
    expect((await withAiProtection("chat", inspect)(request(body, undefined, { cookie: "session=opaque-test-cookie" }), context)).status).toBe(204)
    expect(aiContext.getStore()).toBeUndefined()
  })

  it("releases the lease when the provider or handler throws", async () => {
    handler.mockRejectedValue(new Error("provider rejected"))
    expect((await withAiProtection("chat", handler)(request())).status).toBe(500)
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("does not replace a successful result when lease deletion fails", async () => {
    mocks.release.mockRejectedValue(new Error("storage unavailable"))
    expect((await withAiProtection("chat", handler)(request())).status).toBe(200)
    expect(mocks.warn).toHaveBeenCalledOnce()
  })

  it.each(["resolve", "reject"] as const)("holds streaming slots until completion promises %s", async (outcome) => {
    const completion = Promise.withResolvers<void>()
    const streamHandler = vi.fn(async () => {
      trackAiCompletion(completion.promise)
      return new Response("stream started")
    })
    expect((await withAiProtection("chat", streamHandler)(request())).status).toBe(200)
    expect(mocks.release).not.toHaveBeenCalled()
    if (outcome === "resolve") completion.resolve()
    else completion.reject(new Error("stream failed"))
    await completion.promise.catch(() => {})
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("does not execute an already aborted request", async () => {
    const abort = new AbortController()
    abort.abort()
    expect((await withAiProtection("chat", handler)(request("{}", abort.signal))).status).toBe(503)
    expect(handler).not.toHaveBeenCalled()
    expect(mocks.acquire).not.toHaveBeenCalled()
  })

  it("does not start billable work if the request aborts while acquiring its lease", async () => {
    const abort = new AbortController()
    mocks.acquire.mockImplementation(async () => {
      abort.abort()
      return mocks.release
    })
    expect((await withAiProtection("chat", handler)(request("{}", abort.signal))).status).toBe(503)
    expect(handler).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("propagates client cancellation to the provider signal", async () => {
    const abort = new AbortController()
    const provider = vi.fn(async () => {
      const signal = aiSignal()
      expect(signal.aborted).toBe(false)
      abort.abort()
      expect(signal.aborted).toBe(true)
      return Response.json({ cancelled: true })
    })
    await withAiProtection("chat", provider)(request("{}", abort.signal))
    expect(provider).toHaveBeenCalledOnce()
    expect(mocks.release).toHaveBeenCalledOnce()
  })
})
