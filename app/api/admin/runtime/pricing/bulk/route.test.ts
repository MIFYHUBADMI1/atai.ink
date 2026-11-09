import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const { mockRequireAdmin, mockBulkUpsert, mockParseBulk } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockBulkUpsert: vi.fn(),
  mockParseBulk: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: mockRequireAdmin,
}))

vi.mock("@/lib/runtime/admin/pricing-service", () => ({
  bulkUpsertAdminRuntimePricingRules: mockBulkUpsert,
  parseBulkRuleInput: mockParseBulk,
  MAX_BULK_PRICING_RULES: 200,
}))

vi.mock("@/lib/runtime/router/adapters/register-all", () => ({
  registerAllRuntimeAdapters: vi.fn(),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from "./route"
import { AppError } from "@/lib/errors"

function request(body: unknown) {
  return new Request("https://atai.example/api/admin/runtime/pricing/bulk", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

describe("bulk runtime pricing authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("unauthenticated bulk apply is rejected", async () => {
    mockRequireAdmin.mockRejectedValueOnce(new AppError("UNAUTHORIZED"))
    const res = await POST(request({ rules: [] }))
    expect(res.status).toBe(401)
    expect(mockBulkUpsert).not.toHaveBeenCalled()
  })

  it("non-admin bulk apply is rejected", async () => {
    mockRequireAdmin.mockRejectedValueOnce(new AppError("UNAUTHORIZED", "Admin access required.", 403))
    const res = await POST(request({ rules: [] }))
    expect(res.status).toBe(403)
    expect(mockBulkUpsert).not.toHaveBeenCalled()
  })

  it("an invalid bulk payload never reaches the rule store", async () => {
    mockRequireAdmin.mockResolvedValue({ id: "admin_1" })
    mockParseBulk.mockReturnValueOnce({ ok: false, error: "rules are required" })
    const res = await POST(request({ rules: [{ provider: "openrouter" }] }))
    expect(res.status).toBe(422)
    expect(mockBulkUpsert).not.toHaveBeenCalled()
  })

  it("admin bulk apply reports per-row outcomes", async () => {
    mockRequireAdmin.mockResolvedValue({ id: "admin_1" })
    mockParseBulk.mockReturnValueOnce({ ok: true, data: { rules: [{ provider: "openrouter", capability: "ai.text", operation: "chat", mode: "fixed_per_request", credits: 9 }] } })
    mockBulkUpsert.mockResolvedValueOnce({
      created: 1,
      updated: 0,
      unchanged: 0,
      rejected: 0,
      rows: [{ provider: "openrouter", capability: "ai.text", operation: "chat", outcome: "created" }],
    })
    const res = await POST(request({ provider: "openrouter" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(1)
    expect(body.data.maxBulkRules).toBe(200)
  })
})
