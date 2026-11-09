import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { VerificationTokenDoc } from "@/lib/types/db"

type State = {
  tokens: VerificationTokenDoc[]
  users: Array<{ id: string; passwordHash: string; deletedAt?: number; banned?: boolean; suspended?: boolean }>
  sessions: Array<{ userId: string }>
}

const harness = vi.hoisted(() => {
  const state: State = { tokens: [], users: [], sessions: [] }
  const failures = { step: "", retry: false }
  let gate = Promise.resolve()
  const fail = (step: string) => {
    if (failures.step === step) throw new Error(`simulated ${step} failure`)
  }
  const assertSession = (options: { session?: unknown }) => expect(options.session).toBe(session)
  const tokens = {
    findOne: vi.fn(async (filter: { tokenHash: string; purpose: string }) =>
      state.tokens.find((token) => token.tokenHash === filter.tokenHash && token.purpose === filter.purpose) ?? null),
    findOneAndUpdate: vi.fn(async (filter, update, options) => {
      assertSession(options)
      expect(filter.usedAt).toEqual({ $exists: false })
      expect(options.returnDocument).toBe("after")
      fail("claim")
      const token = state.tokens.find((t) => t.tokenHash === filter.tokenHash && t.purpose === filter.purpose && t.usedAt === undefined && t.expiresAt > filter.expiresAt.$gt)
      if (!token) return null
      Object.assign(token, update.$set)
      return { ...token }
    }),
    updateMany: vi.fn(async (filter, update, options) => {
      assertSession(options)
      fail("invalidate")
      for (const token of state.tokens) {
        if (token.userId === filter.userId && token.purpose === filter.purpose && token.usedAt === undefined) Object.assign(token, update.$set)
      }
    }),
  }
  const users = {
    findOne: vi.fn(async (filter, options) => {
      assertSession(options)
      expect(filter.banned).toEqual({ $ne: true })
      expect(filter.suspended).toEqual({ $ne: true })
      return state.users.find((u) => u.id === filter.id && u.deletedAt === undefined && !u.banned && !u.suspended) ?? null
    }),
    updateOne: vi.fn(async (filter, update, options) => {
      assertSession(options)
      expect(filter.deletedAt).toEqual({ $exists: false })
      fail("password")
      const user = state.users.find((u) => u.id === filter.id && u.deletedAt === undefined)
      if (!user) return { matchedCount: 0 }
      Object.assign(user, update.$set)
      return { matchedCount: 1 }
    }),
  }
  const sessions = {
    deleteMany: vi.fn(async (filter, options) => {
      assertSession(options)
      fail("sessions")
      state.sessions = state.sessions.filter((s) => s.userId !== filter.userId)
    }),
  }
  const session = {
    endSession: vi.fn(async () => undefined),
    withTransaction: vi.fn(async (callback: () => Promise<void>) => {
      const previous = gate
      let release!: () => void
      gate = new Promise<void>((resolve) => { release = resolve })
      await previous
      try {
        for (;;) {
          const snapshot = structuredClone(state)
          try {
            await callback()
            fail("commit")
            return
          } catch (error) {
            Object.assign(state, snapshot)
            if (!failures.retry) throw error
            failures.retry = false
            failures.step = ""
          }
        }
      } finally {
        release()
      }
    }),
  }
  return { state, failures, tokens, users, sessions, session, ensureIndexes: vi.fn(async () => undefined) }
})

vi.mock("@/lib/db/collections", () => ({
  verificationTokensCol: async () => harness.tokens,
  usersCol: async () => harness.users,
  sessionsCol: async () => harness.sessions,
  ensureIndexes: harness.ensureIndexes,
}))
vi.mock("@/lib/db/mongodb", () => ({ getMongoClient: async () => ({ startSession: () => harness.session }) }))
vi.mock("@/lib/store/store", () => ({ cryptoId: vi.fn(), store: {} }))
vi.mock("@/lib/billing/credit-service", () => ({ grantCredits: vi.fn() }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => undefined) }))
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }))

import { checkRateLimit } from "./rate-limit"
import { AppError } from "@/lib/errors"
import { resetPassword } from "./password-reset"
import { generateToken, hashToken, hashPassword, verifyPassword } from "./crypto"

const raw = generateToken()
let oldHash = ""
const password = "replacement-password-123"
beforeAll(async () => { oldHash = await hashPassword("old-password-123") })
beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  harness.failures.step = ""
  harness.failures.retry = false
  harness.state.tokens = [{
    userId: "user1", purpose: "password_reset", tokenHash: hashToken(raw),
    createdAt: Date.now(), expiresAt: new Date(Date.now() + 60_000),
  } as VerificationTokenDoc]
  harness.state.users = [{ id: "user1", passwordHash: oldHash }]
  harness.state.sessions = [{ userId: "user1" }, { userId: "user1" }, { userId: "other" }]
})

