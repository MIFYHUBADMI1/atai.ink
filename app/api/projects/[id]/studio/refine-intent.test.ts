import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const {
  mockUser,
  mockCharge,
  mockRefund,
  mockAfford,
  mockRefine,
  mockVariations,
  mockLimit,
  mockLease,
  mockRelease,
} = vi.hoisted(() => {
  const mockUser = { id: "8f2c41e8-a7b6-4d0e-9c3f-8a2b7d5e1c60", email: "founder@example.com" }
  const mockRelease = vi.fn(async () => undefined)
  return {
    mockUser,
    mockCharge: vi.fn<(userId: string, projectId: string, key?: string) => Promise<boolean>>().mockResolvedValue(true),
    mockRefund: vi.fn<(userId: string, projectId: string, key?: string) => Promise<void>>().mockResolvedValue(undefined),
    mockAfford: vi.fn(async () => ({ cost: 10, available: 5000, affordable: true })),
    mockRefine: vi.fn(async () => ({ body: "refined copy", model: "test-model" })),
    mockVariations: vi.fn(async () => ({ variants: ["a", "b"], model: "test-model" })),
    mockLimit: vi.fn(async () => undefined),
    mockLease: vi.fn(async () => mockRelease),
    mockRelease,
  }
})

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(async () => mockUser) }))
vi.mock("@/lib/api/ai-lease", () => ({ acquireAiLease: mockLease, AI_DEADLINE_MS: 540_000 }))

vi.mock("@/lib/marketing/studio/api-guard", () => ({
  requireStudioProject: vi.fn(async () => ({ ok: true as const, user: mockUser })),
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: mockLimit,
}))

vi.mock("@/lib/marketing/studio/library", () => ({
  getContentItem: vi.fn(async () => ({ id: "item_1", title: "Launch post", body: "We ship on Friday." })),
}))

vi.mock("@/lib/marketing/studio/brand", () => ({
  getBrandProfile: vi.fn(async () => ({})),
  brandContextLines: vi.fn(() => ({ lines: [] })),
}))

vi.mock("@/lib/marketing/studio/credits", () => ({
  getStudioAffordability: mockAfford,
  chargeStudioCredits: mockCharge,
  refundStudioCredits: mockRefund,
}))

// Keep the real action enum (the request schema validates against it) and stub
// only the provider call — no AI, no money.
vi.mock("@/lib/marketing/studio/refine", async () => {
  const { REFINEMENT_ACTIONS } = await import("@/lib/marketing/studio/refinement-options")
  return { REFINEMENT_ACTIONS, generateRefinement: mockRefine, generateVariations: mockVariations }
})

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { POST as refine } from "./refine/route"
import { POST as variations } from "./variations/route"
import { AppError } from "@/lib/errors"

/**
 * Atai Finance — Phase 3 Workstream C at the Studio boundary.
 *
 * These routes accept a client `requestId` and turn it into a ledger
 * idempotency key. The ledger's uniqueness constraint is GLOBAL, so an
 * unscoped client string is not a retry key — it is a shared namespace: two
 * users who send the same value would see the second one's charge recognised
 * as "already applied", i.e. a free billable operation. The tests below pin
 * the scoping contract at the route, which is the last place that knows both
 * the session identity and the operation.
 */

/** Next's route signature: POST(request, { params }). */
const ctx = (id = "prj_1") => ({ params: Promise.resolve({ id }) })

