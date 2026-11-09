import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression tests for the deploy credit lifecycle (audit findings):
 *
 *  1. Deploy double-charge race: the route checked `project.state` and only
 *     later set state to "deploying", so two concurrent POSTs could both pass
 *     the check and both debit deploy credits. The state transition must now be
 *     an atomic claim (claimBuildSlot) that happens BEFORE any credits are
 *     reserved.
 *  2. Async deploy failure leaked credits: only a synchronous provider failure
 *     was refunded; a deployment accepted by the provider and later reported as
 *     errored (or whose project vanished) kept the reservation forever.
 */

vi.mock("server-only", () => ({}))

const {
  mockUser,
  mockClaimBuildSlot,
  mockReserveCredits,
  mockGetProject,
  mockRelease,
  mockDeployStatus,
  mockUpdateDeploy,
  mockUpdateProject,
  mockTotalumProject,
  mockAppend,
} = vi.hoisted(() => {
  const mockUser = { id: "u_dep", email: "dep@example.com" }
  return {
    mockUser,
    mockClaimBuildSlot: vi.fn(),
    mockReserveCredits: vi.fn(async () => true),
    mockGetProject: vi.fn(),
    mockRelease: vi.fn(async () => true),
    mockDeployStatus: vi.fn(async () => ({ status: "idle" })),
    mockUpdateDeploy: vi.fn(async () => undefined),
    mockUpdateProject: vi.fn(async () => undefined),
    mockTotalumProject: vi.fn(async () => ({ id: "tp_1" })),
    mockAppend: vi.fn(async () => undefined),
  }
})

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => mockUser),
}))

vi.mock("@/lib/store/store", () => ({
  cryptoId: vi.fn(() => "cid"),
  store: {
    getProject: mockGetProject,
    claimBuildSlot: mockClaimBuildSlot,
    updateProject: mockUpdateProject,
    updateDeploymentRecord: mockUpdateDeploy,
    updateBuildRun: vi.fn(async () => undefined),
    appendEvent: mockAppend,
    appendDeploymentRecord: vi.fn(async () => undefined),
  },
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => undefined),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  getAvailableCredits: vi.fn(async () => 1_000_000),
  reserveCredits: mockReserveCredits,
  releaseReservation: mockRelease,
}))

vi.mock("@/lib/billing/runtime-config", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDeploymentCosts: vi.fn(async () => ({ deployCost: 500 })),
}))

vi.mock("@/lib/integrations/totalum/service", () => ({
  deployProject: vi.fn(async () => ({ ok: true })),
  isTotalumConfigured: vi.fn(() => true),
  getDeploymentStatus: mockDeployStatus,
  getProject: mockTotalumProject,
}))

vi.mock("@/lib/db/collections", () => ({
  publishEventsCol: vi.fn(async () => ({ insertOne: vi.fn(async () => ({})), updateOne: vi.fn(async () => ({})) })),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/runtime/provisioning", () => ({
  ensureRuntimeProvisioned: vi.fn(async () => ({})),
  environmentForLifecycle: vi.fn(() => "production"),
  RuntimeProvisioningError: class extends Error {},
}))

import { GET, POST } from "./deploy/route"

const project = {
  id: "p_dep",
  userId: "u_dep",
  name: "Deployable",
  state: "ready",
  totalumProjectId: "tp_1",
  deploymentHistory: [] as Array<{ id: string; startedAt: number; status: string; creditsCharged?: number; [k: string]: unknown }>,
  events: [] as unknown[],
}

const ctx = { params: Promise.resolve({ id: "p_dep" }) }
const post = () => POST(new Request("http://localhost/api/projects/p_dep/deploy", { method: "POST" }), ctx)
const get = () => GET(new Request("http://localhost/api/projects/p_dep/deploy"), ctx)

