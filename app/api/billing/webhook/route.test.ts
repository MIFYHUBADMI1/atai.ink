import { describe, expect, it, vi } from "vitest"

/**
 * The webhook must hash the raw bytes for HMAC verification, so it can't use
 * the shared JSON body guard — it carries its own 1 MB cap. Without it, any
 * caller could stream an unbounded body into memory before verification.
 */

const { mockVerify } = vi.hoisted(() => ({ mockVerify: vi.fn(() => ({ valid: false, error: "bad signature" })) }))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db/collections", () => ({ webhookEventsCol: vi.fn() }))
vi.mock("@/lib/billing/dodo-webhook", () => ({ verifyWebhookSignature: mockVerify }))
vi.mock("@/lib/billing/dodo-event-processing", () => ({ processDodoEvent: vi.fn() }))
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { POST } from "./route"

describe("POST /api/billing/webhook — body limits", () => {
  it("rejects a declared oversized body before reading it", async () => {
    const text = vi.fn(async () => "{}")
    const req = {
      headers: new Headers({ "content-length": "2000000" }),
      text,
    } as unknown as Request

    const res = await POST(req)

    expect(res.status).toBe(413)
    expect(text).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it("rejects an oversized streamed body before signature verification", async () => {
    const req = new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      body: "x".repeat(1_000_001),
    })

    const res = await POST(req)

    expect(res.status).toBe(413)
    expect(mockVerify).not.toHaveBeenCalled()
  })
})
