import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  getProject: vi.fn(),
  claimBuildSlot: vi.fn(),
  updateProject: vi.fn(),
  appendEvent: vi.fn(),
  appendDeploymentRecord: vi.fn(),
  updateDeploymentRecord: vi.fn(),
  authorize: vi.fn(),
  reserveSlot: vi.fn(),
  releaseSlot: vi.fn(),
  getAvailableCredits: vi.fn(),
  reserveCredits: vi.fn(),
  releaseReservation: vi.fn(),
  deployProject: vi.fn(),
  getDeploymentStatus: vi.fn(),
  publishInsert: vi.fn(),
  publishUpdate: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/store/store", () => ({
  cryptoId: () => "id",
  store: {
    getProject: h.getProject,
    claimBuildSlot: h.claimBuildSlot,
    updateProject: h.updateProject,
    appendEvent: h.appendEvent,
    appendDeploymentRecord: h.appendDeploymentRecord,
    updateDeploymentRecord: h.updateDeploymentRecord,
  },
}))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => undefined) }))
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/billing/credit-service", () => ({
  getAvailableCredits: h.getAvailableCredits,
  reserveCredits: h.reserveCredits,
  releaseReservation: h.releaseReservation,
}))
vi.mock("@/lib/billing/runtime-config", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDeploymentCosts: vi.fn(async () => ({ deployCost: 500 })),
}))
vi.mock("@/lib/billing/entitlements/require", () => ({
  authorizeProductionWork: h.authorize,
  reserveSubdomainSlot: h.reserveSlot,
  releaseSubdomainSlot: h.releaseSlot,
}))
vi.mock("@/lib/integrations/totalum/service", () => ({
  deployProject: h.deployProject,
  getDeploymentStatus: h.getDeploymentStatus,
  isTotalumConfigured: () => true,
}))
vi.mock("@/lib/db/collections", () => ({
  publishEventsCol: async () => ({ insertOne: h.publishInsert, updateOne: h.publishUpdate }),
}))

import { startProjectDeploy } from "./project-actions"

const project = {
  id: "p1",
  userId: "u1",
  name: "Shop",
  state: "ready",
  totalumProjectId: "tp_1",
  deploymentHistory: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getProject.mockResolvedValue({ ...project })
  h.claimBuildSlot.mockResolvedValue({ ...project, state: "deploying" })
  h.updateProject.mockResolvedValue(undefined)
  h.appendEvent.mockResolvedValue(undefined)
  h.appendDeploymentRecord.mockResolvedValue(undefined)
  h.updateDeploymentRecord.mockResolvedValue(undefined)
  h.authorize.mockResolvedValue(null)
  h.reserveSlot.mockResolvedValue({ holdId: "subdomain_hold" })
  h.releaseSlot.mockResolvedValue(undefined)
  h.getAvailableCredits.mockResolvedValue(1_000)
  h.reserveCredits.mockResolvedValue(true)
  h.releaseReservation.mockResolvedValue(true)
  h.deployProject.mockResolvedValue({ ok: true })
  h.getDeploymentStatus.mockResolvedValue({ status: "idle" })
  h.publishInsert.mockResolvedValue({})
  h.publishUpdate.mockResolvedValue({})
})

describe("startProjectDeploy — atomic subdomain capacity", () => {
  it("refuses a first deploy when the slot reservation is denied before claiming", async () => {
    h.reserveSlot.mockResolvedValueOnce({
      denial: { code: "SUBDOMAIN_LIMIT", message: "No subdomain slot on this plan." },
    })

    const result = await startProjectDeploy("u1", "p1")

    expect(result).toMatchObject({ ok: false, status: 402, code: "SUBDOMAIN_LIMIT" })
    expect(h.claimBuildSlot).not.toHaveBeenCalled()
    expect(h.reserveCredits).not.toHaveBeenCalled()
  })

  it("releases the hold when the atomic claim loses", async () => {
    h.claimBuildSlot.mockResolvedValueOnce(null)

    const result = await startProjectDeploy("u1", "p1")

    expect(result).toMatchObject({ ok: false, status: 409, code: "BUSY" })
    expect(h.releaseSlot).toHaveBeenCalledWith("u1", "p1")
    expect(h.reserveCredits).not.toHaveBeenCalled()
  })

  it("claims before reserving credits and keeps the hold on success", async () => {
    const result = await startProjectDeploy("u1", "p1")

    expect(result).toMatchObject({ ok: true, status: 200 })
    expect(h.reserveSlot).toHaveBeenCalledWith("u1", "p1")
    expect(h.claimBuildSlot).toHaveBeenCalledWith("p1", { state: "deploying" })
    expect(h.reserveCredits).toHaveBeenCalledTimes(1)
    expect(h.releaseSlot).not.toHaveBeenCalled()
  })

  it("releases the hold and refunds credits when the provider fails", async () => {
    h.deployProject.mockRejectedValueOnce(new Error("provider down"))

    await expect(startProjectDeploy("u1", "p1")).rejects.toThrow("provider down")

    expect(h.releaseSlot).toHaveBeenCalledWith("u1", "p1")
    expect(h.releaseReservation).toHaveBeenCalledWith(expect.objectContaining({ amount: 500, projectId: "p1" }))
    expect(h.updateProject).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        state: "ready",
        deployment: expect.objectContaining({ status: "failed" }),
      }),
    )
  })
})
