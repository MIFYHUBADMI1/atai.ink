/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const state = {
    users: [] as any[],
    referrals: [] as any[],
    grants: [] as any[],
    emails: [] as any[],
    signupBonus: 500,
    smtp: false,
  }
  const users = {
    findOne: vi.fn(async (filter: any) => {
      if (filter.referralCode) {
        return state.users.find((u) => u.referralCode === filter.referralCode && !u.deletedAt) ?? null
      }
      const user = state.users.find((u) => u.id === filter.id)
      if (!user) return null
      if (filter.deletedAt?.$exists === false && user.deletedAt) return null
      if (filter.banned?.$ne === true && user.banned) return null
      if (filter.suspended?.$ne === true && user.suspended) return null
      return user
    }),
    updateOne: vi.fn(async (filter: any, update: any) => {
      const user = state.users.find((u) => u.id === filter.id)
      if (user) Object.assign(user, update.$set)
    }),
  }
  const referrals = {
    insertOne: vi.fn(async (doc: any) => {
      state.referrals.push(doc)
    }),
    findOne: vi.fn(async (filter: any) => {
      if (filter.referredUserId) return state.referrals.find((r) => r.referredUserId === filter.referredUserId) ?? null
      if (filter.id) return state.referrals.find((r) => r.id === filter.id) ?? null
      if (filter._id) return state.referrals.find((r) => r._id === filter._id) ?? null
      return null
    }),
    countDocuments: vi.fn(async (filter: any) =>
      state.referrals.filter((r) => r.referrerUserId === filter.referrerUserId).length,
    ),
    updateOne: vi.fn(async (filter: any, update: any) => {
      const referral = state.referrals.find((r) => r._id === filter._id)
      if (referral) Object.assign(referral, update.$set)
    }),
    findOneAndUpdate: vi.fn(async (filter: any, update: any) => {
      const referral = state.referrals.find((r) => r._id === filter._id)
      if (!referral) return null
      const issued = "verificationRewardIssued" in filter ? "verificationRewardIssued" : "milestoneRewardIssued"
      if (referral[issued] || referral.status === "blocked") return null
      Object.assign(referral, update.$set)
      return referral
    }),
  }
  const session = { withTransaction: async (fn: () => Promise<unknown>) => fn(), endSession: async () => {} }
  const grant = vi.fn(async (params: any) => {
    state.grants.push(params)
    return { success: true }
  })
  return { state, users, referrals, session, grant }
})

vi.mock("@/lib/db/collections", () => ({
  ensureIndexes: async () => {},
  referralsCol: async () => h.referrals,
  usersCol: async () => h.users,
  buildRunsCol: async () => ({ aggregate: () => ({ toArray: async () => [] }) }),
}))
vi.mock("@/lib/db/mongodb", () => ({ getMongoClient: async () => ({ startSession: () => h.session }) }))
vi.mock("@/lib/billing/credit-service", () => ({ grantCredits: h.grant }))
vi.mock("@/lib/billing/runtime-config", () => ({
  getRewardSettings: async () => ({
    welcomeBonus: 500,
    referralSignupBonus: h.state.signupBonus,
    referralVerificationReward: 500,
    referralMilestoneReward: 1500,
    referralMilestoneThreshold: 75000,
  }),
}))
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/email/mailer", () => ({
  sendMail: vi.fn(async (mail: any) => {
    h.state.emails.push(mail)
  }),
}))
vi.mock("@/lib/email/templates", () => ({
  referralWelcomeEmail: (name: string, referrerName: string, bonus: number) => ({
    subject: `${name} joined through ${referrerName}`,
    html: `<p>${bonus}</p>`,
    text: `${bonus}`,
  }),
}))
vi.mock("@/lib/env", () => ({ isSmtpConfigured: () => h.state.smtp }))

import { captureReferral } from "./referrals"

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h.state, {
    users: [
      { id: "parent", name: "Ada", referralCode: "ATAI-ADA", emailVerified: true },
      { id: "child", name: "Sam", email: "sam@example.com", emailVerified: false },
    ],
    referrals: [],
    grants: [],
    emails: [],
    signupBonus: 500,
    smtp: false,
  })
})

