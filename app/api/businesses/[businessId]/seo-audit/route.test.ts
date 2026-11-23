import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * End-to-end money path for the connected-business SEO audit.
 *
 * The founder's journey is: open a business → prove the address → press "Run
 * audit". The parts that must hold together are the ones a unit test of either
 * half cannot see:
 *
 *   - the route audits the PROVED address, never one supplied by the client;
 *   - the member is charged the admin-configured price (100 by default) BEFORE
 *     the crawl, and the crawl is told what was charged;
 *   - a balance below the price stops the run with 402 and no crawl;
 *   - a crawl that fails refunds exactly what was charged, once;
 *   - repricing in the admin surface changes the debit with no code change.
 *
 * Everything outside the surface is faked at the seam it is reached through:
 * session, membership, anchor resolution, the crawl, and the ledger.
 */

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireWorkspace: vi.fn(),
  actorOf: vi.fn(() => ({ kind: "user", userId: "member-1" })),
  resolveBusinessAnchor: vi.fn(),
  auditableSiteUrl: vi.fn(),
  getProject: vi.fn(),
  isFirecrawlConfigured: vi.fn(() => true),
  isSeoAuditEnabledForUser: vi.fn(() => true),
  runSeoAudit: vi.fn(),
  getLatestSeoAudit: vi.fn(),
  markSeoAuditRefund: vi.fn(),
  checkRateLimit: vi.fn(),
  getSeoAuditCosts: vi.fn(),
  getAvailableCredits: vi.fn(),
  consumeCredits: vi.fn(),
  grantCredits: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock("@/lib/business/http", () => ({ requireWorkspace: mocks.requireWorkspace, actorOf: mocks.actorOf }))
vi.mock("@/lib/connected-business/anchor", () => ({ resolveBusinessAnchor: mocks.resolveBusinessAnchor }))
vi.mock("@/lib/connected-business/site-url", () => ({ auditableSiteUrl: mocks.auditableSiteUrl }))
vi.mock("@/lib/integrations/firecrawl/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/firecrawl/client")>()),
  isFirecrawlConfigured: mocks.isFirecrawlConfigured,
}))
vi.mock("@/lib/marketing/feature-flags", () => ({ isSeoAuditEnabledForUser: mocks.isSeoAuditEnabledForUser }))
vi.mock("@/lib/marketing/seo/service", () => ({
  runSeoAudit: mocks.runSeoAudit,
  getLatestSeoAudit: mocks.getLatestSeoAudit,
  markSeoAuditRefund: mocks.markSeoAuditRefund,
}))
vi.mock("@/lib/store/store", () => ({
  store: { getProject: mocks.getProject },
  cryptoId: () => "cid",
}))
vi.mock("@/lib/billing/runtime-config", () => ({ getSeoAuditCosts: mocks.getSeoAuditCosts }))
vi.mock("@/lib/billing/credit-service", () => ({
  getAvailableCredits: mocks.getAvailableCredits,
  consumeCredits: mocks.consumeCredits,
  grantCredits: mocks.grantCredits,
}))
// The route is wrapped for AI protection; the wrapper only adds a lease.
vi.mock("@/lib/api/ai-protection", () => ({
  withAiProtection: (_kind: string, handler: unknown) => handler,
}))

import { POST } from "./route"

const BUSINESS_ID = "biz-1"
const PROJECT_ID = "anchor-project-1"
const PROVED_URL = "https://shop.example.com"

