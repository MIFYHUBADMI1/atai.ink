import { beforeEach, describe, expect, it, vi } from "vitest"
import { ObjectId } from "mongodb"

/**
 * Session cap: an account may hold at most MAX_ACTIVE_SESSIONS live sessions.
 * Signing in beyond the cap revokes the OLDEST sessions automatically so
 * credential sharing / session farming can't accumulate devices.
 */

vi.mock("server-only", () => ({}))

// ---------------------------------------------------------------------------
// In-memory sessions collection fake — implements just the surface
// createSession() touches: insertOne / find().sort().skip().project().toArray()
// / deleteMany().
// ---------------------------------------------------------------------------
interface FakeSession {
  _id: ObjectId
  userId: string
  tokenHash: string
  createdAt: number
  expiresAt: Date
}

const { store } = vi.hoisted(() => ({ store: [] as FakeSession[] }))

function matchesQuery(doc: FakeSession, query: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(query)) {
    if (key === "expiresAt" && cond && typeof cond === "object" && "$gt" in (cond as object)) {
      if (!(doc.expiresAt > (cond as { $gt: Date }).$gt)) return false
      continue
    }
    if (doc[key as keyof FakeSession] !== cond) return false
  }
  return true
}

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => ({ get: vi.fn(() => "vitest-agent") })),
}))

vi.mock("@/lib/db/collections", () => ({
  sessionsCol: vi.fn(async () => ({
    insertOne: vi.fn(async (doc: FakeSession) => {
      store.push(doc)
      return { insertedId: doc._id }
    }),
    find: vi.fn((query: Record<string, unknown>) => {
      let docs = store.filter((d) => matchesQuery(d, query))
      const chain = {
        sort(spec: Record<string, 1 | -1>) {
          const [[k1, dir1], [k2, dir2]] = Object.entries(spec) as [string, 1 | -1][]
          docs = [...docs].sort((a, b) => {
            const av = a[k1 as keyof FakeSession] as number | Date | ObjectId
            const bv = b[k1 as keyof FakeSession] as number | Date | ObjectId
            const primary = av < bv ? -1 : av > bv ? 1 : 0
            if (primary !== 0) return primary * dir1
            if (!k2) return 0
            const av2 = String(a[k2 as keyof FakeSession])
            const bv2 = String(b[k2 as keyof FakeSession])
            return (av2 < bv2 ? -1 : av2 > bv2 ? 1 : 0) * dir2
          })
          return chain
        },
        skip(n: number) {
          docs = docs.slice(n)
          return chain
        },
        project() {
          return chain
        },
        toArray: vi.fn(async () => docs),
      }
      return chain
    }),
    countDocuments: vi.fn(async (query: Record<string, unknown>) =>
      store.filter((d) => matchesQuery(d, query)).length,
    ),
    deleteMany: vi.fn(async (query: { _id?: { $in?: ObjectId[] } }) => {
      const doomed = new Set((query._id?.$in ?? []).map(String))
      const before = store.length
      for (let i = store.length - 1; i >= 0; i--) {
        if (doomed.has(String(store[i]._id))) store.splice(i, 1)
      }
      return { deletedCount: before - store.length }
    }),
  })),
}))

vi.mock("@/lib/auth/users", () => ({ findUserById: vi.fn() }))

// Admin-cap policy is a separate concern (and would hit the real DB here).
// Default: regular accounts capped at 2, admins unlimited.
vi.mock("@/lib/auth/session-policy", () => ({
  DEFAULT_USER_MAX_ACTIVE_SESSIONS: 2,
  getMaxActiveSessionsForUser: vi.fn(async (user: { isAdmin?: boolean }) =>
    user.isAdmin ? null : 2,
  ),
}))

import { createSession, evictOldestSessions, sessionLimitReached, MAX_ACTIVE_SESSIONS } from "../session"
import { findUserById } from "@/lib/auth/users"
import { hashToken } from "@/lib/auth/crypto"

beforeEach(() => {
  store.length = 0
})

describe("createSession — per-account session cap", () => {
  it("keeps only the newest MAX_ACTIVE_SESSIONS sessions", async () => {
    const t1 = await createSession("u1")
    const t2 = await createSession("u1")
    const t3 = await createSession("u1")

    expect(store).toHaveLength(MAX_ACTIVE_SESSIONS)
    const hashes = store.map((s) => s.tokenHash)
    expect(hashes).toContain(hashToken(t2))
    expect(hashes).toContain(hashToken(t3))
    // The oldest session was revoked automatically.
    expect(hashes).not.toContain(hashToken(t1))
  })

  it("caps each user independently", async () => {
    await createSession("u1")
    await createSession("u1")
    await createSession("u1")
    await createSession("u2")
    await createSession("u2")

    expect(store.filter((s) => s.userId === "u1")).toHaveLength(2)
    expect(store.filter((s) => s.userId === "u2")).toHaveLength(2)
  })

  it("does not count expired sessions toward the cap", async () => {
    // Seed an already-expired session directly.
    store.push({
      _id: new ObjectId(),
      userId: "u1",
      tokenHash: "expired",
      createdAt: Date.now() - 60_000,
      expiresAt: new Date(Date.now() - 1_000),
    })

    await createSession("u1")
    await createSession("u1")

    // Expired row is untouched; both live sessions survive.
    expect(store).toHaveLength(3)
    expect(store.some((s) => s.tokenHash === "expired")).toBe(true)
  })
})

describe("sessionLimitReached / evictOldestSessions", () => {
  it("reports the cap once MAX_ACTIVE_SESSIONS live sessions exist", async () => {
    expect(await sessionLimitReached({ id: "u1" })).toBe(false)
    await createSession("u1")
    await createSession("u1")
    expect(await sessionLimitReached({ id: "u1" })).toBe(true)
  })

  it("admins are unlimited by default — cap never reached, no eviction", async () => {
    vi.mocked(findUserById).mockResolvedValue({ id: "adm", isAdmin: true } as never)
    try {
      for (let i = 0; i < 5; i++) await createSession("adm")
      expect(store).toHaveLength(5)
      expect(await sessionLimitReached({ id: "adm", isAdmin: true })).toBe(false)
    } finally {
      vi.mocked(findUserById).mockReset()
    }
  })

  it("evicts the oldest sessions down to the requested keep count", async () => {
    const t1 = await createSession("u1")
    await createSession("u1")
    const t3 = await createSession("u1") // triggers cap → evicts t1, keeps middle + t3

    // Simulate the verify-complete path: keep MAX-1 (=1), then a new session.
    const removed = await evictOldestSessions("u1", MAX_ACTIVE_SESSIONS - 1)
    expect(removed).toBe(1)
    expect(store).toHaveLength(1)
    expect(store[0].tokenHash).toBe(hashToken(t3))
    expect(store[0].tokenHash).not.toBe(hashToken(t1))
  })
})
