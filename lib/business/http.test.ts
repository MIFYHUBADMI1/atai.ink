import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { mockEnabled, mockCheckRateLimit } = vi.hoisted(() => ({
  mockEnabled: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}))

vi.mock("./flags", () => ({ isBusinessWorkspaceEnabled: mockEnabled }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }))

import { AppError } from "@/lib/errors"
import { BUSINESS_RATE_LIMITS, requireWorkspace } from "./http"

beforeEach(() => {
  vi.clearAllMocks()
  mockEnabled.mockResolvedValue(true)
  mockCheckRateLimit.mockResolvedValue(undefined)
})

describe("requireWorkspace", () => {
  it("refuses a user outside the rollout without consulting the limiter", async () => {
    mockEnabled.mockResolvedValue(false)

    await expect(requireWorkspace("u1", "write")).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it("charges reads to the read bucket", async () => {
    await requireWorkspace("u1", "read")

    expect(mockCheckRateLimit).toHaveBeenCalledWith({
      action: "business.read",
      identifier: "u1",
      limit: BUSINESS_RATE_LIMITS.read.limit,
      windowMs: BUSINESS_RATE_LIMITS.read.windowMs,
    })
  })

  it("charges writes to the write bucket, which is the tighter one", async () => {
    await requireWorkspace("u1", "write")

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "business.write", limit: BUSINESS_RATE_LIMITS.write.limit }),
    )
    expect(BUSINESS_RATE_LIMITS.write.limit).toBeLessThan(BUSINESS_RATE_LIMITS.read.limit)
  })

  it("defaults to the read bucket", async () => {
    await requireWorkspace("u1")
    expect(mockCheckRateLimit).toHaveBeenCalledWith(expect.objectContaining({ action: "business.read" }))
  })

  it("propagates the limiter's refusal", async () => {
    mockCheckRateLimit.mockRejectedValue(new AppError("RATE_LIMITED"))

    await expect(requireWorkspace("u1", "write")).rejects.toMatchObject({ code: "RATE_LIMITED" })
  })
})
