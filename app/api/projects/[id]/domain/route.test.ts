import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  user: vi.fn(),
  project: vi.fn(),
  updateProject: vi.fn(),
  appendEvent: vi.fn(),
  addDomain: vi.fn(),
  removeDomain: vi.fn(),
  deployStatus: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
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
  reserveCustomDomainSlot: h.reserve,
  releaseCustomDomainSlot: h.release,
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
  h.updateProject.mockResolvedValue(project())
  h.appendEvent.mockResolvedValue(undefined)
  h.reserve.mockResolvedValue({ holdId: "domain_hold" })
  h.release.mockResolvedValue(undefined)
  h.deployStatus.mockResolvedValue({ status: "success" })
  h.addDomain.mockResolvedValue({ hostname: "app.example.com", status: "pending", dnsRecordsToAdd: [] })
  h.removeDomain.mockResolvedValue({ message: "removed" })
})

describe("PUT /api/projects/:id/domain — entitlement", () => {
  it("refuses a plan without a custom-domain registration before calling the provider", async () => {
    h.reserve.mockResolvedValue({
      denial: { code: "CUSTOM_DOMAIN_NOT_INCLUDED", message: "No custom domain on this plan." },
    })
    const response = await PUT(request(), context)
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CUSTOM_DOMAIN_NOT_INCLUDED" } })
    expect(h.deployStatus).not.toHaveBeenCalled()
    expect(h.addDomain).not.toHaveBeenCalled()
  })

  it("reserves a new domain slot and records the active hostname", async () => {
    const response = await PUT(request(), context)
    expect(response.status).toBe(200)
    expect(h.reserve).toHaveBeenCalledWith("u1", "p1", "app.example.com")
    expect(h.release).toHaveBeenCalledWith("u1", "p1")
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
    expect(h.reserve).not.toHaveBeenCalled()
  })

  it("returns the same 404 for an absent or foreign project and never checks entitlement", async () => {
    h.project.mockResolvedValueOnce(null)
    expect((await PUT(request(), context)).status).toBe(404)
    expect(h.reserve).not.toHaveBeenCalled()
  })

  it("does not record a domain or event when the provider fails, and releases the hold", async () => {
    h.addDomain.mockRejectedValueOnce(new Error("provider down"))
    expect((await PUT(request(), context)).status).toBeGreaterThanOrEqual(500)
    expect(h.updateProject).not.toHaveBeenCalled()
    expect(h.appendEvent).not.toHaveBeenCalled()
    expect(h.release).toHaveBeenCalledWith("u1", "p1")
  })

  it("keeps the hold when the provider succeeds but the project write fails", async () => {
    h.updateProject.mockRejectedValueOnce(new Error("database unavailable"))
    const response = await PUT(request(), context)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: { code: "DOMAIN_SAVE_FAILED" } })
    expect(h.release).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/projects/:id/domain — existing resource management", () => {
  it("removes an existing domain without a new-registration entitlement check", async () => {
    h.project.mockResolvedValue(project({ deployment: { id: "d1", status: "success", customDomain: "old.example.com", updatedAt: 1 } }))
    const response = await DELETE(new Request("http://localhost/api/projects/p1/domain", { method: "DELETE" }), context)
    expect(response.status).toBe(200)
    expect(h.removeDomain).toHaveBeenCalledWith("tp_1")
    expect(h.reserve).not.toHaveBeenCalled()
    expect(h.release).toHaveBeenCalledWith("u1", "p1")
    expect(h.updateProject).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ deployment: expect.objectContaining({ customDomain: undefined }) }),
    )
  })
})
