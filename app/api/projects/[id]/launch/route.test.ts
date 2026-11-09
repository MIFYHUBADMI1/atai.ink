import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MirrorProject } from "@/lib/types/project"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getProject: vi.fn(),
  updateProject: vi.fn(),
  autoLaunchBuild: vi.fn(),
  prepareRequestedProjectId: vi.fn(),
  getAvailableCredits: vi.fn(),
}))

vi.mock("@/lib/billing/credit-service", () => ({ getAvailableCredits: mocks.getAvailableCredits }))
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }))
vi.mock("@/lib/store/store", () => ({
  store: { getProject: mocks.getProject, updateProject: mocks.updateProject },
}))
vi.mock("@/lib/analysis/pipeline", () => ({ autoLaunchBuild: mocks.autoLaunchBuild }))
vi.mock("@/lib/projects/project-actions", () => ({
  prepareRequestedProjectId: mocks.prepareRequestedProjectId,
}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Keep the response helpers and NextResponse real to exercise the HTTP envelope.
import { POST } from "./route"

type LaunchProject = Pick<MirrorProject,
  "id" | "userId" | "state" | "specification" | "requestedProjectId" |
  "totalumProjectId" | "pipelineMode" | "creditBlock"
>

function makeProject(overrides: Partial<LaunchProject> = {}): LaunchProject {
  return {
    id: "project-launch",
    userId: "owner-launch",
    state: "plan_ready",
    requestedProjectId: "launch-app",
    pipelineMode: "heavy",
    specification: {
      applicationType: "marketplace",
      title: "Launch App",
      description: "A ready application plan.",
      purpose: "Exercise credit resumes.",
      targetUsers: [],
      userRoles: [],
      suggestedFeatures: [],
      dataEntities: [],
      coreFlows: [],
      backendRequirements: [],
      integrations: [],
      additionalInstructions: "",
      complexity: "medium",
    },
    ...overrides,
  }
}

function post(body: unknown = {}) {
  return POST(new Request("http://localhost/api/projects/project-launch/launch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "project-launch" }) })
}

describe("POST /api/projects/:id/launch — billing resume", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireUser.mockResolvedValue({ id: "owner-launch" })
    mocks.getProject.mockResolvedValue(makeProject())
    mocks.prepareRequestedProjectId.mockResolvedValue({ ok: true, requestedProjectId: "launch-app" })
    mocks.autoLaunchBuild.mockResolvedValue(undefined)
    mocks.getAvailableCredits.mockResolvedValue(0)
  })

  afterEach(() => {
    // Slot ownership belongs to autoLaunchBuild, not an unconditional route write.
    expect(mocks.updateProject).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", null],
    ["owned by another user", makeProject({ userId: "someone-else" })],
  ])("hides a %s project without preparing or launching it", async (_label, project) => {
    mocks.getProject.mockResolvedValue(project)

    const response = await post()

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED_PROJECT_ACCESS" },
    })
    expect(mocks.getProject).toHaveBeenCalledWith("project-launch")
    expect(mocks.prepareRequestedProjectId).not.toHaveBeenCalled()
    expect(mocks.autoLaunchBuild).not.toHaveBeenCalled()
  })

  it.each([undefined, "created", "plan_failed", "building", "build_failed", "deployed"])(
    "rejects invalid or missing state %s without reopening the project",
    async (state) => {
      mocks.getProject.mockResolvedValue({ ...makeProject(), state })

      const response = await post()

      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } })
      expect(mocks.prepareRequestedProjectId).not.toHaveBeenCalled()
      expect(mocks.autoLaunchBuild).not.toHaveBeenCalled()
    },
  )

  it.each(["plan_ready", "awaiting_build_confirmation"] as const)(
    "does not relaunch %s when a provider project already exists",
    async (state) => {
      mocks.getProject.mockResolvedValue(makeProject({ state, totalumProjectId: "existing-provider-app" }))

      const response = await post()

      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_STATE" } })
      expect(mocks.prepareRequestedProjectId).not.toHaveBeenCalled()
      expect(mocks.autoLaunchBuild).not.toHaveBeenCalled()
    },
  )

  it("rejects a project with no plan", async () => {
    mocks.getProject.mockResolvedValue(makeProject({ specification: undefined }))

    const response = await post()

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION" } })
    expect(mocks.prepareRequestedProjectId).not.toHaveBeenCalled()
    expect(mocks.autoLaunchBuild).not.toHaveBeenCalled()
  })

  it.each(["plan_ready", "awaiting_build_confirmation"] as const)(
    "supports a paid restart from %s with a stored credit block and no provider ID",
    async (state) => {
      const project = makeProject({
        state,
        creditBlock: { required: 4500, available: 0, action: "your build", at: 1, resume: "build" },
      })
      mocks.getProject.mockResolvedValueOnce(project).mockResolvedValueOnce({
        ...project, state: "building", totalumProjectId: "launch-app", creditBlock: undefined,
      })

      const response = await post({ requestedProjectId: "chosen-app" })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true, data: { state: "building" } })
      expect(mocks.prepareRequestedProjectId).toHaveBeenCalledWith(project, "chosen-app")
      expect(mocks.autoLaunchBuild).toHaveBeenCalledExactlyOnceWith("project-launch")
      expect(mocks.getProject).toHaveBeenCalledTimes(2)
      expect(project.pipelineMode).toBe("heavy")
    },
  )

  it("awaits launch completion before re-reading state and returning success", async () => {
    let finish!: () => void
    const launchPending = new Promise<void>((resolve) => { finish = resolve })
    mocks.autoLaunchBuild.mockImplementationOnce(async () => {
      await launchPending
      mocks.getProject.mockResolvedValue(makeProject({ state: "building", totalumProjectId: "launch-app" }))
    })
    let settled = false
    const pendingResponse = post().then((response) => {
      settled = true
      return response
    })

    try {
      await vi.waitFor(() => expect(mocks.autoLaunchBuild).toHaveBeenCalledTimes(1))
      expect(settled).toBe(false)
      expect(mocks.getProject).toHaveBeenCalledTimes(1)
    } finally {
      finish()
    }

    const response = await pendingResponse
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: { state: "building" } })
    expect(mocks.getProject).toHaveBeenCalledTimes(2)
  })

  it("returns structured 402 metadata using the live balance, not the stored one", async () => {
    mocks.autoLaunchBuild.mockImplementationOnce(async () => {
      mocks.getProject.mockResolvedValue(makeProject({
        creditBlock: { required: 4500, available: 0, action: "your build", at: 2, resume: "build" },
      }))
    })
    mocks.getAvailableCredits.mockResolvedValue(125)

    const response = await post()

    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INSUFFICIENT_CREDITS", meta: { required: 4500, available: 125 } },
    })
    expect(mocks.getAvailableCredits).toHaveBeenCalledExactlyOnceWith("owner-launch")
    expect(mocks.autoLaunchBuild).toHaveBeenCalledExactlyOnceWith("project-launch")
    expect(mocks.getProject).toHaveBeenCalledTimes(2)
  })

  it("does not report a stale shortage once the balance covers it", async () => {
    mocks.autoLaunchBuild.mockImplementationOnce(async () => {
      mocks.getProject.mockResolvedValue(makeProject({
        creditBlock: { required: 4500, available: 0, action: "your build", at: 2, resume: "build" },
      }))
    })
    mocks.getAvailableCredits.mockResolvedValue(4500)

    const response = await post()

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "BUILD_NOT_STARTED" } })
  })

  it.each([null, makeProject()])("does not report optimistic success when launch leaves %j", async (updated) => {
    mocks.getProject.mockResolvedValueOnce(makeProject()).mockResolvedValueOnce(updated)

    const response = await post()

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "BUILD_NOT_STARTED" } })
    expect(mocks.autoLaunchBuild).toHaveBeenCalledTimes(1)
  })

  it("returns the project-ID preparation failure without starting a build", async () => {
    mocks.prepareRequestedProjectId.mockResolvedValue({
      ok: false, code: "PROJECT_ID_UNAVAILABLE", status: 409, message: "That app address is already in use.",
    })

    const response = await post({ requestedProjectId: "taken-app" })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "PROJECT_ID_UNAVAILABLE", message: "That app address is already in use." },
    })
    expect(mocks.autoLaunchBuild).not.toHaveBeenCalled()
  })
})
