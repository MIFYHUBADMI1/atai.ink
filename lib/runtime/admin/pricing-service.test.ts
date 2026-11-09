import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const {
  mockGetRules,
  mockUpdateRules,
  mockResolveAdapter,
  mockListProviders,
  mockListCapabilities,
  mockGetCapability,
  mockResolvePrice,
} = vi.hoisted(() => ({
  mockGetRules: vi.fn(),
  mockUpdateRules: vi.fn(),
  mockResolveAdapter: vi.fn(),
  mockListProviders: vi.fn(),
  mockListCapabilities: vi.fn(),
  mockGetCapability: vi.fn(),
  mockResolvePrice: vi.fn(),
}))

vi.mock("@/lib/billing/runtime-config", () => ({
  getRuntimePricingRules: mockGetRules,
  updateRuntimePricingRules: mockUpdateRules,
  RUNTIME_PRICING_MODES: ["fixed_per_request", "per_1k_tokens"],
}))

vi.mock("@/lib/runtime/router/provider-registry", () => ({
  listProviders: mockListProviders,
  resolveProviderAdapter: mockResolveAdapter,
}))

vi.mock("@/lib/runtime/router/capability-registry", () => ({
  listCapabilities: mockListCapabilities,
  getCapability: mockGetCapability,
}))

vi.mock("@/lib/runtime/metering/resolver", () => ({
  resolveRuntimePrice: mockResolvePrice,
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/infrastructure/audit", () => ({
  logAuditAction: vi.fn().mockResolvedValue(undefined),
}))

import {
  buildPricingMatrix,
  bulkUpsertAdminRuntimePricingRules,
  parseBulkRuleInput,
} from "./pricing-service"

const chatSpec = { provider: "openrouter", capability: "ai.text", operation: "chat", mode: "fixed_per_request", credits: 7 }

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rpr_existing",
    provider: "openrouter",
    capability: "ai.text",
    operation: "chat",
    mode: "fixed_per_request",
    credits: 7,
    active: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockListCapabilities.mockReturnValue([
    { id: "ai.text", operations: ["chat", "embed"] },
    { id: "payments", operations: ["checkout"] },
  ])
  mockListProviders.mockReturnValue(["openrouter"])
  mockGetCapability.mockImplementation((id: string) =>
    id === "ai.text" ? { id, operations: ["chat", "embed"] } : id === "payments" ? { id, operations: ["checkout"] } : null,
  )
  // ai.text/chat is wired; ai.text/embed and payments/checkout have no adapter.
  mockResolveAdapter.mockImplementation((cap: string, op: string) =>
    cap === "ai.text" && op === "chat" ? { provider: "openrouter" } : null,
  )
  mockGetRules.mockResolvedValue([])
  mockUpdateRules.mockImplementation(async (rules: unknown[]) => rules)
  mockResolvePrice.mockResolvedValue({
    chargeable: true,
    source: "legacy",
    snapshot: { mode: "fixed_per_request" },
    fixedCredits: 8,
  })
})

describe("buildPricingMatrix", () => {
  it("auto-resolves the provider for every capability × operation", async () => {
    const matrix = await buildPricingMatrix()
    expect(matrix.map((m) => `${m.capability}/${m.operation}:${m.provider ?? "unwired"}`)).toEqual([
      "ai.text/chat:openrouter",
      "ai.text/embed:unwired",
      "payments/checkout:unwired",
    ])
  })

  it("reports the price the runtime would actually charge, per operation", async () => {
    mockGetRules.mockResolvedValue([rule()])
    mockResolvePrice.mockImplementation(async ({ capability, operation }: any) =>
      capability === "ai.text" && operation === "chat"
        ? { chargeable: true, source: "rule", pricingRuleId: "rpr_existing", snapshot: { mode: "fixed_per_request" }, fixedCredits: 7 }
        : (() => { throw new Error("RuntimePricingUnconfiguredError") })(),
    )

    const matrix = await buildPricingMatrix()
    const chat = matrix.find((m) => m.capability === "ai.text" && m.operation === "chat")!
    expect(chat.effective).toMatchObject({ source: "rule", mode: "fixed_per_request", credits: 7, ruleId: "rpr_existing" })
    expect(chat.rule).toMatchObject({ id: "rpr_existing", active: true, mode: "fixed_per_request" })
    expect(chat.suggestedMode).toBe("fixed_per_request")

    const embed = matrix.find((m) => m.operation === "embed")!
    expect(embed.effective.source).toBe("unconfigured")
  })

  it("marks non-billable operations instead of inventing a price", async () => {
    mockResolvePrice.mockResolvedValue({ chargeable: false, snapshot: {} })
    const matrix = await buildPricingMatrix()
    expect(matrix.every((m) => m.effective.source === "non_billable")).toBe(true)
  })
})

