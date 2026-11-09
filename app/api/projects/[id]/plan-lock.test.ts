import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The built-archive plan lock: once the application exists
 * (building/deploying/ready/build_complete/deployment_failed) the PATCH
 * endpoint must reject plan mutations (PLAN_LOCKED, 409) — a plan edit could
 * no longer reach the built app. build_failed must stay EDITABLE because a
 * retry re-sends the whole plan to the builder.
 */

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  project: vi.fn(),
  updateProject: vi.fn(),
  appendEvent: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.user }))
vi.mock("@/lib/store/store", () => ({
  store: {
    getProject: mocks.project,
    updateProject: mocks.updateProject,
    appendEvent: mocks.appendEvent,
  },
  cryptoId: () => "event-id",
}))
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/projects/pipeline-recovery", () => ({ recoverStalledPipeline: vi.fn(async () => false) }))
vi.mock("@/lib/analysis/cofounder", () => ({ decisionForProposal: vi.fn() }))

import { PATCH as updateProject } from "./route"

const spec = { applicationType: "web", title: "T", description: "D", purpose: "P" }

const projectDoc = (state: string) => ({
  id: "project-1",
  userId: "owner",
  name: "Owner project",
  mode: "scratch",
  state,
  specification: spec,
  understanding: {},
  planAnalysis: null,
  planUpdateNotes: [],
  createdAt: 1,
  updatedAt: 1,
})

const ctx = { params: Promise.resolve({ id: "project-1" }) }
const editRequest = () =>
  new Request("http://localhost/api/projects/project-1", {
    method: "PATCH",
    body: JSON.stringify({ sectionUpdate: { section: "vision", value: "A clearer foundation." } }),
  })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.user.mockResolvedValue({ id: "owner" })
  mocks.updateProject.mockImplementation(async (_id, patch) => ({ ...projectDoc("build_failed"), ...patch }))
  mocks.appendEvent.mockResolvedValue(undefined)
})

describe("PATCH plan lock", () => {
  it.each(["build_failed", "plan_failed", "plan_ready", "created"])(
    "accepts a plan section edit while state is %s",
    async (state) => {
      mocks.project.mockResolvedValueOnce(projectDoc(state))
      const res = await updateProject(editRequest(), ctx)
      expect(res.status).toBe(200)
      expect(mocks.updateProject).toHaveBeenCalledTimes(1)
      const patch = mocks.updateProject.mock.calls[0][1] as Record<string, unknown>
      expect(patch.specification).toMatchObject({ vision: "A clearer foundation." })
    },
  )

  it.each(["building", "deploying", "ready", "build_complete", "deployment_failed"])(
    "rejects a plan section edit once state is %s",
    async (state) => {
      mocks.project.mockResolvedValueOnce(projectDoc(state))
      const res = await updateProject(editRequest(), ctx)
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body?.error?.code ?? body?.code).toBe("PLAN_LOCKED")
      expect(mocks.updateProject).not.toHaveBeenCalled()
    },
  )
})
