import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression test for the fork refund bug (audit finding):
 *
 *  When credits were charged but project creation failed, the catch path
 *  released the reservation with `amount: 0` (based on a wrong comment —
 *  releaseReservation grants exactly `amount` back). The user permanently
 *  lost the fork cost. The charged amount must be refunded in full.
 */

vi.mock("server-only", () => ({}))

const {
  mockUser,
  mockReleaseReservation,
  mockReserveCredits,
  mockCreateProject,
  mockGetProject,
} = vi.hoisted(() => {
  const mockUser = { id: "u_forker", email: "forker@example.com" }
  return {
    mockUser,
    mockReleaseReservation: vi.fn(async () => true),
    mockReserveCredits: vi.fn(async () => true),
    mockCreateProject: vi.fn(async () => { throw new Error("db write failed") }),
    mockGetProject: vi.fn(),
  }
})

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => mockUser),
}))

vi.mock("@/lib/store/store", () => ({
  cryptoId: vi.fn(() => "cid"),
  store: {
    getProject: mockGetProject,
    createProject: mockCreateProject,
    appendEvent: vi.fn(async () => undefined),
  },
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => undefined),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  getAvailableCredits: vi.fn(async () => 1_000_000),
  reserveCredits: mockReserveCredits,
  releaseReservation: mockReleaseReservation,
  grantCredits: vi.fn(async () => ({ success: true })),
}))

vi.mock("@/lib/billing/runtime-config", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getForkPricingForTier: vi.fn(async () => ({
    forkCost: 15_000, ownerRoyalty: 5_000, savingsPct: 45,
  })),
}))

vi.mock("@/lib/db/collections", () => ({
  projectForksCol: vi.fn(async () => ({ findOne: vi.fn(async () => null) })),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from "./fork/route"

const original = {
  id: "p_public",
  userId: "u_owner",
  name: "Public app",
  visibility: "public",
  mode: "mirror",
  state: "ready",
  specification: { complexity: "simple" },
}

describe("POST /api/projects/:id/fork — refund on failure", () => {
  beforeEach(() => {
    mockReleaseReservation.mockClear()
    mockReserveCredits.mockClear()
    mockCreateProject.mockClear()
    mockGetProject.mockResolvedValue(original as never)
  })

  it("releases the full charged amount when project creation fails", async () => {
    const res = await POST(new Request("http://localhost/api/projects/p_public/fork", { method: "POST" }), {
      params: Promise.resolve({ id: "p_public" }),
    })

    expect(res.status).toBe(500)
    expect(mockReserveCredits).toHaveBeenCalled()
    expect(mockReleaseReservation).toHaveBeenCalledTimes(1)
    const arg = (mockReleaseReservation.mock.calls[0] as unknown[])[0] as { amount: number; userId: string }
    expect(arg.amount).toBe(15_000)
    expect(arg.userId).toBe("u_forker")
  })
})