describe("POST /api/projects/:id/deploy — atomic claim", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClaimBuildSlot.mockReset()
    mockGetProject.mockResolvedValue(project as never)
  })

  it("rejects with 409 when the atomic claim loses to a concurrent op, without touching credits", async () => {
    mockClaimBuildSlot.mockResolvedValue(null) // another request holds the slot

    const res = await post()

    expect(res.status).toBe(409)
    expect(mockClaimBuildSlot).toHaveBeenCalledWith("p_dep", { state: "deploying" })
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })

  it("claims the slot before reserving credits on the success path", async () => {
    mockClaimBuildSlot.mockResolvedValue({ ...project, state: "deploying" })

    const res = await post()

    expect(res.status).toBe(200)
    expect(mockClaimBuildSlot).toHaveBeenCalled()
    expect(mockReserveCredits).toHaveBeenCalledTimes(1)
  })
})

describe("GET /api/projects/:id/deploy — failed deployments return the reservation", () => {
  let current: typeof project & { deploymentHistory: Array<Record<string, unknown>> }

  beforeEach(() => {
    vi.clearAllMocks()
    current = structuredClone({ ...project, state: "deploying", deploymentHistory: [] })
    current.deploymentHistory = [{ id: "deploy-1", startedAt: 1_000, status: "deploying", creditsCharged: 500 }]
    mockGetProject.mockImplementation(async () => structuredClone(current) as never)
    mockUpdateProject.mockImplementation(async (_id: string, update: Record<string, unknown>) => {
      Object.assign(current, update)
    })
    mockUpdateDeploy.mockImplementation(async (_id: string, _recordId: string, update: Record<string, unknown>) => {
      Object.assign(current.deploymentHistory[0], update)
    })
    mockAppend.mockImplementation(async (_id: string, event: unknown) => {
      current.events.push(event)
    })
    mockDeployStatus.mockResolvedValue({ status: "error", createdAt: 1 })
  })

  it("refunds before finalizing an errored deployment and never double-refunds on later polls", async () => {
    const res = await get()

    expect(res.status).toBe(200)
    expect(mockRelease).toHaveBeenCalledWith({
      userId: "u_dep",
      amount: 500,
      buildId: "deploy-1",
      reason: "Deployment failed",
      projectId: "p_dep",
    })
    expect(mockRelease.mock.invocationCallOrder[0]).toBeLessThan(mockUpdateDeploy.mock.invocationCallOrder[0])
    expect(current.deploymentHistory[0].status).toBe("failed")
    expect(current.state).toBe("ready")
    expect(JSON.stringify(current.events)).toContain("Credits were refunded")

    await get() // state is now ready — the error branch must not run again
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it("keeps the record deployable when the refund fails, then recovers on the next poll", async () => {
    mockRelease.mockResolvedValueOnce(false)

    expect((await get()).status).toBe(503)
    expect(current.state).toBe("deploying")
    expect(current.deploymentHistory[0].status).toBe("deploying")
    expect(mockUpdateDeploy).not.toHaveBeenCalled()

    expect((await get()).status).toBe(200)
    expect(mockRelease).toHaveBeenCalledTimes(2)
    expect(mockRelease.mock.calls[1][0]).toEqual(mockRelease.mock.calls[0][0])
    expect(current.state).toBe("ready")
    expect(current.deploymentHistory[0].status).toBe("failed")
  })

  it("refunds when the provider no longer knows the project", async () => {
    mockDeployStatus.mockRejectedValueOnce(new Error("PROJECT_NOT_FOUND"))

    expect((await get()).status).toBe(200)
    expect(mockRelease).toHaveBeenCalledWith(expect.objectContaining({ amount: 500, buildId: "deploy-1" }))
    expect(current.deploymentHistory[0].status).toBe("failed")
    expect(current.state).toBe("ready")
  })

  it("finalizes legacy records without a recorded charge without calling the credit service", async () => {
    delete current.deploymentHistory[0].creditsCharged

    expect((await get()).status).toBe(200)
    expect(mockRelease).not.toHaveBeenCalled()
    expect(current.deploymentHistory[0].status).toBe("failed")
    expect(current.state).toBe("ready")
  })
})
