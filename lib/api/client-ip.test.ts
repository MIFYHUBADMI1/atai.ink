import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clientIpBucket, getVerifiedClientIp } from "./client-ip"

beforeEach(() => {
  vi.stubEnv("VERCEL", "")
  vi.stubEnv("TRUSTED_PROXY_HOPS", "")
  vi.stubEnv("NODE_ENV", "production")
})
afterEach(() => vi.unstubAllEnvs())
const request = (headers: Record<string, string> = {}) => new Request("http://localhost/api/auth/login", { headers })

describe("verified client identity", () => {
  it("never trusts arbitrary forwarded, real-IP or platform headers off-platform", () => {
    const req = request({ "x-forwarded-for": "203.0.113.1", "x-real-ip": "203.0.113.2", "x-vercel-forwarded-for": "203.0.113.3" })
    expect(getVerifiedClientIp(req)).toBeNull()
    expect(() => clientIpBucket(req)).toThrow(/temporarily unavailable/)
  })
  it("uses the platform address only on Vercel", () => {
    vi.stubEnv("VERCEL", "1")
    expect(getVerifiedClientIp(request({ "x-vercel-forwarded-for": "203.0.113.3", "x-forwarded-for": "203.0.113.1" }))).toBe("203.0.113.3")
    expect(() => clientIpBucket(request({ "x-forwarded-for": "203.0.113.1" }))).toThrow()
  })
  it("selects the client immediately outside the configured trusted hops from the right", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2")
    expect(getVerifiedClientIp(request({ "x-forwarded-for": "192.0.2.99, 203.0.113.3, 10.0.0.1" }))).toBe("203.0.113.3")
    expect(getVerifiedClientIp(request({ "x-forwarded-for": "203.0.113.3" }))).toBeNull()
  })
  it.each(["0", "-1", "2junk", "1.5", "11"])("rejects invalid proxy count %s", (hops) => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", hops)
    expect(getVerifiedClientIp(request({ "x-forwarded-for": "203.0.113.3" }))).toBeNull()
  })
  it("does not truncate away the trusted right-hand side of a long chain", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1")
    const header = Array(40).fill("192.0.2.1").concat("203.0.113.3").join(",")
    expect(getVerifiedClientIp(request({ "x-forwarded-for": header }))).toBe("203.0.113.3")
    expect(getVerifiedClientIp(request({ "x-forwarded-for": "a".repeat(2049) }))).toBeNull()
  })
  it.each(["1.2.3.999", "::::", "2001:db8:::1", "1.2.3.4:80", "[::1]junk", "1.2.3.4, 5.6.7.8"])("rejects malformed platform addresses %s", (ip) => {
    vi.stubEnv("VERCEL", "1")
    expect(getVerifiedClientIp(request({ "x-vercel-forwarded-for": ip }))).toBeNull()
  })
  it("canonicalizes equivalent IPv6 and mapped IPv4 addresses", () => {
    vi.stubEnv("VERCEL", "1")
    expect(getVerifiedClientIp(request({ "x-vercel-forwarded-for": "2001:0db8:0:0:0:0:0:1" }))).toBe("2001:db8::1")
    expect(getVerifiedClientIp(request({ "x-vercel-forwarded-for": "::ffff:192.0.2.1" }))).toBe("192.0.2.1")
  })
  it("uses the same bounded development bucket even when attackers change headers", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(clientIpBucket(request())).toBe("unverified-development")
    expect(clientIpBucket(request({ "x-forwarded-for": "203.0.113.1" }))).toBe("unverified-development")
  })
})
