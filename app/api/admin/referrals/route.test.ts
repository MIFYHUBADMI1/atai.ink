import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ admin: vi.fn(), limit: vi.fn(), find: vi.fn(), update: vi.fn(), fraud: vi.fn(), verification: vi.fn(), milestone: vi.fn() }))
vi.mock("@/lib/auth/session", () => ({ requireAdmin: h.admin }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: h.limit }))
vi.mock("@/lib/referrals/referrals", () => ({ getAllReferrals: vi.fn(), runFraudChecks: h.fraud, processVerificationReward: h.verification, processMilestoneCheck: h.milestone }))
vi.mock("@/lib/db/collections", () => ({ referralsCol: async () => ({ findOne: h.find, updateOne: h.update }), usersCol: vi.fn() }))
vi.mock("@/lib/logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
import { PATCH } from "./route"
import { AppError } from "@/lib/errors"

const request = (patch = {}) => new Request("http://localhost/api/admin/referrals", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "r", decision: "approve", reason: "Verified attribution with owner", ...patch }) })
beforeEach(() => {
  vi.resetAllMocks()
  h.admin.mockResolvedValue({ id: "real-admin" })
  h.find.mockResolvedValue({ _id: "r", id: "r", referredUserId: "child", fraudFlags: ["high_referral_count", "self_referral"], verificationRewardIssued: false, milestoneRewardIssued: false })
})

describe("referral review authorization and policy boundary", () => {
  it("rejects non-admins before reading or changing referrals", async () => {
    h.admin.mockRejectedValueOnce(new AppError("UNAUTHORIZED", "Admin access required.", 403))
    expect((await PATCH(request({ adminId: "spoofed" }))).status).toBe(403)
    expect(h.find).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
    expect(h.verification).not.toHaveBeenCalled()
  })
  it("records the real admin and excludes hard fraud flags from approval", async () => {
    expect((await PATCH(request({ adminId: "spoofed" }))).status).toBe(200)
    expect(h.update).toHaveBeenCalledWith({ _id: "r" }, { $set: expect.objectContaining({ review: expect.objectContaining({ adminId: "real-admin", approvedFlags: ["high_referral_count"], reason: "Verified attribution with owner" }) }) })
    expect(h.verification).toHaveBeenCalledWith("child")
    expect(h.milestone).toHaveBeenCalledWith("child")
  })
  it("blocks future rewards without revoking existing legitimate credits", async () => {
    expect((await PATCH(request({ decision: "block" }))).status).toBe(200)
    expect(h.update).toHaveBeenCalledWith({ _id: "r" }, { $set: expect.objectContaining({ status: "blocked", review: expect.objectContaining({ decision: "block", approvedFlags: [] }) }) })
    expect(h.verification).not.toHaveBeenCalled()
    expect(h.milestone).not.toHaveBeenCalled()
  })
  it.each([{ reason: "" }, { decision: "invalid" }, { id: null }])("rejects malformed review %j without writing", async (patch) => {
    expect((await PATCH(request(patch))).status).toBe(422)
    expect(h.update).not.toHaveBeenCalled()
  })
  it("rejects shared quota exhaustion before writes", async () => {
    const limited = new AppError("RATE_LIMITED")
    limited.retryAfterSeconds = 30
    h.limit.mockRejectedValueOnce(limited)
    const response = await PATCH(request())
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("30")
    expect(h.update).not.toHaveBeenCalled()
  })
})
