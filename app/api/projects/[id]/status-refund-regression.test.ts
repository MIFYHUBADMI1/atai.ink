import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  user: vi.fn(), project: vi.fn(), runs: vi.fn(), updateRun: vi.fn(), updateProject: vi.fn(), append: vi.fn(), release: vi.fn(), status: vi.fn(),
  deployStatus: vi.fn(), updateDeploy: vi.fn(),
}))
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.user }))
vi.mock("@/lib/store/store", () => ({
  cryptoId: () => "event-id",
  store: { getProject: mocks.project, listBuildRuns: mocks.runs, updateBuildRun: mocks.updateRun, updateProject: mocks.updateProject, updateDeploymentRecord: mocks.updateDeploy, appendEvent: mocks.append, touchBuildPoll: vi.fn(async () => {}) },
}))
vi.mock("@/lib/billing/credit-service", () => ({ releaseReservation: mocks.release }))
vi.mock("@/lib/credits/credits", () => ({ reconcileCredits: vi.fn() }))
vi.mock("@/lib/referrals/referrals", () => ({ processMilestoneCheck: vi.fn() }))
vi.mock("@/lib/integrations/totalum/service", () => ({ getAgentStatus: mocks.status, getProject: vi.fn(), resolveDevelopmentUrl: vi.fn(), getDeploymentStatus: mocks.deployStatus, getFullConversation: vi.fn(), isTotalumConfigured: () => true }))
vi.mock("@/lib/db/collections", () => ({ publishEventsCol: vi.fn(), projectGitHubCol: vi.fn(), usersCol: vi.fn() }))
vi.mock("@/lib/screenshots/capture-app-preview", () => ({ captureAppPreview: vi.fn() }))
vi.mock("@/lib/integrations/github/push", () => ({ pushProjectToGitHub: vi.fn() }))
vi.mock("@/lib/runtime/provisioning", () => ({ ensureRuntimeProvisioned: vi.fn(), environmentForLifecycle: vi.fn(), RuntimeProvisioningError: class extends Error {} }))
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
import { GET } from "./status/route"

let project: { id: string; userId: string; name: string; state: string; totalumProjectId: string; events: unknown[]; conversation: unknown[]; deploymentHistory?: Array<Record<string, unknown>>; buildSummary?: unknown }
let run: { id: string; status: string; totalumProjectId: string; creditsReserved: number }
let balance: number
let ledger: Set<string>
const poll = () => GET(new Request("http://localhost/api/projects/project-1/status"), { params: Promise.resolve({ id: "project-1" }) })
beforeEach(() => {
  vi.resetAllMocks()
  project = { id: "project-1", userId: "owner", name: "Test project", state: "building", totalumProjectId: "provider-project", events: [], conversation: [] }
  run = { id: "run-1", status: "running", totalumProjectId: "provider-project", creditsReserved: 15000 }
  balance = 0
  ledger = new Set()
  mocks.user.mockResolvedValue({ id: "owner" })
  mocks.project.mockImplementation(async () => structuredClone(project))
  mocks.runs.mockImplementation(async () => run.status === "running" ? [structuredClone(run)] : [])
  mocks.updateRun.mockImplementation(async (_id, update) => { Object.assign(run, update) })
  mocks.updateProject.mockImplementation(async (_id, update) => { Object.assign(project, update) })
  mocks.append.mockImplementation(async (_id, event) => { project.events.push(event) })
  mocks.status.mockResolvedValue({ status: "failed", error: "Build stopped" })
  mocks.release.mockImplementation(async (params) => {
    const key = `release_${params.buildId}`
    if (!ledger.has(key)) {
      ledger.add(key)
      balance += params.amount
    }
    return true
  })
})

