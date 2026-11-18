import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findOne: vi.fn(),
  updateOne: vi.fn(),
  context: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({
  requireUser: mocks.user,
  AppError: class AppError extends Error {
    constructor(public code: string, public status = 400) {
      super(code)
    }
  },
}))
vi.mock("@/lib/db/collections", () => ({
  usersCol: async () => ({ findOne: mocks.findOne, updateOne: mocks.updateOne }),
  projectsCol: async () => ({ countDocuments: async () => 0 }),
}))
// Only the feature/context read is faked: the progress read and its sanitising
// stay the real thing, because that is what the writes have to survive.
vi.mock("@/lib/tour/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tour/server")>()
  return { ...actual, tourContextForUser: mocks.context }
})
vi.mock("@/lib/api/respond", () => ({
  ok: (data: unknown) => Response.json({ ok: true, data }),
  fail: (code: string, message: string, status = 400) => Response.json({ ok: false, error: { code, message } }, { status }),
  handleRouteError: (_stage: string, error: { code?: string; status?: number }) =>
    Response.json({ ok: false, error: { code: error.code ?? "ERROR" } }, { status: error.status ?? 500 }),
}))

import { GET, POST } from "@/app/api/settings/tours/route"

const body = (value: unknown) =>
  new Request("http://localhost/api/settings/tours", {
    method: "POST",
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.user.mockResolvedValue({ id: "u1" })
  mocks.findOne.mockResolvedValue({ tourProgress: {} })
  mocks.updateOne.mockResolvedValue({ modifiedCount: 1 })
  mocks.context.mockResolvedValue({ features: {}, projectCount: 0 })
})

describe("GET /api/settings/tours", () => {
  it("asks for the signed-in founder only", async () => {
    await GET()
    expect(mocks.user).toHaveBeenCalled()
    expect(mocks.context).toHaveBeenCalledWith("u1")
  })

  it("refuses without a session", async () => {
    mocks.user.mockRejectedValue({ code: "UNAUTHORIZED", status: 401 })
    const response = await GET()
    expect(response.status).toBe(401)
    expect(mocks.context).not.toHaveBeenCalled()
  })
})

describe("POST /api/settings/tours", () => {
  it("records progress against the founder's own document", async () => {
    const response = await POST(body({ tourId: "welcome", step: 2, status: "in-progress" }))
    expect(response.status).toBe(200)
    expect(mocks.updateOne).toHaveBeenCalledTimes(1)
    const [filter, update] = mocks.updateOne.mock.calls[0]
    expect(filter).toEqual({ id: "u1" })
    expect(update.$set.tourProgress.welcome).toMatchObject({ step: 2, status: "in-progress" })
    // Never a caller-supplied identity.
    expect(JSON.stringify(filter)).not.toContain("_id")
  })

  it.each([
    ["an unknown tour", { tourId: "not-a-tour", step: 0, status: "in-progress" }],
    ["a prototype key", { tourId: "__proto__", step: 0, status: "completed" }],
    ["a constructor key", { tourId: "constructor", step: 0, status: "completed" }],
    ["a page tour that does not exist", { tourId: "page-secret", step: 0, status: "completed" }],
  ])("rejects %s before touching the database", async (_label, payload) => {
    const response = await POST(body(payload))
    expect(response.status).toBe(422)
    expect(mocks.updateOne).not.toHaveBeenCalled()
  })

  it.each([
    ["no body", null],
    ["a negative step", { tourId: "welcome", step: -1, status: "in-progress" }],
    ["a fractional step", { tourId: "welcome", step: 1.5, status: "in-progress" }],
    ["an invented status", { tourId: "welcome", step: 1, status: "completed-by-staff" }],
    ["an extra field", { tourId: "welcome", step: 1, status: "in-progress", userId: "u9" }],
    ["a step as text", { tourId: "welcome", step: "9", status: "in-progress" }],
  ])("rejects %s", async (_label, payload) => {
    const response = await POST(body(payload))
    expect(response.status).toBe(422)
    expect((await response.json()).error.code).toBe("VALIDATION")
    expect(mocks.updateOne).not.toHaveBeenCalled()
  })

  it("cannot be told a tour is further along than it is", async () => {
    await POST(body({ tourId: "welcome", step: 200, status: "completed" }))
    const [, update] = mocks.updateOne.mock.calls[0]
    const recorded = update.$set.tourProgress.welcome.step
    expect(recorded).toBeLessThan(200)
    expect(recorded).toBeGreaterThan(0)
  })

  it("keeps progress on other tours instead of replacing the map", async () => {
    mocks.findOne.mockResolvedValue({
      tourProgress: { workspace: { step: 4, status: "in-progress", updatedAt: 10 } },
    })
    await POST(body({ tourId: "welcome", step: 0, status: "completed" }))
    const [, update] = mocks.updateOne.mock.calls[0]
    expect(update.$set.tourProgress.workspace.step).toBe(4)
    expect(Object.keys(update.$set.tourProgress).sort()).toEqual(["welcome", "workspace"])
  })

  it("ignores a stored map that is not shaped like progress", async () => {
    mocks.findOne.mockResolvedValue({ tourProgress: "everything" })
    await POST(body({ tourId: "welcome", step: 1, status: "in-progress" }))
    const [, update] = mocks.updateOne.mock.calls[0]
    expect(Object.keys(update.$set.tourProgress)).toEqual(["welcome"])
  })

  it("refuses without a session", async () => {
    mocks.user.mockRejectedValue({ code: "UNAUTHORIZED", status: 401 })
    const response = await POST(body({ tourId: "welcome", step: 0, status: "in-progress" }))
    expect(response.status).toBe(401)
    expect(mocks.updateOne).not.toHaveBeenCalled()
  })
})
