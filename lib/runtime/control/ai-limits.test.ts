import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ limit: vi.fn(), acquire: vi.fn(), release: vi.fn() }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: h.limit }))
vi.mock("@/lib/api/ai-lease", () => ({ acquireAiLease: h.acquire, AI_DEADLINE_MS: 540_000 }))
vi.mock("@/lib/logging/logger", () => ({ logger: { warn: vi.fn() } }))
import { runRuntimeAi } from "./ai-limits"
import { aiContext, aiSignal } from "@/lib/api/ai-context"
import { AppError } from "@/lib/errors"

beforeEach(() => {
  vi.clearAllMocks()
  h.limit.mockResolvedValue(undefined)
  h.release.mockResolvedValue(undefined)
  h.acquire.mockResolvedValue(h.release)
})

describe("runtime shared AI admission", () => {
  it.each([["ai.text", 30], ["ai.image", 6], ["ai.video", 6], ["web.crawl", 6]])("applies the %s quota to the authenticated owner", async (capability, limit) => {
    const result = await runRuntimeAi("owner", capability as string, async () => {
      expect(aiContext.getStore()?.userId).toBe("owner")
      return "done"
    })
    expect(result).toBe("done")
    expect(h.limit).toHaveBeenCalledWith(expect.objectContaining({ identifier: "owner", limit, windowMs: 60_000 }))
    expect(h.limit).toHaveBeenCalledWith(expect.objectContaining({ identifier: "owner", limit: 300, windowMs: 3_600_000 }))
    expect(h.acquire).toHaveBeenCalledWith("owner", capability)
    expect(h.release).toHaveBeenCalledOnce()
  })

  it.each(["quota", "lease"])("rejects %s exhaustion before execution and preserves Retry-After", async (phase) => {
    const error = new AppError("RATE_LIMITED")
    error.retryAfterSeconds = 37
    ;(phase === "quota" ? h.limit : h.acquire).mockRejectedValueOnce(error)
    const execute = vi.fn()
    await expect(runRuntimeAi("owner", "ai.text", execute)).rejects.toMatchObject({ code: "runtime_rate_limited", retryAfterSeconds: 37 })
    expect(execute).not.toHaveBeenCalled()
    expect(h.release).not.toHaveBeenCalled()
  })

  it("fails closed on storage errors", async () => {
    h.acquire.mockRejectedValueOnce(new Error("storage unavailable"))
    const execute = vi.fn()
    await expect(runRuntimeAi("owner", "ai.text", execute)).rejects.toThrow("storage unavailable")
    expect(execute).not.toHaveBeenCalled()
  })

  it("releases after provider failure", async () => {
    await expect(runRuntimeAi("owner", "ai.text", async () => { throw new Error("provider failed") })).rejects.toThrow("provider failed")
    expect(h.release).toHaveBeenCalledOnce()
  })

  it("does not acquire twice for trusted same-owner nesting", async () => {
    await runRuntimeAi("owner", "ai.text", () => runRuntimeAi("owner", "ai.image", async () => "ok"))
    expect(h.acquire).toHaveBeenCalledOnce()
    expect(h.release).toHaveBeenCalledOnce()
  })

  it("does not inherit another owner's admission", async () => {
    await aiContext.run({ userId: "other", signal: new AbortController().signal }, () => runRuntimeAi("owner", "ai.text", async () => "ok"))
    expect(h.acquire).toHaveBeenCalledWith("owner", "ai.text")
  })

  it("propagates disconnect to the provider and holds the lease until execution ends", async () => {
    const controller = new AbortController()
    await aiContext.run({ signal: controller.signal }, () => runRuntimeAi("owner", "ai.text", async () => {
      const signal = aiSignal()
      controller.abort()
      expect(signal.aborted).toBe(true)
      expect(h.release).not.toHaveBeenCalled()
    }))
    expect(h.release).toHaveBeenCalledOnce()
  })

  it("rejects a disconnect during acquisition and releases the acquired slot", async () => {
    const controller = new AbortController()
    h.acquire.mockImplementationOnce(async () => { controller.abort(); return h.release })
    const execute = vi.fn()
    await expect(aiContext.run({ signal: controller.signal }, () => runRuntimeAi("owner", "ai.text", execute))).rejects.toMatchObject({ code: "runtime_provider_timeout" })
    expect(execute).not.toHaveBeenCalled()
    expect(h.release).toHaveBeenCalledOnce()
  })
})