describe("password reset transaction contract (in-memory rollback harness, not Mongo integration)", { timeout: 30_000 }, () => {
  it("uses real hashing and password/session helpers in one transaction", async () => {
    await resetPassword(raw, password)
    const hash = harness.state.users[0].passwordHash
    expect(hash).not.toBe(password)
    expect(await verifyPassword(password, hash)).toBe(true)
    expect(await verifyPassword("old-password-123", hash)).toBe(false)
    expect(harness.state.sessions).toEqual([{ userId: "other" }])
    expect(harness.state.tokens[0].usedAt).toEqual(expect.any(Number))
    expect(harness.session.withTransaction).toHaveBeenCalledWith(expect.any(Function), {
      readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 10_000,
    })
    expect(harness.session.endSession).toHaveBeenCalledOnce()
  })

  it.each(["missing", "used", "expired", "wrong-purpose"])("rejects %s tokens without changing the password", async (kind) => {
    if (kind === "missing") harness.state.tokens = []
    if (kind === "used") harness.state.tokens[0].usedAt = 0
    if (kind === "expired") harness.state.tokens[0].expiresAt = new Date(Date.now() - 1)
    if (kind === "wrong-purpose") harness.state.tokens[0].purpose = "email_verify"
    await expect(resetPassword(raw, password)).rejects.toMatchObject({ code: kind === "expired" ? "VERIFICATION_EXPIRED" : "VERIFICATION_INVALID" })
    expect(harness.users.updateOne).not.toHaveBeenCalled()
    expect(harness.session.withTransaction).not.toHaveBeenCalled()
  })

  it("expires tokens server-side even if the TTL monitor has not deleted them", async () => {
    const now = Date.now()
    harness.state.tokens[0].expiresAt = new Date(now)
    vi.spyOn(Date, "now").mockReturnValue(now)
    await expect(resetPassword(raw, password)).rejects.toMatchObject({ code: "VERIFICATION_EXPIRED" })
  })

  it("rechecks expiry after password hashing", async () => {
    const now = Date.now()
    harness.state.tokens[0].expiresAt = new Date(now + 1)
    vi.spyOn(Date, "now").mockReturnValueOnce(now).mockReturnValue(now + 2)
    await expect(resetPassword(raw, password)).rejects.toMatchObject({ code: "VERIFICATION_INVALID" })
    expect(harness.state.users[0].passwordHash).toBe(oldHash)
  })

  it.each(["claim", "password", "sessions", "invalidate", "commit"])("rolls back on %s failure and the same link can be retried", async (step) => {
    harness.failures.step = step
    await expect(resetPassword(raw, password)).rejects.toThrow(`simulated ${step} failure`)
    expect(harness.state.tokens[0].usedAt).toBeUndefined()
    expect(harness.state.users[0].passwordHash).toBe(oldHash)
    expect(harness.state.sessions).toHaveLength(3)
    harness.failures.step = ""
    await resetPassword(raw, password)
    expect(await verifyPassword(password, harness.state.users[0].passwordHash)).toBe(true)
  })

  it("allows only one concurrent consumption of the same token", async () => {
    const results = await Promise.allSettled([resetPassword(raw, password), resetPassword(raw, password)])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1)
    expect(harness.users.updateOne).toHaveBeenCalledOnce()
  })

  it("invalidates other outstanding reset links without consuming email-verification tokens", async () => {
    const otherRaw = generateToken()
    harness.state.tokens.push({ ...harness.state.tokens[0], tokenHash: hashToken(otherRaw) })
    harness.state.tokens.push({ ...harness.state.tokens[0], purpose: "email_verify", tokenHash: hashToken(generateToken()) })
    await resetPassword(raw, password)
    await expect(resetPassword(otherRaw, password)).rejects.toMatchObject({ code: "VERIFICATION_INVALID" })
    expect(harness.state.tokens[2].usedAt).toBeUndefined()
  })

  it.each(["deleted", "banned", "suspended", "oauth-only"])("refuses reset for a now-%s account without consuming its token", async (kind) => {
    if (kind === "deleted") harness.state.users[0].deletedAt = Date.now()
    if (kind === "banned") harness.state.users[0].banned = true
    if (kind === "suspended") harness.state.users[0].suspended = true
    if (kind === "oauth-only") harness.state.users[0].passwordHash = ""
    const previousHash = harness.state.users[0].passwordHash
    await expect(resetPassword(raw, password)).rejects.toMatchObject({ code: "VERIFICATION_INVALID" })
    expect(harness.state.tokens[0].usedAt).toBeUndefined()
    expect(harness.state.users[0].passwordHash).toBe(previousHash)
    expect(harness.state.sessions).toHaveLength(3)
  })

  it("limits submission by token-derived account before password or session mutation", async () => {
    vi.mocked(checkRateLimit).mockRejectedValueOnce(new AppError("RATE_LIMITED"))
    await expect(resetPassword(raw, password)).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(checkRateLimit).toHaveBeenCalledWith({ action: "password_reset_account", identifier: "user1", limit: 10, windowMs: 900_000 })
    expect(harness.users.updateOne).not.toHaveBeenCalled()
    expect(harness.session.withTransaction).not.toHaveBeenCalled()
    expect(harness.state.tokens[0].usedAt).toBeUndefined()
  })

  it("supports driver callback retries without consuming the token outside the transaction", async () => {
    harness.failures.step = "sessions"
    harness.failures.retry = true
    await resetPassword(raw, password)
    expect(harness.tokens.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(harness.state.sessions).toEqual([{ userId: "other" }])
  })
})
