import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  user: vi.fn(),
  project: vi.fn(),
  updateProject: vi.fn(),
  appendEvent: vi.fn(),
  addDomain: vi.fn(),
  removeDomain: vi.fn(),
  deployStatus: vi.fn(),
  authorize: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser: h.user }))
vi.mock("@/lib/store/store", () => ({
  cryptoId: () => "event-test",
  store: { getProject: h.project, updateProject: h.updateProject, appendEvent: h.appendEvent },
}))
vi.mock("@/lib/integrations/totalum/service", () => ({
  addCustomDomain: h.addDomain,
  removeCustomDomain: h.removeDomain,
  isTotalumConfigured: () => true,
  getDeploymentStatus: h.deployStatus,
}))
vi.mock("@/lib/billing/entitlements/require", () => ({
  authorizeCustomDomain: h.authorize,
  entitlementDenial: (check: { allowed: boolean; code?: string; reason?: string } | null) =>
    check && !check.allowed
      ? { code: check.code ?? "ENTITLEMENT_DENIED", message: check.reason ?? "denied" }
      : null,
}))

import { DELETE, PUT } from "./route"

const context = { params: Promise.resolve({ id: "p1" }) }
const request = (hostname = "app.example.com") =>
  new Request("http://localhost/api/projects/p1/domain", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hostname }),
  })

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    userId: "u1",
    state: "ready",
    totalumProjectId: "tp_1",
    deployment: { id: "d1", status: "success", updatedAt: 1 },
    deploymentHistory: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.user.mockResolvedValue({ id: "u1" })
  h.project.mockResolvedValue(project())
  h.authorize.mockResolvedValue(null)
  h.deployStatus.mockResolvedValue({ status: "success" })
  h.addDomain.mockResolvedValue({ hostname: "app.example.com", status: "pending", dnsRecordsToAdd: [] })
  h.removeDomain.mockResolvedValue({ message: "removed" })
})

describe("PUT /api/projects/:id/domain — entitlement", () => {
  it("refuses a plan without a custom-domain registration before calling the provider", async () => {
    h.authorize.mockResolvedValue({ allowed: false, code: "CUSTOM_DOMAIN_NOT_INCLUDED", reason: "No custom domain on this plan." })
    const response = await PUT(request(), context)
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CUSTOM_DOMAIN_NOT_INCLUDED" } })
    expect(h.deployStatus).not.toHaveBeenCalled()
    expect(h.addDomain).not.toHaveBeenCalled()
  })

  it("checks a new domain against the purchased cap and records the active hostname", async () => {
    const response = await PUT(request(), context)
    expect(response.status).toBe(200)
    expect(h.authorize).toHaveBeenCalledWith("u1", false)
    expect(h.addDomain).toHaveBeenCalledWith("tp_1", { hostname: "app.example.com" })
    expect(h.updateProject).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        deployment: expect.objectContaining({ customDomain: "app.example.com", customDomainStatus: "pending" }),
      }),
    )
  })

  it("treats an existing domain as a management action, not a second registration", async () => {
    h.project.mockResolvedValue(project({ deployment: { id: "d1", status: "success", customDomain: "old.example.com", updatedAt: 1 } }))
    expect((await PUT(request("new.example.com"), context)).status).toBe(200)
    expect(h.authorize).toHaveBeenCalledWith("u1", true)
  })

  it("returns the same 404 for an absent or foreign project and never checks entitlement", async () => {
    h.project.mockResolvedValueOnce(null)
    expect((await PUT(request(), context)).status).toBe(404)
    expect(h.authorize).not.toHaveBeenCalled()
  })

  it("does not record a domain or event when the provider fails", async () => {
    h.addDomain.mockRejectedValueOnce(new Error("provider down"))
    expect((await PUT(request(), context)).status).toBeGreaterThanOrEqual(500)
    expect(h.updateProject).not.toHaveBeenCalled()
    expect(h.appendEvent).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/projects/:id/domain — existing resource management", () => {
  it("removes an existing domain without a new-registration entitlement check", async () => {
    h.project.mockResolvedValue(project({ deployment: { id: "d1", status: "success", customDomain: "old.example.com", updatedAt: 1 } }))
    const response = await DELETE(new Request("http://localhost/api/projects/p1/domain", { method: "DELETE" }), context)
    expect(response.status).toBe(200)
    expect(h.removeDomain).toHaveBeenCalledWith("tp_1")
    expect(h.authorize).not.toHaveBeenCalled()
    expect(h.updateProject).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ deployment: expect.objectContaining({ customDomain: undefined }) }),
    )
  })
})
