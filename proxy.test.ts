/**
 * Proxy edge-gate regression tests (Phase 7 audit — CRITICAL finding).
 *
 * Proves the exact SDK request shape (`POST /api/runtime/v1`, no trailing
 * slash, Bearer credential, no session cookie) reaches the runtime route
 * handler instead of being rejected by the session gate, while unrelated
 * /api/* routes stay session-gated.
 */

import { describe, expect, it, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { proxy, config, PUBLIC_API_PREFIXES, referralCodeFrom } from "./proxy"

// The portal host is read lazily per proxy() call — set it for the dev-host
// tests (vitest runs with NODE_ENV=test, where no default host applies).
beforeAll(() => {
  process.env.NEXT_PUBLIC_DEV_PORTAL_HOST = "developers.atai.ink"
})

function runtimeRequest(pathname: string, opts: { apiKey?: string; sessionId?: string } = {}): NextRequest {
  const headers = new Headers()
  if (opts.apiKey) headers.set("authorization", `Bearer ${opts.apiKey}`)
  const req = new NextRequest(new URL(`https://atai.test${pathname}`), { headers })
  if (opts.sessionId) req.cookies.set("Atai_session", opts.sessionId)
  return req
}

describe("proxy — Atai Runtime invocation domain (Bearer authentication)", () => {
  it("admits the SDK's exact request: POST /api/runtime/v1 (no trailing slash), no session cookie", () => {
    // This is precisely what @atai-group/sdk sends — it must NOT be gated by the
    // session-cookie check (Phase 7 audit CRITICAL regression).
    const result = proxy(runtimeRequest("/api/runtime/v1", { apiKey: "atai_production_regtestkey12345" }))
    expect(result.headers.get("x-middleware-Next")).toBe("1")
  })

  it("admits the trailing-slash variant too", () => {
    const result = proxy(runtimeRequest("/api/runtime/v1/", { apiKey: "atai_production_regtestkey12345" }))
    expect(result.headers.get("x-middleware-Next")).toBe("1")
  })

  it("admits deeper runtime paths via the prefix list", () => {
    const result = proxy(runtimeRequest("/api/runtime/v1/anything", { apiKey: "atai_production_regtestkey12345" }))
    expect(result.headers.get("x-middleware-Next")).toBe("1")
  })

  it("does NOT admit runtime KEY-MANAGEMENT routes (session-gated by design)", () => {
    const result = proxy(runtimeRequest("/api/runtime/keys"))
    expect(result.headers.get("x-middleware-Next")).toBeNull()
    expect(result.status).toBe(401)
  })
})

describe("proxy — developer portal subdomain rewrite", () => {
  it("rewrites the bare developer host to /developers", () => {
    const req = new NextRequest(new URL("https://developers.atai.ink/"))
    const result = proxy(req)
    // Rewrites are invisible to the client; the route sees /developers.
    expect(result.headers.get("x-middleware-rewrite")).toContain("/developers")
  })

  it("rewrites deep paths onto the /developers subtree", () => {
    const req = new NextRequest(new URL("https://developers.atai.ink/keys"))
    const result = proxy(req)
    expect(result.headers.get("x-middleware-rewrite")).toContain("/developers/keys")
  })

  it("does NOT rewrite the main site host", () => {
    const req = new NextRequest(new URL("https://atai.ink/keys"))
    const result = proxy(req)
    expect(result.headers.get("x-middleware-rewrite")).toBeNull()
  })

  it("does NOT rewrite localhost by default (dev convenience — /developers reachable directly)", () => {
    const req = new NextRequest(new URL("http://localhost:3000/keys"))
    const result = proxy(req)
    expect(result.headers.get("x-middleware-rewrite")).toBeNull()
  })

  it("API calls from the portal host remain session-gated like anywhere else", () => {
    const req = new NextRequest(new URL("https://developers.atai.ink/api/projects"))
    const result = proxy(req)
    expect(result.status).toBe(401)
  })

  it("portal API calls WITH a session cookie pass through", () => {
    const req = new NextRequest(new URL("https://developers.atai.ink/api/projects"))
    req.cookies.set("Atai_session", "cookie-present")
    const result = proxy(req)
    expect(result.headers.get("x-middleware-Next")).toBe("1")
  })
})

describe("proxy — session gate still applies elsewhere", () => {
  it("rejects a cookieless request to a regular API route", () => {
    const result = proxy(runtimeRequest("/api/projects"))
    expect(result.status).toBe(401)
    expect(result.headers.get("x-middleware-Next")).toBeNull()
  })

  it("admits a request WITH a session cookie", () => {
    const result = proxy(runtimeRequest("/api/projects", { sessionId: "cookie-present" }))
    expect(result.headers.get("x-middleware-Next")).toBe("1")
  })

  it("ignores non-API paths", () => {
    const result = proxy(runtimeRequest("/some/page"))
    expect(result.headers.get("x-middleware-Next")).toBe("1")
  })

  it("public API prefixes still bypass the gate", () => {
    expect(PUBLIC_API_PREFIXES.length).toBeGreaterThan(0)
    const result = proxy(runtimeRequest("/api/auth/login"))
    expect(result.headers.get("x-middleware-Next")).toBe("1")
  })
})

describe("proxy — intentionally-anonymous public surfaces", () => {
  // These handlers are built for logged-out visitors; the edge gate must not
  // 401 them (audit: /explore rendered an empty grid for anonymous users).
  it.each([
    "/api/explore?q=shop",
    "/api/public/feedback",
    "/api/public/projects/abc",
    "/api/credit-costs",
    "/api/health",
    // Session-cap code redemption is performed by a LOGGED-OUT browser by
    // definition (that is why the cap flow triggered) — gating it on cookie
    // presence made every emailed code fail with 401 and locked founders out
    // of sign-in. The route carries its own IP + per-user attempt limits.
    "/api/auth/session-verification",
  ])("admits cookieless %s", (pathname) => {
    const result = proxy(runtimeRequest(pathname))
    expect(result.headers.get("x-middleware-Next")).toBe("1")
  })

  it("keeps /api/health/planning session-gated at the edge (operator diagnostics)", () => {
    const result = proxy(runtimeRequest("/api/health/planning"))
    expect(result.status).toBe(401)
  })
})

describe("proxy — referral attribution survives the signup journey", () => {
  // sessionStorage is scoped to the page and can be lost across the OAuth
  // redirect. The edge cookie is what keeps a Google or GitHub signup
  // attributed to the referrer.
  it("stores a valid ?ref= code in an httpOnly cookie on a page request", () => {
    const result = proxy(new NextRequest(new URL("https://atai.ink/register?ref=atai-ada")))
    expect(result.cookies.get("Atai_referral")?.value).toBe("ATAI-ADA")
  })

  it("stores the code on API requests too, so an early OAuth start still sees it", () => {
    const result = proxy(new NextRequest(new URL("https://atai.ink/api/auth/google?ref=atai-ada")))
    expect(result.cookies.get("Atai_referral")?.value).toBe("ATAI-ADA")
  })

  it("does not overwrite an existing code (first touch wins)", () => {
    const req = new NextRequest(new URL("https://atai.ink/register?ref=atai-second"))
    req.cookies.set("Atai_referral", "ATAI-FIRST")
    const result = proxy(req)
    // No Set-Cookie means the request's existing value survives untouched.
    expect(result.cookies.get("Atai_referral")).toBeUndefined()
    expect(req.cookies.get("Atai_referral")?.value).toBe("ATAI-FIRST")
  })

  it("ignores an absent or malformed ref", () => {
    expect(proxy(new NextRequest(new URL("https://atai.ink/register"))).cookies.get("Atai_referral")).toBeUndefined()
    expect(proxy(new NextRequest(new URL("https://atai.ink/register?ref=%3Cscript%3E"))).cookies.get("Atai_referral")).toBeUndefined()
    expect(referralCodeFrom(new NextRequest(new URL("https://atai.ink/?ref=")))).toBeNull()
  })

  it("normalizes case and whitespace", () => {
    expect(referralCodeFrom(new NextRequest(new URL("https://atai.ink/?ref=%20atai-ada%20")))).toBe("ATAI-ADA")
  })
})

describe("proxy — public paths that must never be session-gated", () => {
  // The matcher decides what the edge sees at all. A verification file that
  // reaches the gate is redirected to /login, and our own verifier then reads
  // the login page — a correct file reported as a token mismatch.
  const gated = new RegExp(`^${config.matcher[0]}$`)

  it("lets the domain verification file through, new name and legacy name", () => {
    expect(gated.test("/atai-verify-Ab3dEf9hIj2k.txt")).toBe(false)
    expect(gated.test("/atai-verification-legacy-token.html")).toBe(false)
  })

  it("still gates the pages and APIs a session is required for", () => {
    expect(gated.test("/project/1/business")).toBe(true)
    expect(gated.test("/settings/ai")).toBe(true)
    expect(gated.test("/api/projects/1/domains")).toBe(true)
  })

  it("still skips Next.js internals and static assets", () => {
    expect(gated.test("/_next/static/chunk.js")).toBe(false)
    expect(gated.test("/sitemap.xml")).toBe(false)
  })
})