describe("captureReferral — attribution and the referred user's bonus", () => {
  it("records the relationship and grants the signup bonus to the person who joined", async () => {
    const captured = await captureReferral("child", "ATAI-ADA")

    expect(captured?.referral.referrerUserId).toBe("parent")
    expect(captured?.signupBonus).toBe(500)
    expect(captured?.referrerName).toBe("Ada")
    expect(h.state.users.find((u) => u.id === "child")?.referredBy).toBe("parent")
    expect(h.state.grants).toHaveLength(1)
    expect(h.state.grants[0]).toMatchObject({
      userId: "child",
      amount: 500,
      transactionType: "referral_bonus",
      referenceType: "referral",
    })
    expect(h.state.grants[0].idempotencyKey).toMatch(/^referral_signup_/)
    // Unverified signup: the referrer's reward waits for email verification.
    expect(h.state.grants.some((g) => g.userId === "parent")).toBe(false)
  })

  it("settles the referrer's reward when an OAuth signup arrives already verified", async () => {
    h.state.users[1].emailVerified = true

    const captured = await captureReferral("child", "ATAI-ADA")

    expect(captured).not.toBeNull()
    expect(h.state.grants.map((g) => g.userId).sort()).toEqual(["child", "parent"])
    expect(h.state.grants.find((g) => g.userId === "parent")?.idempotencyKey).toMatch(/^referral_verification_/)
    expect(h.state.referrals[0].verificationRewardIssued).toBe(true)
  })

  it("emails the person who joined when SMTP is configured", async () => {
    h.state.smtp = true

    await captureReferral("child", "ATAI-ADA")

    expect(h.state.emails).toHaveLength(1)
    expect(h.state.emails[0].to).toBe("sam@example.com")
    expect(h.state.emails[0].subject).toContain("Ada")
  })

  it("normalizes a lowercase code from any caller", async () => {
    const captured = await captureReferral("child", "atai-ada")
    expect(captured?.referral.referrerUserId).toBe("parent")
    expect(captured?.referral.referralCode).toBe("ATAI-ADA")
  })

  it("does not send mail when SMTP is not configured", async () => {
    await captureReferral("child", "ATAI-ADA")
    expect(h.state.emails).toHaveLength(0)
  })

  it("creates the relationship but grants nothing when the signup bonus is zero", async () => {
    h.state.signupBonus = 0
    h.state.smtp = true

    const captured = await captureReferral("child", "ATAI-ADA")

    expect(captured?.signupBonus).toBe(0)
    expect(h.state.referrals).toHaveLength(1)
    expect(h.state.grants).toHaveLength(0)
    expect(h.state.emails).toHaveLength(0)
  })
})

describe("captureReferral — refusals", () => {
  it("rejects an unknown code", async () => {
    expect(await captureReferral("child", "ATAI-NOPE")).toBeNull()
    expect(h.state.referrals).toHaveLength(0)
    expect(h.state.grants).toHaveLength(0)
  })

  it("blocks self-referral", async () => {
    expect(await captureReferral("parent", "ATAI-ADA")).toBeNull()
    expect(h.state.referrals).toHaveLength(0)
  })

  it("does not overwrite an existing referral", async () => {
    h.state.referrals.push({ _id: "existing", id: "existing", referredUserId: "child", referrerUserId: "other" })

    expect(await captureReferral("child", "ATAI-ADA")).toBeNull()
    expect(h.state.grants).toHaveLength(0)
    expect(h.state.referrals).toHaveLength(1)
  })

  it("blocks a circular referral (the referrer was referred by this user)", async () => {
    h.state.users[0].referredBy = "child"

    expect(await captureReferral("child", "ATAI-ADA")).toBeNull()
    expect(h.state.referrals).toHaveLength(0)
  })

  it("is idempotent across repeated calls", async () => {
    const first = await captureReferral("child", "ATAI-ADA")
    const second = await captureReferral("child", "ATAI-ADA")

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(h.state.referrals).toHaveLength(1)
    expect(h.state.grants).toHaveLength(1)
  })
})
