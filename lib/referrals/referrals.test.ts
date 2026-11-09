import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const state = { referral: {} as any, users: [] as any[], credits: 0, ledger: [] as string[], usage: 0, count: 1, fail: false }
  let gate = Promise.resolve()
  const session = {
    endSession: vi.fn(async () => {}),
    withTransaction: async (fn: () => Promise<unknown>) => {
      const previous = gate
      let release!: () => void
      gate = new Promise<void>((resolve) => { release = resolve })
      await previous
      const snapshot = structuredClone(state)
      try { return await fn() } catch (error) { Object.assign(state, snapshot); throw error } finally { release() }
    },
  }
  const referrals = {
    findOne: vi.fn(async () => state.referral),
    countDocuments: vi.fn(async () => state.count),
    updateOne: vi.fn(async (_filter, update, options) => {
      expect(options.session).toBe(session)
      Object.assign(state.referral, update.$set)
    }),
    findOneAndUpdate: vi.fn(async (filter, update, options) => {
      expect(options.session).toBe(session)
      const issued = "verificationRewardIssued" in filter ? "verificationRewardIssued" : "milestoneRewardIssued"
      if (state.referral[issued] || state.referral.status === "blocked") return null
      Object.assign(state.referral, update.$set)
      return state.referral
    }),
  }
  const users = { findOne: vi.fn(async (filter) => state.users.find((u) => u.id === filter.id && !u.deletedAt && !u.banned && !u.suspended) ?? null) }
  const runs = { aggregate: vi.fn((pipeline, options) => {
    expect(options.session).toBe(session)
    expect(pipeline[0].$match).toMatchObject({ userId: "child", status: "succeeded" })
    return { toArray: async () => [{ total: state.usage }] }
  }) }
  const grant = vi.fn(async (params) => {
    expect(params.session).toBe(session)
    if (!state.ledger.includes(params.idempotencyKey)) { state.ledger.push(params.idempotencyKey); state.credits += params.amount }
    if (state.fail) throw new Error("write failed")
    return { success: true }
  })
  return { state, session, referrals, users, runs, grant }
})
vi.mock("@/lib/db/collections", () => ({ ensureIndexes: async () => {}, referralsCol: async () => h.referrals, usersCol: async () => h.users, buildRunsCol: async () => h.runs }))
vi.mock("@/lib/db/mongodb", () => ({ getMongoClient: async () => ({ startSession: () => h.session }) }))
vi.mock("@/lib/billing/credit-service", () => ({ grantCredits: h.grant }))
vi.mock("@/lib/billing/runtime-config", () => ({ getRewardSettings: async () => ({ referralVerificationReward: 500, referralMilestoneReward: 1500, referralMilestoneThreshold: 75000 }) }))
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
import { processMilestoneCheck, processVerificationReward } from "./referrals"

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h.state, { referral: { _id: "r", id: "r", referredUserId: "child", referrerUserId: "parent", verificationRewardIssued: false, milestoneRewardIssued: false, eligibleUsage: 0, status: "registered", createdAt: 1 }, users: [{ id: "child", emailVerified: true, referredBy: "parent" }, { id: "parent" }], credits: 0, ledger: [], usage: 0, count: 1, fail: false })
})

describe("referral reward transaction contract (modeled storage, not real Mongo)", () => {
  it("commits exactly one verification reward under concurrent replay", async () => {
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => processVerificationReward("child")))
    expect(outcomes.filter(Boolean)).toHaveLength(1)
    expect(h.state.credits).toBe(500)
    expect(h.state.ledger).toEqual(["referral_verification_r"])
  })
  it("rolls back the claim, credit and ledger on failure, then allows retry", async () => {
    h.state.fail = true
    await expect(processVerificationReward("child")).rejects.toThrow("write failed")
    expect(h.state.referral.verificationRewardIssued).toBe(false)
    expect(h.state.credits).toBe(0)
    expect(h.state.ledger).toHaveLength(0)
    h.state.fail = false
    expect(await processVerificationReward("child")).toBe(true)
    expect(h.state.credits).toBe(500)
  })
  it.each(["unverified", "deleted", "suspended", "self", "circular", "missing-referrer", "mismatch", "blocked", "flagged", "high-count"])("defers %s without granting credits", async (kind) => {
    if (kind === "unverified") h.state.users[0].emailVerified = false
    if (kind === "deleted") h.state.users[0].deletedAt = 1
    if (kind === "suspended") h.state.users[0].suspended = true
    if (kind === "self") h.state.referral.referrerUserId = "child"
    if (kind === "circular") h.state.users[1].referredBy = "child"
    if (kind === "missing-referrer") h.state.users.pop()
    if (kind === "mismatch") h.state.users[0].referredBy = "other"
    if (kind === "blocked") h.state.referral.status = "blocked"
    if (kind === "flagged") h.state.referral.fraudFlags = ["suspicious"]
    if (kind === "high-count") h.state.count = 21
    expect(await processVerificationReward("child")).toBe(false)
    expect(h.state.credits).toBe(0)
    expect(h.state.ledger).toHaveLength(0)
  })
  it("allows reviewed weak signals without bypassing hard eligibility checks", async () => {
    h.state.count = 21
    h.state.referral.review = { decision: "approve", approvedFlags: ["high_referral_count"] }
    expect(await processVerificationReward("child")).toBe(true)
    h.state.referral.verificationRewardIssued = false
    h.state.users[0].referredBy = "other"
    expect(await processVerificationReward("child")).toBe(false)
    expect(h.state.credits).toBe(500)
  })
  it("derives milestone usage from successful runs and ignores duplicate events", async () => {
    h.state.usage = 40000
    expect(await processMilestoneCheck("child")).toBe(false)
    expect(await processMilestoneCheck("child")).toBe(false)
    expect(h.state.referral.eligibleUsage).toBe(40000)
    h.state.usage = 75000
    const results = await Promise.all([processMilestoneCheck("child"), processMilestoneCheck("child")])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(h.state.credits).toBe(1500)
    expect(h.state.ledger).toEqual(["referral_milestone_r"])
  })
})
