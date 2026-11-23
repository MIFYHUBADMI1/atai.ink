import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The authorisation contract of every business-addressed stepper endpoint.
 *
 * A business operation is authorised by membership, but the records it touches
 * belong to the owning account. These tests pin both halves: a non-member gets
 * 404, a member without the permission gets 403, and the services receive the
 * record owner (keys, domains) or the acting member (credits).
 */

const {
  requireUser,
  requireWorkspace,
  resolveBusinessAnchorProject,
  startIntakeRun,
  buildIntakeView,
  readHostnameOf,
  listProjectDomains,
  registerDomain,
  toDomainView,
  setDomainMethod,
  verifyDomainOwnership,
  getProject,
  createApiKey,
  revokeApiKey,
  connectionView,
  markGuideIssued,
  refreshConnectionStatus,
  revokeConnection,
  buildIntegrationGuide,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireWorkspace: vi.fn(),
  resolveBusinessAnchorProject: vi.fn(),
  startIntakeRun: vi.fn(),
  buildIntakeView: vi.fn(() => ({ ok: true })),
  readHostnameOf: vi.fn(() => "acme.com"),
  listProjectDomains: vi.fn(async () => []),
  registerDomain: vi.fn(),
  toDomainView: vi.fn((doc: unknown) => doc),
  setDomainMethod: vi.fn(),
  verifyDomainOwnership: vi.fn(),
  getProject: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(async () => true),
  connectionView: vi.fn(async () => ({ status: "pending", verifiedDomain: null })),
  markGuideIssued: vi.fn(async () => "pending"),
  refreshConnectionStatus: vi.fn(async () => "revoked"),
  revokeConnection: vi.fn(async () => {}),
  buildIntegrationGuide: vi.fn(() => "# guide"),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser }))
vi.mock("@/lib/business/http", () => ({
  requireWorkspace,
  actorOf: (user: { id: string }) => ({ kind: "user", id: user.id }),
}))
vi.mock("@/lib/connected-business/anchor", () => ({ resolveBusinessAnchorProject }))
vi.mock("@/lib/existing-business/intake", () => ({ startIntakeRun }))
vi.mock("@/lib/existing-business/view", () => ({ buildIntakeView, readHostnameOf }))
vi.mock("@/lib/domain/service", () => ({
  listProjectDomains,
  registerDomain,
  toDomainView,
  setDomainMethod,
  regenerateChallenge: vi.fn(),
  releaseDomain: vi.fn(),
  verifyDomainOwnership,
  DomainServiceError: class DomainServiceError extends Error {
    code = "DOMAIN_ERROR"
    status = 400
  },
}))
vi.mock("@/lib/connected-business/service", () => ({
  connectionView,
  markGuideIssued,
  refreshConnectionStatus,
  revokeConnection,
}))
vi.mock("@/lib/connected-business/guide", () => ({
  CONNECTION_KEY_SCOPES: ["runtime:read"],
  INTEGRATION_GUIDE_VERSION: "1",
  buildIntegrationGuide,
}))
vi.mock("@/lib/runtime/keys/service", () => ({ createApiKey, revokeApiKey }))
vi.mock("@/lib/store/store", () => ({ store: { getProject } }))
vi.mock("@/lib/env", () => ({ getAppUrl: () => "https://atai.ink" }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => {}) }))

const { AppError } = await import("@/lib/errors")
const intake = await import("./intake/route")
const reading = await import("./intake/reading/route")
const guide = await import("./integration-guide/route")
const domains = await import("./domains/route")
const domainActions = await import("./domains/[domainId]/route")
const verify = await import("./domains/[domainId]/verify/route")

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) })
const post = (body: unknown = {}) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const project = {
  id: "p1",
  userId: "owner",
  name: "Acme",
  intake: { displayName: "Acme", website: { url: "https://acme.com" } },
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: "member", featurePreferences: {} })
  requireWorkspace.mockResolvedValue({ enabled: true })
  resolveBusinessAnchorProject.mockResolvedValue({ project, ownerId: "owner" })
  getProject.mockResolvedValue(project)
})

describe.each([
  ["intake GET", () => intake.GET(new Request("http://localhost"), params({ businessId: "biz_1" })), "growth.read"],
  ["intake POST", () => intake.POST(post(), params({ businessId: "biz_1" })), "growth.read"],
  ["reading GET", () => reading.GET(new Request("http://localhost"), params({ businessId: "biz_1" })), "growth.read"],
  ["domains GET", () => domains.GET(new Request("http://localhost"), params({ businessId: "biz_1" })), "growth.read"],
  ["domains POST", () => domains.POST(post({ url: "https://acme.com" }), params({ businessId: "biz_1" })), "apps.manage"],
  [
    "domain PATCH",
    () => domainActions.PATCH(post({ action: "regenerate" }), params({ businessId: "biz_1", domainId: "d1" })),
    "apps.manage",
  ],
  [
    "domain verify",
    () => verify.POST(post({}), params({ businessId: "biz_1", domainId: "d1" })),
    "apps.manage",
  ],
  ["guide GET", () => guide.GET(new Request("http://localhost"), params({ businessId: "biz_1" })), "growth.read"],
  ["guide POST", () => guide.POST(post(), params({ businessId: "biz_1" })), "runtime.keys.manage"],
  ["guide DELETE", () => guide.DELETE(new Request("http://localhost"), params({ businessId: "biz_1" })), "runtime.keys.manage"],
] as const)("%s", (_name, call, permission) => {
  it("asks for the documented permission", async () => {
    await call()

    expect(resolveBusinessAnchorProject).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "biz_1", actor: { kind: "user", id: "member" }, permission }),
    )
  })

  it("answers 404 for an unknown business or a non-member", async () => {
    resolveBusinessAnchorProject.mockRejectedValue(new AppError("BUSINESS_NOT_FOUND", "Not found.", 404))

    const response = await call()

    expect(response.status).toBe(404)
  })

  it("answers 403 for a member without the permission", async () => {
    resolveBusinessAnchorProject.mockRejectedValue(new AppError("FORBIDDEN", "Not allowed.", 403))

    const response = await call()

    expect(response.status).toBe(403)
  })
})

describe("who pays and who owns the records", () => {
  it("charges the acting member for an intake run", async () => {
    startIntakeRun.mockResolvedValue({ ok: true, started: true })

    await intake.POST(post(), params({ businessId: "biz_1" }))

    expect(startIntakeRun).toHaveBeenCalledWith("p1", { userId: "member", allowReassessment: false })
  })

  it("issues the connection key on the owning account, not the member", async () => {
    createApiKey.mockResolvedValue({ id: "k1", secret: "sk_live_x", keyPrefix: "sk_live" })

    await guide.POST(post(), params({ businessId: "biz_1" }))

    expect(createApiKey).toHaveBeenCalledWith("owner", expect.objectContaining({ projectId: "p1" }))
  })

  it("registers a domain on the owning account, not the member", async () => {
    registerDomain.mockResolvedValue({ doc: { id: "d1" }, created: true })

    await domains.POST(post({ url: "https://acme.com" }), params({ businessId: "biz_1" }))

    expect(registerDomain).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", projectId: "p1" }))
  })
})
