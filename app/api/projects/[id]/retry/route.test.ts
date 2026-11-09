import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MirrorProject } from "@/lib/types/project"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getProject: vi.fn(),
  updateProject: vi.fn(),
  getAvailableCredits: vi.fn(),
  retryProjectStep: vi.fn(),
  checkRateLimit: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }))
vi.mock("@/lib/store/store", () => ({
  store: { getProject: mocks.getProject, updateProject: mocks.updateProject },
}))
vi.mock("@/lib/billing/credit-service", () => ({ getAvailableCredits: mocks.getAvailableCredits }))
vi.mock("@/lib/projects/pipeline-recovery", () => ({ retryProjectStep: mocks.retryProjectStep }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Keep the response helpers and NextResponse real to exercise the HTTP envelope.
import { POST } from "./route"
import { AppError } from "@/lib/errors"

type RetryProject = Pick<MirrorProject, "id" | "userId" | "state" | "creditBlock" | "pipelineMode">

function makeProject(overrides: Partial<RetryProject> = {}): RetryProject {
  return {
    id: "project-retry",
    userId: "owner-retry",
    state: "analysis_failed",
    pipelineMode: "heavy",
    ...overrides,
  }
}

function post() {
  return POST(new Request("http://localhost/api/projects/project-retry/retry", { method: "POST" }), {
    params: Promise.resolve({ id: "project-retry" }),
  })
}

describe("POST /api/projects/:id/retry — billing resume", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireUser.mockResolvedValue({ id: "owner-retry" })
    mocks.getProject.mockResolvedValue(makeProject())
    mocks.getAvailableCredits.mockResolvedValue(5000)
    mocks.checkRateLimit.mockResolvedValue(undefined)
    mocks.retryProjectStep.mockResolvedValue({
      ok: true, status: 202, retryType: "understand", message: "Understanding restarted.",
    })
  })

  afterEach(() => {
    // The recovery service, not the route, owns state and credit-block changes.
    expect(mocks.updateProject).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", null],
    ["owned by another user", makeProject({
      userId: "someone-else",
      creditBlock: { required: 3000, available: 0, action: "the website analysis", at: 1, resume: "analysis" },
    })],
  ])("hides a %s project before reading credits or retrying", async (_label, project) => {
    mocks.getProject.mockResolvedValue(project)

    const response = await post()

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      ok: false, error: { code: "UNAUTHORIZED_PROJECT_ACCESS" },
    })
    expect(mocks.getProject).toHaveBeenCalledWith("project-retry")
    expect(mocks.getAvailableCredits).not.toHaveBeenCalled()
    expect(mocks.retryProjectStep).not.toHaveBeenCalled()
  })

  it.each([0, 125, 2999])("returns structured 402 using fresh available credits %i, not the stored balance", async (available) => {
    const creditBlock = {
      required: 3000, available: 9999, action: "the website analysis", at: 1, resume: "analysis" as const,
    }
    mocks.getProject.mockResolvedValue(makeProject({ creditBlock }))
    mocks.getAvailableCredits.mockResolvedValue(available)

    const response = await post()

    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INSUFFICIENT_CREDITS", meta: { required: 3000, available } },
    })
    expect(mocks.getAvailableCredits).toHaveBeenCalledExactlyOnceWith("owner-retry")
    expect(mocks.retryProjectStep).not.toHaveBeenCalled()
    expect(creditBlock.available).toBe(9999)
  })

  it.each([3000, 5000])("delegates a paid restart when the fresh balance is %i despite a stored shortage", async (available) => {
    const project = makeProject({
      creditBlock: { required: 3000, available: 0, action: "the website analysis", at: 1, resume: "analysis" },
    })
    mocks.getProject.mockResolvedValue(project)
    mocks.getAvailableCredits.mockResolvedValue(available)

    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true, data: { retryType: "understand", message: "Understanding restarted." },
    })
    expect(mocks.getAvailableCredits).toHaveBeenCalledExactlyOnceWith("owner-retry")
    expect(mocks.retryProjectStep).toHaveBeenCalledExactlyOnceWith("project-retry")
    expect(mocks.getAvailableCredits.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.retryProjectStep.mock.invocationCallOrder[0],
    )
    expect(project.creditBlock?.available).toBe(0)
    expect(project.pipelineMode).toBe("heavy")
  })

  it.each([
    { state: "analysis_failed", retryType: "understand", message: "Understanding restarted." },
    { state: "plan_failed", retryType: "plan", message: "Planning restarted." },
    { state: "build_failed", retryType: "build", message: "Build retry started.", buildRunId: "build-run" },
    { state: "deployment_failed", retryType: "launch", message: "Launch retry started.", deployRunId: "deploy-run" },
  ] as const)("preserves existing $retryType delegation without a credit block", async ({ state, ...result }) => {
    mocks.getProject.mockResolvedValue(makeProject({ state }))
    mocks.retryProjectStep.mockResolvedValue({ ok: true, status: 202, ...result })

    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: result })
    expect(mocks.getAvailableCredits).not.toHaveBeenCalled()
    expect(mocks.retryProjectStep).toHaveBeenCalledExactlyOnceWith("project-retry")
  })

  it.each([undefined, "building", "plan_ready", "deployed"])(
    "preserves the recovery service rejection for invalid or missing state %s",
    async (state) => {
      mocks.getProject.mockResolvedValue({ ...makeProject(), state })
      const message = `This project cannot be retried from its current state (${state}).`
      mocks.retryProjectStep.mockResolvedValue({ ok: false, status: 409, message })

      const response = await post()

      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ ok: false, error: { code: "RETRY_NOT_STARTED", message } })
      expect(mocks.retryProjectStep).toHaveBeenCalledExactlyOnceWith("project-retry")
      expect(mocks.getAvailableCredits).not.toHaveBeenCalled()
    },
  )

  it("preserves the recovery service failure status after a successful credit preflight", async () => {
    mocks.getProject.mockResolvedValue(makeProject({
      creditBlock: { required: 3000, available: 0, action: "your build", at: 1, resume: "build" },
    }))
    mocks.retryProjectStep.mockResolvedValue({ ok: false, status: 503, message: "Build provider unavailable." })

    const response = await post()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      ok: false, error: { code: "RETRY_NOT_STARTED", message: "Build provider unavailable." },
    })
    expect(mocks.getAvailableCredits).toHaveBeenCalledTimes(1)
    expect(mocks.retryProjectStep).toHaveBeenCalledTimes(1)
  })

  it("does not retry when the fresh balance lookup fails", async () => {
    mocks.getProject.mockResolvedValue(makeProject({
      creditBlock: { required: 3000, available: 0, action: "the website analysis", at: 1, resume: "analysis" },
    }))
    mocks.getAvailableCredits.mockRejectedValue(new Error("Credit lookup failed"))

    const response = await post()

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "UNKNOWN" } })
    expect(mocks.retryProjectStep).not.toHaveBeenCalled()
  })

  it.each(["created", "analysis_failed", "plan_failed"])(
    "draws a %s restart from the shared analysis quota before starting work",
    async (state) => {
      mocks.getProject.mockResolvedValue(makeProject({ state }))

      const response = await post()

      expect(response.status).toBe(200)
      expect(mocks.checkRateLimit.mock.calls.map(([params]) => params)).toEqual([
        { action: "ai_analysis_burst", identifier: "owner-retry", limit: 4, windowMs: 60_000 },
        { action: "ai_analysis_volume", identifier: "owner-retry", limit: 30, windowMs: 3_600_000 },
      ])
      expect(mocks.checkRateLimit.mock.invocationCallOrder[1]).toBeLessThan(
        mocks.retryProjectStep.mock.invocationCallOrder[0],
      )
    },
  )

  it.each(["build_failed", "deployment_failed"])(
    "leaves %s retries on their existing provider quotas",
    async (state) => {
      mocks.getProject.mockResolvedValue(makeProject({ state }))

      expect((await post()).status).toBe(200)
      expect(mocks.checkRateLimit).not.toHaveBeenCalled()
      expect(mocks.retryProjectStep).toHaveBeenCalledOnce()
    },
  )

  it("refuses a quota-exhausted restart without consuming credits or starting work", async () => {
    const error = new AppError("RATE_LIMITED")
    error.retryAfterSeconds = 42
    mocks.checkRateLimit.mockRejectedValueOnce(error)

    const response = await post()

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("42")
    expect(mocks.getAvailableCredits).not.toHaveBeenCalled()
    expect(mocks.retryProjectStep).not.toHaveBeenCalled()
  })

  it("fails closed when the quota store is unavailable", async () => {
    mocks.checkRateLimit.mockRejectedValueOnce(new AppError("DATABASE_UNAVAILABLE"))

    expect((await post()).status).toBe(503)
    expect(mocks.retryProjectStep).not.toHaveBeenCalled()
  })
})
