import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  ingress: vi.fn(), accountLimit: vi.fn(), findUser: vi.fn(), verify: vi.fn(), dummy: vi.fn(),
  createUser: vi.fn(), session: vi.fn(), setCookie: vi.fn(), hash: vi.fn(), verification: vi.fn(),
  claim: vi.fn(), markVerified: vi.fn(), updateUser: vi.fn(), requireUser: vi.fn(), setPassword: vi.fn(), revoke: vi.fn(),
}))
vi.mock("@/lib/auth/request-limit", () => ({ checkAuthRequest: mocks.ingress }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: mocks.accountLimit }))
vi.mock("@/lib/auth/users", () => ({
  findUserByEmail: mocks.findUser, normalizeEmail: (s: string) => s.toLowerCase(),
  toPublicUser: (u: unknown) => u, touchLastLogin: vi.fn(), createPasswordUser: mocks.createUser,
  markEmailVerified: mocks.markVerified, setPasswordHash: mocks.setPassword,
}))
vi.mock("@/lib/auth/crypto", () => ({
  verifyPassword: mocks.verify, verifyPasswordWithoutUser: mocks.dummy, hashPassword: mocks.hash,
  hashToken: (s: string) => `hash:${s}`, generateToken: () => "a".repeat(43), isPasswordStrongEnough: (s: string) => s.length >= 8,
}))
vi.mock("@/lib/auth/session", () => ({
  createSession: mocks.session, setSessionCookie: mocks.setCookie, requireUser: mocks.requireUser, destroyAllSessionsForUser: mocks.revoke,
}))
vi.mock("@/lib/auth/verification", () => ({ issueAndSendVerificationEmail: mocks.verification }))
vi.mock("@/lib/referrals/referrals", () => ({ captureReferral: vi.fn(), processVerificationReward: vi.fn(async () => false) }))
vi.mock("@/lib/logging/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock("@/lib/db/collections", () => ({
  verificationTokensCol: async () => ({ findOneAndUpdate: mocks.claim, deleteMany: vi.fn(), insertOne: vi.fn() }),
  usersCol: async () => ({ findOne: mocks.findUser, updateOne: mocks.updateUser }), ensureIndexes: vi.fn(),
}))
vi.mock("@/lib/env", () => ({
  getAppUrl: () => "http://localhost",
  getPublicBaseUrl: () => "http://localhost",
  isSmtpConfigured: () => false,
}))
vi.mock("@/lib/email/mailer", () => ({ sendMail: vi.fn() }))

import { POST as login } from "@/app/api/auth/login/route"
import { POST as register } from "@/app/api/auth/register/route"
import { POST as verifyEmail } from "@/app/api/auth/verify-email/route"
import { POST as confirmEmail } from "@/app/api/auth/confirm-email-change/route"
import { POST as changePassword } from "@/app/api/auth/change-password/route"
import { POST as changeEmail } from "@/app/api/auth/change-email/route"
import { POST as resend } from "@/app/api/auth/resend-verification/route"
import { AppError } from "@/lib/errors"

const request = (body: unknown) => new Request("http://localhost/api/auth/test", { method: "POST", body: JSON.stringify(body) })
const credentials = { email: "user@example.com", name: "User", password: "password123" }
const user = { id: "u1", email: "user@example.com", passwordHash: "hash", authProvider: "password", emailVerified: false }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.findUser.mockResolvedValue(user)
  mocks.requireUser.mockResolvedValue(user)
  mocks.createUser.mockResolvedValue(user)
  mocks.verify.mockResolvedValue(true)
  mocks.session.mockResolvedValue("session")
  mocks.verification.mockResolvedValue({ sent: true })
  mocks.hash.mockResolvedValue("password-hash")
  mocks.setPassword.mockResolvedValue(true)
})

describe("auth ingress ordering", () => {
  it.each([
    ["login", login], ["register", register], ["verify_email", verifyEmail],
    ["confirm_email_change", confirmEmail], ["change_password", changePassword],
    ["change_email", changeEmail], ["resend_verification", resend],
  ] as const)("limits %s before reading input or querying accounts", async (action, handler) => {
    mocks.ingress.mockRejectedValueOnce(new AppError("RATE_LIMITED"))
    const req = request(credentials)
    expect((await handler(req)).status).toBe(429)
    expect(mocks.ingress).toHaveBeenCalledWith(req, action)
    expect(req.bodyUsed).toBe(false)
    expect(mocks.findUser).not.toHaveBeenCalled()
    expect(mocks.requireUser).not.toHaveBeenCalled()
    expect(mocks.claim).not.toHaveBeenCalled()
  })
  it.each([null, [], { email: 9 }, { email: "a".repeat(255), password: "password123" }])("login rejects malformed fields %# without bcrypt", async (body) => {
    expect((await login(request(body))).status).toBe(422)
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.dummy).not.toHaveBeenCalled()
  })
})

describe("login privacy and normal behavior", () => {
  it.each([null, { ...user, passwordHash: null }])("uses dummy verification when no usable password exists %#", async (account) => {
    mocks.findUser.mockResolvedValue(account)
    const response = await login(request(credentials))
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe("AUTHENTICATION_FAILED")
    expect(mocks.dummy).toHaveBeenCalledWith(credentials.password)
  })
  it("does not disclose a ban before verifying the password", async () => {
    mocks.findUser.mockResolvedValue({ ...user, banned: true })
    mocks.verify.mockResolvedValue(false)
    const response = await login(request(credentials))
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe("AUTHENTICATION_FAILED")
    expect(mocks.session).not.toHaveBeenCalled()
  })
  it("issues a session for valid credentials and retains account limits", async () => {
    expect((await login(request(credentials))).status).toBe(200)
    expect(mocks.accountLimit).toHaveBeenCalledWith(expect.objectContaining({ action: "login", limit: 10 }))
    expect(mocks.setCookie).toHaveBeenCalledWith("session")
  })
})

describe("registration contract", () => {
  it("preserves existing 409 semantics rather than falsely claiming registration privacy", async () => {
    const response = await register(request(credentials))
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe("EMAIL_ALREADY_REGISTERED")
    expect(mocks.createUser).not.toHaveBeenCalled()
  })
  it("preserves verification and immediate sign-in for new accounts", async () => {
    mocks.findUser.mockResolvedValue(null)
    expect((await register(request(credentials))).status).toBe(201)
    expect(mocks.verification).toHaveBeenCalledWith(user.id, user.email, undefined)
    expect(mocks.setCookie).toHaveBeenCalledWith("session")
  })
})

describe("email token expiration", () => {
  it.each([["email_verify", verifyEmail], ["email_change", confirmEmail]] as const)("checks expiration in the %s claim, not only via TTL cleanup", async (purpose, handler) => {
    mocks.claim.mockResolvedValue(null)
    expect((await handler(request({ token: "a".repeat(43) }))).status).toBe(400)
    expect(mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({ purpose, expiresAt: { $gt: expect.any(Date) }, usedAt: { $exists: false } }),
      expect.any(Object), expect.any(Object),
    )
  })
  it("keeps valid email verification working", async () => {
    mocks.claim.mockResolvedValue({ userId: user.id })
    expect((await verifyEmail(request({ token: "a".repeat(43) }))).status).toBe(200)
    expect(mocks.markVerified).toHaveBeenCalledWith(user.id)
  })
})