describe("bulkUpsertAdminRuntimePricingRules", () => {
  it("creates missing rules and updates rates on an active one, in ONE write", async () => {
    mockGetRules.mockResolvedValue([rule()])

    const result = await bulkUpsertAdminRuntimePricingRules({
      adminId: "admin_1",
      specs: [
        { provider: "openrouter", capability: "ai.text", operation: "chat", mode: "fixed_per_request", credits: 12 },
        { provider: "openrouter", capability: "ai.text", operation: "embed", mode: "per_1k_tokens", inputPer1k: 1, outputPer1k: 3 },
      ],
    })

    expect(result).toMatchObject({ created: 1, updated: 1, unchanged: 0, rejected: 0 })
    expect(mockUpdateRules).toHaveBeenCalledTimes(1)
    const written = mockUpdateRules.mock.calls[0][0]
    expect(written).toHaveLength(2)
    expect(written.find((r: any) => r.operation === "chat").credits).toBe(12)
    const embed = written.find((r: any) => r.operation === "embed")
    expect(embed).toMatchObject({ mode: "per_1k_tokens", inputPer1k: 1, outputPer1k: 3 })
    expect("credits" in embed).toBe(false)
  })

  it("rejects a mode change on an active rule instead of silently swapping rates", async () => {
    mockGetRules.mockResolvedValue([rule()])

    const result = await bulkUpsertAdminRuntimePricingRules({
      adminId: "admin_1",
      specs: [{ provider: "openrouter", capability: "ai.text", operation: "chat", mode: "per_1k_tokens", inputPer1k: 1, outputPer1k: 1 }],
    })

    expect(result.rejected).toBe(1)
    expect(result.rows[0].error).toMatch(/mode is immutable/i)
    expect(mockUpdateRules).not.toHaveBeenCalled()
  })

  it("rejects rows the live registries do not know, without touching the store", async () => {
    const result = await bulkUpsertAdminRuntimePricingRules({
      adminId: "admin_1",
      specs: [
        { provider: "ghost", capability: "ai.text", operation: "chat", mode: "fixed_per_request", credits: 5 },
        { provider: "openrouter", capability: "ai.text", operation: "nope", mode: "fixed_per_request", credits: 5 },
        { provider: "openrouter", capability: "ai.text", operation: "chat", mode: "fixed_per_request" } as any,
      ],
    })

    expect(result.rejected).toBe(3)
    expect(result.rows.map((r) => r.error).join(" |")).toMatch(/Unknown provider/)
    expect(result.rows[1].error).toMatch(/not valid for capability/)
    expect(result.rows[2].error).toMatch(/requires a credits value/)
    expect(mockUpdateRules).not.toHaveBeenCalled()
  })

  it("counts an identical rate as unchanged so updatedAt and audit stay clean", async () => {
    mockGetRules.mockResolvedValue([rule()])

    const result = await bulkUpsertAdminRuntimePricingRules({
      adminId: "admin_1",
      specs: [{ provider: "openrouter", capability: "ai.text", operation: "chat", mode: "fixed_per_request", credits: 7 }],
    })

    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 1, rejected: 0 })
    expect(mockUpdateRules).not.toHaveBeenCalled()
  })

  it("rejects a duplicated triple inside one request", async () => {
    const result = await bulkUpsertAdminRuntimePricingRules({
      adminId: "admin_1",
      specs: [chatSpec, chatSpec],
    })
    expect(result).toMatchObject({ created: 1, rejected: 1 })
    expect(result.rows[1].error).toMatch(/duplicate row/i)
  })

  it("parseBulkRuleInput refuses an empty or malformed batch", () => {
    expect(parseBulkRuleInput({ rules: [] }).ok).toBe(false)
    expect(parseBulkRuleInput({ rules: [{ provider: "openrouter" }] }).ok).toBe(false)
    expect(parseBulkRuleInput({ rules: [{ ...chatSpec, unknownField: 1 }] }).ok).toBe(false)
    const valid = parseBulkRuleInput({ rules: [chatSpec] })
    expect(valid.ok).toBe(true)
  })
})