function request(body: unknown = {}): Request {
  return new Request(`https://app.example/api/businesses/${BUSINESS_ID}/seo-audit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const params = () => Promise.resolve({ businessId: BUSINESS_ID })

const completedAudit = {
  auditId: "audit-1",
  url: PROVED_URL,
  score: { pass: 6, fail: 2, notObserved: 1 },
  auditScore: { value: 72 },
  pagesCrawled: 4,
  findings: [],
  recommendations: [],
  recommendationsMeta: null,
  completedAt: Date.now(),
}

describe("business SEO audit — the founder's money path", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue({ id: "member-1", featurePreferences: {} })
    mocks.requireWorkspace.mockResolvedValue({ enabled: true })
    mocks.resolveBusinessAnchor.mockResolvedValue({ projectId: PROJECT_ID })
    mocks.getProject.mockResolvedValue({ id: PROJECT_ID, name: "Shop", userId: "owner-1" })
    mocks.auditableSiteUrl.mockResolvedValue({ url: PROVED_URL })
    mocks.isFirecrawlConfigured.mockReturnValue(true)
    mocks.isSeoAuditEnabledForUser.mockReturnValue(true)
    mocks.getSeoAuditCosts.mockResolvedValue({ auditCost: 100 })
    mocks.getAvailableCredits.mockResolvedValue(500)
    mocks.consumeCredits.mockResolvedValue({ success: true })
    mocks.grantCredits.mockResolvedValue({ success: true })
    mocks.runSeoAudit.mockResolvedValue(completedAudit)
    mocks.getLatestSeoAudit.mockResolvedValue(null)
  })

  it("charges the member 100 credits before crawling the proved address", async () => {
    const response = await POST(request({ requestId: "intent-abc" }), { params })
    const body = (await response.json()) as { ok: boolean; data: { creditsCharged: number } }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.creditsCharged).toBe(100)

    // Charged once, for the acting member, against the anchor project.
    expect(mocks.consumeCredits).toHaveBeenCalledTimes(1)
    const charge = mocks.consumeCredits.mock.calls[0][0] as Record<string, unknown>
    expect(charge.amount).toBe(100)
    expect(charge.userId).toBe("member-1")
    expect(charge.projectId).toBe(PROJECT_ID)

    // The crawl runs on the proved address and is told what it cost.
    const crawl = mocks.runSeoAudit.mock.calls[0][0] as Record<string, unknown>
    expect(crawl.url).toBe(PROVED_URL)
    expect(crawl.creditsCharged).toBe(100)
  })

  it("follows an admin repricing without a code change", async () => {
    mocks.getSeoAuditCosts.mockResolvedValue({ auditCost: 250 })

    const response = await POST(request(), { params })
    expect(response.status).toBe(200)

    const charge = mocks.consumeCredits.mock.calls[0][0] as Record<string, unknown>
    expect(charge.amount).toBe(250)
  })

  it("stops with 402 and never crawls when the balance is below the price", async () => {
    mocks.getAvailableCredits.mockResolvedValue(99)

    const response = await POST(request(), { params })
    const body = (await response.json()) as {
      ok: boolean
      error: { code: string; meta?: { required: number; available: number } }
    }

    expect(response.status).toBe(402)
    expect(body.error.code).toBe("INSUFFICIENT_CREDITS")
    expect(body.error.meta).toMatchObject({ required: 100, available: 99 })
    expect(mocks.consumeCredits).not.toHaveBeenCalled()
    expect(mocks.runSeoAudit).not.toHaveBeenCalled()
  })

  it("refunds exactly what was charged when the crawl fails", async () => {
    mocks.runSeoAudit.mockRejectedValue(new Error("crawler exploded"))

    const response = await POST(request({ requestId: "intent-fail" }), { params })

    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(mocks.grantCredits).toHaveBeenCalledTimes(1)
    const refund = mocks.grantCredits.mock.calls[0][0] as Record<string, unknown>
    expect(refund.amount).toBe(100)
    expect(refund.userId).toBe("member-1")
    expect(refund.projectId).toBe(PROJECT_ID)
  })

  it("refuses a business whose address is not proved, before any charge", async () => {
    mocks.auditableSiteUrl.mockResolvedValue(null)

    const response = await POST(request(), { params })
    const body = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("NOT_VERIFIED")
    expect(mocks.consumeCredits).not.toHaveBeenCalled()
    expect(mocks.runSeoAudit).not.toHaveBeenCalled()
  })
})
