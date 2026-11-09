import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression tests for session revocation vs the resolution cache
 * (audit finding F5): bans/suspensions and destroyAllSessionsForUser used to
 * leave a cached principal authorizing requests for the full cache TTL, and
 * requireUser never re-checked ban state at all.
 */

vi.mock("server-only", () => ({}))

const { mockSessionFindOne, mockDeleteMany, mockFindUserById } = vi.hoisted(() => ({
  mockSessionFindOne: vi.fn(),
  mockDeleteMany: vi.fn(async () => ({ deletedCount: 0 })),
  mockFindUserById: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => ({ value: "tok_banned_user" })),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => ({ get: vi.fn(() => null) })),
}))

vi.mock("@/lib/db/collections", () => ({
  sessionsCol: vi.fn(async () => ({
    findOne: mockSessionFindOne,
    deleteMany: mockDeleteMany,
    insertOne: vi.fn(async () => ({})),
  })),
}))

vi.mock("@/lib/auth/users", () => ({
  findUserById: mockFindUserById,
}))

import { getCurrentUser, requireUser, destroyAllSessionsForUser } from "../session"
import { hashToken } from "@/lib/auth/crypto"

const TOKEN_HASH = hashToken("tok_banned_user")

function userDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1", email: "u1@example.com", isAdmin: false,
    banned: false, suspended: false, ...overrides,
  } as never
}

beforeEach(() => {
  mockSessionFindOne.mockReset()
  mockFindUserById.mockReset()
  mockDeleteMany.mockClear()
})

describe("requireUser — ban enforcement", () => {
  it("rejects a banned user even though the session row still resolves", async () => {
    mockSessionFindOne.mockResolvedValue({ userId: "u1", expiresAt: new Date(Date.now() + 60_000) })
    mockFindUserById.mockResolvedValue(userDoc({ banned: true }))

    await expect(requireUser()).rejects.toMatchObject({ name: "AppError", code: "UNAUTHORIZED" })
  })

  it("rejects a suspended user", async () => {
    mockSessionFindOne.mockResolvedValue({ userId: "u1", expiresAt: new Date(Date.now() + 60_000) })
    mockFindUserById.mockResolvedValue(userDoc({ suspended: true }))

    await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  })
})

describe("destroyAllSessionsForUser — cache invalidation", () => {
  it("drops the cached principal so the next request cannot reuse it", async () => {
    // Prime the cache with a healthy user (cache stores the UserDoc).
    mockSessionFindOne.mockResolvedValue({ userId: "u1", expiresAt: new Date(Date.now() + 60_000) })
    mockFindUserById.mockResolvedValue(userDoc())
    expect(await getCurrentUser()).toMatchObject({ id: "u1" })

    // Sessions are revoked in DB; the DB now reports the token as dead.
    mockSessionFindOne.mockResolvedValue(null)
    await destroyAllSessionsForUser("u1")

    // Without cache invalidation this returns the stale cached user for 30s.
    expect(await getCurrentUser()).toBeNull()
    expect(mockSessionFindOne).toHaveBeenCalledWith(
      { tokenHash: TOKEN_HASH, expiresAt: { $gt: expect.any(Date) } },
    )
  })

  it("observes a session deleted by another instance without local invalidation", async () => {
    mockSessionFindOne.mockResolvedValue({ userId: "u1" })
    mockFindUserById.mockResolvedValue(userDoc())
    expect(await getCurrentUser()).toMatchObject({ id: "u1" })
    mockSessionFindOne.mockResolvedValue(null)
    expect(await getCurrentUser()).toBeNull()
    expect(mockDeleteMany).not.toHaveBeenCalled()
  })

  it.each(["banned", "suspended"])("observes %s changes after a previously authorized request", async (flag) => {
    mockSessionFindOne.mockResolvedValue({ userId: "u1" })
    mockFindUserById.mockResolvedValue(userDoc())
    expect(await requireUser()).toMatchObject({ id: "u1" })
    mockFindUserById.mockResolvedValue(userDoc({ [flag]: true }))
    await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  })
})
