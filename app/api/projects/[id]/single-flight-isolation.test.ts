import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * singleFlight deduplicates concurrent requests by key, but the in-flight
 * closure captures the FIRST caller's user. Project endpoints keyed only on the
 * project id therefore handed the owner's payload (or event log) to a second,
 * unrelated user who raced the request. The keys must include the caller.
 */

const mocks = vi.hoisted(() => ({ user: vi.fn(), project: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.user }))
vi.mock("@/lib/store/store", () => ({ store: { getProject: mocks.project }, cryptoId: () => "event-id" }))
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/projects/pipeline-recovery", () => ({ recoverStalledPipeline: vi.fn(async () => false) }))
vi.mock("@/lib/analysis/plan-sections", () => ({
  getPlanSection: vi.fn(),
  validatePlanSectionValue: vi.fn(),
  applySectionUpdate: vi.fn(),
  computePlanHealth: vi.fn(),
}))
vi.mock("@/lib/analysis/cofounder", () => ({ decisionForProposal: vi.fn() }))

import { GET as getProject } from "./route"
import { GET as getActivity } from "./activity/route"

const doc = () => ({
  id: "project-1",
  userId: "owner",
  name: "Owner project",
  mode: "idea",
  state: "ready",
  sourceUrl: null,
  specification: {},
  understanding: {},
  conversation: [],
  events: [{ id: "e1", at: 1, level: "info", stage: "build", message: "private detail" }],
  visibility: "private",
  createdAt: 1,
  updatedAt: 1,
})

const ctx = { params: Promise.resolve({ id: "project-1" }) }
type Route = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
const call = (route: Route) => route(new Request("http://localhost/api/projects/project-1"), ctx)

beforeEach(() => {
  vi.resetAllMocks()
})

describe.each<[string, Route]>([
  ["project detail", getProject],
  ["project activity", getActivity],
])("%s single-flight", (_name, route) => {
  it("does not share an in-flight response with a concurrent different user", async () => {
    mocks.user.mockResolvedValueOnce({ id: "owner" }).mockResolvedValueOnce({ id: "intruder" })
    let releaseGate: (p: unknown) => void = () => {}
    mocks.project.mockReturnValueOnce(new Promise((resolve) => { releaseGate = resolve }))

    const first = call(route)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.project).toHaveBeenCalledTimes(1)

    mocks.project.mockResolvedValueOnce(doc())
    const second = call(route)
    releaseGate(doc())
    const [firstRes, secondRes] = await Promise.all([first, second])

    expect(firstRes.status).toBe(200)
    expect(secondRes.status).toBe(404)
  })
})
