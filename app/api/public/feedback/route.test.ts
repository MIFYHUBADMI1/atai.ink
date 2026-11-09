import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
const mock = vi.hoisted(() => ({ limit: vi.fn(), update: vi.fn(), count: vi.fn(async () => 0) }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: mock.limit }))
vi.mock("@/lib/db/collections", () => ({ docFeedbackCol: async () => ({ updateOne: mock.update, countDocuments: mock.count }) }))
import { POST } from "./route"
import { AppError } from "@/lib/errors"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("VERCEL", "")
  vi.stubEnv("TRUSTED_PROXY_HOPS", "")
})
afterEach(() => vi.unstubAllEnvs())
const request = (ip: string) => new NextRequest("http://localhost/api/public/feedback", {
  method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ sectionId: "account", vote: "up" }),
})

describe("feedback forwarding identity", () => {
  it("cannot bypass limits or mint visitor IDs by changing untrusted forwarding", async () => {
    expect((await POST(request("192.0.2.1"))).status).toBe(200)
    expect((await POST(request("192.0.2.2"))).status).toBe(200)
    expect(mock.limit).toHaveBeenCalledWith(expect.objectContaining({ identifier: "anonymous" }))
    expect(mock.update.mock.calls[0][0]).toEqual(mock.update.mock.calls[1][0])
  })
  it("does not write feedback after limiter rejection", async () => {
    mock.limit.mockRejectedValueOnce(new AppError("RATE_LIMITED"))
    expect((await POST(request("192.0.2.1"))).status).toBe(429)
    expect(mock.update).not.toHaveBeenCalled()
  })
  it("rejects oversized bodies before parsing or writing", async () => {
    const res = await POST(new NextRequest("http://localhost/api/public/feedback", {
      method: "POST",
      headers: { "x-forwarded-for": "192.0.2.1" },
      body: JSON.stringify({ sectionId: "account", vote: "up", visitorId: "x".repeat(4096) }),
    }))
    expect(res.status).toBe(413)
    expect(mock.update).not.toHaveBeenCalled()
  })
})
