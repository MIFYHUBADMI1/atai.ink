import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  user: vi.fn(),
  ownership: vi.fn(),
  project: vi.fn(),
  authorize: vi.fn(),
  generate: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser: h.user }))
vi.mock("@/lib/runtime/ownership", () => ({ checkProjectOwnership: h.ownership }))
vi.mock("@/lib/marketing/feature-flags", () => ({ isMarketStudioEnabled: () => true }))
vi.mock("@/lib/runtime/router/adapters/availability", () => ({
  capabilityAvailability: () => ({ "ai.text": { configured: true } }),
}))
vi.mock("@/lib/integrations/firecrawl/client", () => ({ isFirecrawlConfigured: () => true }))
vi.mock("@/lib/store/store", () => ({ store: { getProject: h.project } }))
vi.mock("@/lib/marketing/growth-overview", () => ({ readOwnerGoals: () => ({}) }))
vi.mock("@/lib/marketing/competition-snapshot", () => ({ generateCompetitionSnapshot: h.generate }))
vi.mock("@/lib/api/ai-protection", () => ({ withAiProtection: (_kind: string, handler: unknown) => handler }))
vi.mock("@/lib/billing/entitlements/require", () => ({
  authorizeCompetitionIntel: h.authorize,
  entitlementDenial: (check: { allowed: boolean; code?: string; reason?: string } | null) =>
    check && !check.allowed
      ? { code: check.code ?? "ENTITLEMENT_DENIED", message: check.reason ?? "denied" }
      : null,
}))

import { POST } from "./route"

const context = { params: Promise.resolve({ id: "p1" }) }
const request = () => new Request("http://localhost/api/projects/p1/market/competition-snapshot", { method: "POST" })

beforeEach(() => {
  vi.clearAllMocks()
  h.user.mockResolvedValue({ id: "u1", email: "u@example.com" })
  h.ownership.mockResolvedValue({ ok: true, reason: "ok" })
  h.project.mockResolvedValue({ id: "p1", userId: "u1", specification: { title: "Shop" } })
  h.authorize.mockResolvedValue(null)
  h.generate.mockResolvedValue({
    id: "snap_1",
    title: "Landscape",
    body: "body",
    creditsCharged: 10,
    createdAt: 1,
  })
})

describe("POST competition snapshot — entitlement", () => {
  it("refuses a plan without competition intelligence before research or credits", async () => {
    h.authorize.mockResolvedValue({
      allowed: false,
      code: "COMPETITION_MONITORING_UNAVAILABLE",
      reason: "Competition monitoring requires Growth or higher.",
    })
    const response = await POST(request(), context)
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "COMPETITION_MONITORING_UNAVAILABLE" },
    })
    expect(h.generate).not.toHaveBeenCalled()
  })

  it("runs research only after the purchased capability is confirmed", async () => {
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    expect(h.authorize).toHaveBeenCalledWith("u1")
    expect(h.generate).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", projectId: "p1" }))
  })

  it("does not check entitlement for a project the caller does not own", async () => {
    h.ownership.mockResolvedValue({ ok: false, reason: "not_owned" })
    expect((await POST(request(), context)).status).toBe(404)
    expect(h.authorize).not.toHaveBeenCalled()
    expect(h.generate).not.toHaveBeenCalled()
  })
})