describe("asynchronous build refund recovery (modeled ledger)", () => {
  it("refunds the reserved amount before finalizing the failed build", async () => {
    expect((await poll()).status).toBe(200)
    expect(mocks.release).toHaveBeenCalledWith({ userId: "owner", amount: 15000, buildId: "run-1", reason: "Build failed", projectId: "project-1" })
    expect(mocks.release.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateRun.mock.invocationCallOrder[0])
    expect(balance).toBe(15000)
    expect(run.status).toBe("failed")
    expect(project.state).toBe("build_failed")
    await poll()
    expect(mocks.release).toHaveBeenCalledOnce()
    expect(balance).toBe(15000)
  })

  it.each(["throw", "false"])("retains retryable state when refund returns %s, then recovers", async (failure) => {
    if (failure === "throw") mocks.release.mockRejectedValueOnce(new Error("credit database unavailable"))
    else mocks.release.mockResolvedValueOnce(false)
    const response = await poll()
    expect(response.status).toBe(503)
    expect(project.state).toBe("building")
    expect(run.status).toBe("running")
    expect(balance).toBe(0)
    expect(mocks.updateRun).not.toHaveBeenCalled()
    expect(mocks.updateProject).not.toHaveBeenCalled()
    expect(JSON.stringify(project.events)).not.toContain("refunded")
    expect((await poll()).status).toBe(200)
    expect(project.state).toBe("build_failed")
    expect(balance).toBe(15000)
    expect(ledger.size).toBe(1)
  })

  it("reuses the same refund identity after post-refund state persistence fails", async () => {
    mocks.updateRun.mockRejectedValueOnce(new Error("state write failed"))
    await poll()
    expect(balance).toBe(15000)
    expect(project.state).toBe("building")
    await poll()
    expect(mocks.release).toHaveBeenCalledTimes(2)
    expect(mocks.release.mock.calls[0][0]).toEqual(mocks.release.mock.calls[1][0])
    expect(balance).toBe(15000)
    expect(ledger.size).toBe(1)
    expect(project.state).toBe("build_failed")
  })

  it("does not refund or contact the provider for a different user's project", async () => {
    mocks.user.mockResolvedValue({ id: "other-user" })
    expect((await poll()).status).toBe(404)
    expect(mocks.status).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
  })
})

describe("asynchronous deployment refund recovery (modeled ledger)", () => {
  beforeEach(() => {
    project.state = "deploying"
    project.buildSummary = { message: "done" }
    project.deploymentHistory = [{ id: "deploy-1", startedAt: 1_000, status: "deploying", creditsCharged: 500 }]
    mocks.deployStatus.mockResolvedValue({ status: "error", createdAt: 1 })
    mocks.updateDeploy.mockImplementation(async (_id: string, _recordId: string, update: Record<string, unknown>) => {
      Object.assign(project.deploymentHistory![0], update)
    })
  })

  it("refunds the deploy reservation before finalizing the failed deployment", async () => {
    expect((await poll()).status).toBe(200)
    expect(mocks.release).toHaveBeenCalledWith({ userId: "owner", amount: 500, buildId: "deploy-1", reason: "Deployment failed", projectId: "project-1" })
    expect(mocks.release.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateDeploy.mock.invocationCallOrder[0])
    expect(balance).toBe(500)
    expect(project.deploymentHistory![0].status).toBe("failed")
    expect(project.state).toBe("ready")
    expect(JSON.stringify(project.events)).toContain("Credits were refunded")

    await poll() // no longer deploying — the refund must not run again
    expect(mocks.release).toHaveBeenCalledOnce()
    expect(balance).toBe(500)
  })

  it.each(["throw", "false"])("retains the deploy record when the refund returns %s, then recovers", async (failure) => {
    if (failure === "throw") mocks.release.mockRejectedValueOnce(new Error("credit database unavailable"))
    else mocks.release.mockResolvedValueOnce(false)

    const response = await poll()
    expect(response.status).toBe(503)
    expect(project.state).toBe("deploying")
    expect(project.deploymentHistory![0].status).toBe("deploying")
    expect(balance).toBe(0)
    expect(mocks.updateDeploy).not.toHaveBeenCalled()
    expect(JSON.stringify(project.events)).not.toContain("refunded")

    expect((await poll()).status).toBe(200)
    expect(balance).toBe(500)
    expect(project.deploymentHistory![0].status).toBe("failed")
    expect(project.state).toBe("ready")
  })

  it("finalizes legacy deploy records without a recorded charge without calling the credit service", async () => {
    delete (project.deploymentHistory![0] as { creditsCharged?: number }).creditsCharged

    expect((await poll()).status).toBe(200)
    expect(mocks.release).not.toHaveBeenCalled()
    expect(project.deploymentHistory![0].status).toBe("failed")
    expect(project.state).toBe("ready")
  })
})

describe("status single-flight is per caller", () => {
  it("does not hand one user's status payload to a concurrent second user", async () => {
    project.state = "ready"
    project.buildSummary = { message: "done" }
    mocks.user.mockReset()
    mocks.user.mockResolvedValueOnce({ id: "owner" }).mockResolvedValueOnce({ id: "intruder" })
    mocks.project.mockReset()
    let releaseGate: (p: unknown) => void = () => {}
    mocks.project.mockReturnValueOnce(new Promise((resolve) => { releaseGate = resolve }))

    const first = poll()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.project).toHaveBeenCalledTimes(1)

    mocks.project.mockResolvedValueOnce(structuredClone(project))
    const second = poll()
    releaseGate(structuredClone(project))
    const [firstRes, secondRes] = await Promise.all([first, second])

    expect(firstRes.status).toBe(200)
    expect(secondRes.status).toBe(404)
  })
})
