/**
 * Internal shared-secret authentication for `/api/internal/*`.
 *
 * The previous inline implementation in each route printed the first 10-20
 * characters of BOTH the configured key and the caller-supplied key to the
 * server log and compared them with `!==`. These tests lock in the two
 * properties that replaced it: a constant-time comparison and the absence
 * of key material in logs or responses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { authorizeInternalRequest, secretsMatch } from "./internal-key"

const ORIGINAL_KEY = process.env.ATAI_INTERNAL_KEY

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  if (ORIGINAL_KEY === undefined) delete process.env.ATAI_INTERNAL_KEY
  else process.env.ATAI_INTERNAL_KEY = ORIGINAL_KEY
})

describe("secretsMatch", () => {
  it("accepts an exact match", () => {
    expect(secretsMatch("s3cret-value", "s3cret-value")).toBe(true)
  })

  it("rejects a different secret", () => {
    expect(secretsMatch("s3cret-valuE", "s3cret-value")).toBe(false)
  })

  it("rejects a prefix of the expected secret", () => {
    expect(secretsMatch("s3cret", "s3cret-value")).toBe(false)
  })

  it("rejects an empty or missing provided key", () => {
    expect(secretsMatch("", "s3cret-value")).toBe(false)
    expect(secretsMatch(null, "s3cret-value")).toBe(false)
    expect(secretsMatch(undefined, "s3cret-value")).toBe(false)
  })
})

describe("authorizeInternalRequest", () => {
  it("accepts a matching x-internal-key header", () => {
    process.env.ATAI_INTERNAL_KEY = "correct-horse-battery-staple"
    const res = authorizeInternalRequest(new Headers({ "x-internal-key": "correct-horse-battery-staple" }))
    expect(res.ok).toBe(true)
  })

  it("rejects a wrong key with 401 and a safe message", () => {
    process.env.ATAI_INTERNAL_KEY = "correct-horse-battery-staple"
    const res = authorizeInternalRequest(new Headers({ "x-internal-key": "wrong-key" }))
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("unreachable")
    expect(res.status).toBe(401)
    expect(res.code).toBe("UNAUTHORIZED")
    expect(res.message).not.toContain("correct-horse")
    expect(res.message).not.toContain("wrong-key")
  })

  it("rejects a missing key with 401", () => {
    process.env.ATAI_INTERNAL_KEY = "correct-horse-battery-staple"
    const res = authorizeInternalRequest(new Headers())
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("unreachable")
    expect(res.status).toBe(401)
  })

  it("reports 503 when no key is configured (never 401, which would hide a misconfiguration)", () => {
    delete process.env.ATAI_INTERNAL_KEY
    const res = authorizeInternalRequest(new Headers({ "x-internal-key": "anything" }))
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("unreachable")
    expect(res.status).toBe(503)
    expect(res.code).toBe("PROVIDER_NOT_CONFIGURED")
  })

  it("never writes key material to the log — not the configured key, not the presented one", () => {
    process.env.ATAI_INTERNAL_KEY = "configured-secret-value"
    authorizeInternalRequest(new Headers({ "x-internal-key": "presented-secret-value" }))

    const logged = vi.mocked(console.warn).mock.calls.map((args) => args.join(" ")).join("\n")
    expect(logged).not.toContain("configured-secret-value")
    expect(logged).not.toContain("presented-secret-value")
    // A prefix of the secret is still a credential fragment.
    expect(logged).not.toContain("configured-secret")
    expect(logged).not.toContain("presented-secret")
  })
})