function json(body: unknown) {
  return new Request("http://localhost/api/projects/prj_1/studio/refine", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function refinedBody(requestId: string) {
  return { contentId: "item_1", action: "improve", requestId }
}

function variationsBody(requestId: string) {
  return { contentId: "item_1", count: 2, requestId }
}

function chargedKey(call = 0): string | undefined {
  return mockCharge.mock.calls[call]?.[2] as string | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUser.id = "8f2c41e8-a7b6-4d0e-9c3f-8a2b7d5e1c60"
})

describe("the client's requestId names a retry; it is never authorization", () => {
  it("scopes the charge key to the session user and this operation", async () => {
    await refine(json(refinedBody("b3d1e0a2-1111-2222-3333-444455556666")), ctx())

    const key = chargedKey()
    expect(key).toBeDefined()
    expect(key).toContain("studio_refine")
    expect(key).toContain(mockUser.id)
    expect(mockCharge).toHaveBeenCalledWith(mockUser.id, "prj_1", key)
  })

  it("is stable across retries from the same caller — the whole point", async () => {
    await refine(json(refinedBody("c0ffee00-dead-beef-0000-000000000001")), ctx())
    await refine(json(refinedBody("c0ffee00-dead-beef-0000-000000000001")), ctx())
    expect(mockCharge).toHaveBeenCalledTimes(2)
    expect(chargedKey(0)).toBeDefined()
    expect(chargedKey(0)).toBe(chargedKey(1))
  })

  it("two users sending the SAME requestId get different ledger keys", async () => {
    const shared = "aaaaaaaa-1111-2222-3333-444455556666"

    await refine(json(refinedBody(shared)), ctx())
    const firstUserKey = chargedKey(0)

    mockUser.id = "zzzzzzzz-1111-2222-3333-444455556666"
    await refine(json(refinedBody(shared)), ctx())
    const secondUserKey = chargedKey(1)

    expect(firstUserKey).toBeDefined()
    expect(secondUserKey).toBeDefined()
    expect(firstUserKey).not.toBe(secondUserKey)
  })

  it("the same requestId is a different operation on /variations", async () => {
    const shared = "dedbeef0-1111-2222-3333-444455556666"
    await refine(json(refinedBody(shared)), ctx())
    await variations(json(variationsBody(shared)), ctx())
    expect(chargedKey(0)).not.toBe(chargedKey(1))
  })

  it("a requestId that tries to forge the scope boundary is not used as an identity", async () => {
    // `~` separates the server scope from the client intent; a client that
    // could embed it could relocate its own boundary. The route must fall back
    // to "no stable key" (a per-attempt charge) rather than build an
    // ambiguous one.
    await refine(json(refinedBody("intent_studio_refine_prj_1_victimid~hijacked")), ctx())
    expect(chargedKey(0)).toBeUndefined()

    // Legitimately sized, but not an opaque id → no stable identity, not an
    // ambiguous one.
    await variations(json(variationsBody("scope_prj_1_victim~hijacked")), ctx())
    expect(chargedKey(1)).toBeUndefined()
    expect(mockCharge).toHaveBeenCalledTimes(2)
  })

  it("an absent requestId still charges — it just has no retry identity", async () => {
    const res = await refine(json({ contentId: "item_1", action: "improve" }), ctx())
    expect(res.status).toBe(200)
    expect(mockCharge).toHaveBeenCalledWith(mockUser.id, "prj_1", undefined)
  })

  it("never lets the client pick the operation, the user, or the project", async () => {
    // The body schema is strict: identity fields in the payload are rejected,
    // so the only client-controlled part of a ledger key is the intent string
    // — which the routes above show is scoped server-side.
    const res = await refine(json({ contentId: "item_1", action: "improve", requestId: "abcdef12", userId: "victim", projectId: "prj_victim" }), ctx())
    expect(res.status).toBe(422)
    expect(mockCharge).not.toHaveBeenCalled()
  })
})

describe("the refund side carries the same identity", () => {
  it("a failed generation refunds the SAME scoped key (retried failure cannot double-refund)", async () => {
    mockRefine.mockRejectedValueOnce(new Error("provider exploded"))

    await refine(json(refinedBody("feedface-1111-2222-3333-444455556666")), ctx())

    expect(mockRefund).toHaveBeenCalledTimes(1)
    const [, , refundKey] = mockRefund.mock.calls[0] as [string, string, string]
    expect(refundKey).toBe(chargedKey(0))
    expect(refundKey).toContain("studio_refine")
    expect(refundKey).toContain(mockUser.id)
    expect(mockRelease).toHaveBeenCalledOnce()
  })
})

describe("AI protection precedes Studio billing", () => {
  it.each([refine, variations])("rejects burst-limited requests without charges, refunds or provider work", async (route) => {
    const error = new AppError("RATE_LIMITED")
    error.retryAfterSeconds = 30
    mockLimit.mockRejectedValueOnce(error)
    const res = await route(json({ contentId: "item_1", action: "improve", count: 2 }), ctx())
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("30")
    expect(mockCharge).not.toHaveBeenCalled()
    expect(mockRefund).not.toHaveBeenCalled()
    expect(mockRefine).not.toHaveBeenCalled()
    expect(mockVariations).not.toHaveBeenCalled()
    expect(mockLease).not.toHaveBeenCalled()
  })

  it("rejects hourly capacity exhaustion before charging", async () => {
    mockLimit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new AppError("RATE_LIMITED"))
    expect((await refine(json(refinedBody("abcdef12")), ctx())).status).toBe(429)
    expect(mockCharge).not.toHaveBeenCalled()
    expect(mockLease).not.toHaveBeenCalled()
  })

  it("rejects concurrency exhaustion before charging", async () => {
    mockLease.mockRejectedValueOnce(new AppError("RATE_LIMITED"))
    expect((await refine(json(refinedBody("abcdef12")), ctx())).status).toBe(429)
    expect(mockCharge).not.toHaveBeenCalled()
    expect(mockRefund).not.toHaveBeenCalled()
    expect(mockRefine).not.toHaveBeenCalled()
  })

  it("fails closed on quota storage failure rather than executing unpaid work", async () => {
    mockLimit.mockRejectedValueOnce(new AppError("DATABASE_UNAVAILABLE"))
    expect((await refine(json(refinedBody("abcdef12")), ctx())).status).toBe(503)
    expect(mockCharge).not.toHaveBeenCalled()
    expect(mockRefine).not.toHaveBeenCalled()
  })
})
