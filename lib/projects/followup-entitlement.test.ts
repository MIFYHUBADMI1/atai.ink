import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  project: vi.fn(),
  authorize: vi.fn(),
  createBuildRun: vi.fn(),
  appendMessage: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/store/store", () => ({
  cryptoId: () => "id",
  store: {
    getProject: h.project,
    createBuildRun: h.createBuildRun,
    appendMessage: h.appendMessage,
  },
}))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => undefined) }))
vi.mock("@/lib/billing/entitlements/require", () => ({ authorizeProductionWork: h.authorize }))
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { sendProjectFollowup } from "./project-actions"

beforeEach(() => {
  vi.clearAllMocks()
  h.project.mockResolvedValue({
    id: "p1",
    userId: "u1",
    name: "Shop",
    state: "ready",
    totalumProjectId: "tp_1",
    specification: { complexity: "simple" },
    deployment: { id: "d1", status: "success", updatedAt: 1 },
  })
})

describe("sendProjectFollowup — production entitlement", () => {
  it("refuses a plan without production changes before writing a message or reserving credits", async () => {
    h.authorize.mockResolvedValue({
      allowed: false,
      code: "EXPLORER_PLANNING_ONLY",
      reason: "Your plan does not include production changes.",
    })

    const result = await sendProjectFollowup("u1", "p1", "Change the hero copy")

    expect(result).toMatchObject({ ok: false, status: 402, code: "EXPLORER_PLANNING_ONLY" })
    expect(h.authorize).toHaveBeenCalledWith("u1", "buildProduction")
    expect(h.appendMessage).not.toHaveBeenCalled()
    expect(h.createBuildRun).not.toHaveBeenCalled()
  })
})
