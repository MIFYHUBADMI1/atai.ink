/**
 * Bug condition exploration tests for setSessionCookie.
 *
 * Property 1: Bug Condition — HTTP Origin Cookie Secure Flag
 *
 * These tests encode the EXPECTED behavior (HTTP origin → secure: false).
 * On UNFIXED code they will FAIL because secure is hardcoded to `true`.
 * That failure is intentional — it confirms the bug exists.
 * After the fix is applied (task 3), these same tests will PASS.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fc from "fast-check"

// `lib/auth/session.ts` reaches `credit-service` through the collections
// module graph, and that module guards itself with the `server-only` phantom
// dependency (never installed, so a plain Node import fails). Every test in
// this repo stubs it; this file was missing the stub and could not load.
vi.mock("server-only", () => ({}))

// ---------------------------------------------------------------------------
// Hoist the mock factories so vi.mock can close over them
// ---------------------------------------------------------------------------
const { mockCookiesSet, mockCookiesDelete, mockHeaderGet } = vi.hoisted(() => ({
  mockCookiesSet: vi.fn(),
  mockCookiesDelete: vi.fn(),
  mockHeaderGet: vi.fn(() => null as string | null),
}))

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: mockCookiesSet,
    get: vi.fn(),
    delete: mockCookiesDelete,
  })),
  headers: vi.fn(async () => ({ get: mockHeaderGet })),
}))

// ---------------------------------------------------------------------------
// Import the module AFTER mocking so the mock is in place
// ---------------------------------------------------------------------------
import { setSessionCookie, clearSessionCookie } from "../session"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function capturedOptions(): Record<string, unknown> {
  const call = mockCookiesSet.mock.calls[0]
  return (call?.[2] as Record<string, unknown>) ?? {}
}

function capturedSecureOption(): boolean | undefined {
  return capturedOptions().secure as boolean | undefined
}

/** Pretend the request arrived from a given host / forwarded protocol. */
function requestFrom(opts: { host?: string; proto?: string | null } = {}) {
  mockHeaderGet.mockImplementation((name: string) => {
    if (name === "host") return opts.host ?? "localhost:3000"
    if (name === "x-forwarded-proto") return opts.proto ?? null
    return null
  })
}

function restoreHeaderMock() {
  mockHeaderGet.mockReset()
  mockHeaderGet.mockImplementation(() => null)
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("setSessionCookie — Bug Condition: HTTP origin secure flag", () => {
  const originalEnv = process.env.NEXT_PUBLIC_APP_URL

  afterEach(() => {
    mockCookiesSet.mockClear()
    mockCookiesDelete.mockClear()
    restoreHeaderMock()
    // Restore env after each test
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalEnv
    }
  })

  // -------------------------------------------------------------------------
  // Test case 1: explicit HTTP localhost URL
  // -------------------------------------------------------------------------
  it("TC-1: sets secure: false when NEXT_PUBLIC_APP_URL is http://localhost:3000", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000"

    await setSessionCookie("test-token")

    const secure = capturedSecureOption()
    // EXPECTED on fixed code: false
    // ACTUAL on unfixed code: true  ← BUG COUNTEREXAMPLE
    expect(secure).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Test case 2: NEXT_PUBLIC_APP_URL is not set at all
  // -------------------------------------------------------------------------
  it("TC-2: sets secure: false when NEXT_PUBLIC_APP_URL is undefined", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL

    await setSessionCookie("test-token")

    const secure = capturedSecureOption()
    // EXPECTED on fixed code: false
    // ACTUAL on unfixed code: true  ← BUG COUNTEREXAMPLE
    expect(secure).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Test case 3: NEXT_PUBLIC_APP_URL is an empty string
  // -------------------------------------------------------------------------
  it("TC-3: sets secure: false when NEXT_PUBLIC_APP_URL is empty string", async () => {
    process.env.NEXT_PUBLIC_APP_URL = ""

    await setSessionCookie("test-token")

    const secure = capturedSecureOption()
    // EXPECTED on fixed code: false
    // ACTUAL on unfixed code: true  ← BUG COUNTEREXAMPLE
    expect(secure).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Property test: for ANY non-https URL, secure must be false
  // Uses fast-check to generate many HTTP-scheme and non-https URL variants.
  // Validates: Requirements 1.1, 1.2, 1.3, 1.4
  // -------------------------------------------------------------------------
  it("PBT: secure is false for any NEXT_PUBLIC_APP_URL that does not start with https://", async () => {
    // Arbitraries that produce non-https URLs (the full set of HTTP-origin cases)
    const httpUrlArb = fc.oneof(
      // Plain http:// URLs
      fc
        .domain()
        .map((d) => `http://${d}`),
      // localhost variants
      fc.integer({ min: 1024, max: 65535 }).map((p) => `http://localhost:${p}`),
      // Empty / missing env
      fc.constant(""),
      fc.constant("http://localhost:3000"),
      fc.constant("http://127.0.0.1:3000"),
    )

    await fc.assert(
      fc.asyncProperty(httpUrlArb, async (appUrl) => {
        mockCookiesSet.mockClear()
        process.env.NEXT_PUBLIC_APP_URL = appUrl

        await setSessionCookie("tok")

        const secure = capturedSecureOption()
        // All non-https origins must produce secure: false on fixed code.
        // On UNFIXED code this property fails with the first counterexample
        // where secure === true (i.e. every case).
        return secure === false
      }),
      { numRuns: 50 },
    )
  })
})

// ---------------------------------------------------------------------------
// Phase 3 regression: the cookie must describe the REQUEST, not the canonical
// URL. `.env.local` legitimately points NEXT_PUBLIC_APP_URL at production
// while the developer is on http://localhost:3000; keying the attributes off
// that variable emitted `Domain=.atai.ink` on a localhost response, every
// browser dropped it, `/api/me` 401'd, and the UI reported "We signed you in,
// but couldn't load your session."
// ---------------------------------------------------------------------------
describe("setSessionCookie — scope follows the request origin", () => {
  const originalEnv = process.env.NEXT_PUBLIC_APP_URL

  beforeEach(() => {
    mockCookiesSet.mockClear()
    mockCookiesDelete.mockClear()
    restoreHeaderMock()
    // The exact local configuration that produced the reported bug.
    process.env.NEXT_PUBLIC_APP_URL = "https://atai.ink"
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_APP_URL
    else process.env.NEXT_PUBLIC_APP_URL = originalEnv
    mockCookiesSet.mockClear()
    mockCookiesDelete.mockClear()
    restoreHeaderMock()
  })

  it("localhost + production canonical URL ⇒ host-only, non-secure cookie", async () => {
    requestFrom({ host: "localhost:3000" })

    await setSessionCookie("tok")

    const options = capturedOptions()
    // A Domain of .atai.ink on a localhost response is dropped by the browser.
    expect(options.domain).toBeUndefined()
    expect(options.secure).toBe(false)
    // Everything else is unchanged.
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe("lax")
    expect(options.path).toBe("/")
    expect(options.maxAge).toBe(30 * 24 * 60 * 60)
  })

  it("127.0.0.1 is local too", async () => {
    requestFrom({ host: "127.0.0.1:3000" })
    await setSessionCookie("tok")
    expect(capturedOptions()).toMatchObject({ domain: undefined, secure: false })
  })

  it("a real atai.ink request keeps the shared parent domain and Secure", async () => {
    requestFrom({ host: "mirrorsite.atai.ink", proto: "https" })
    await setSessionCookie("tok")
    expect(capturedOptions()).toMatchObject({ domain: ".atai.ink", secure: true })
  })

  it("the developer portal subdomain also gets the shared domain", async () => {
    requestFrom({ host: "developers.atai.ink", proto: "https" })
    await setSessionCookie("tok")
    expect(capturedOptions()).toMatchObject({ domain: ".atai.ink", secure: true })
  })

  it("a vercel.app preview host stays host-only", async () => {
    requestFrom({ host: "mirrorsite-git-main-atai.vercel.app", proto: "https" })
    await setSessionCookie("tok")
    const options = capturedOptions()
    expect(options.domain).toBeUndefined()
    // Never downgraded: an https connection is always Secure, even when the
    // canonical-URL comparison could not have told us.
    expect(options.secure).toBe(true)
  })

  it("x-forwarded-proto decides https even without a canonical match", async () => {
    requestFrom({ host: "app.example.com", proto: "https" })
    await setSessionCookie("tok")
    expect(capturedOptions().secure).toBe(true)
  })

  it("an http forwarded proto is never upgraded to Secure", async () => {
    requestFrom({ host: "intranet.example.com", proto: "http" })
    await setSessionCookie("tok")
    expect(capturedOptions().secure).toBe(false)
  })

  it("no request context falls back to the canonical posture, never a wider domain", async () => {
    // headers() yields nothing (script/job context).
    mockHeaderGet.mockImplementation(() => null)
    await setSessionCookie("tok")
    const options = capturedOptions()
    expect(options.domain).toBeUndefined()
    expect(options.secure).toBe(true) // canonical is https ⇒ no silent downgrade
  })

  it("clearSessionCookie deletes with the SAME domain it set", async () => {
    // ResponseCookies.delete takes ONE options object in this Next version —
    // passing (name, options) would silently no-op the domain-scoped delete.
    requestFrom({ host: "mirrorsite.atai.ink", proto: "https" })
    await clearSessionCookie()
    expect(mockCookiesDelete).toHaveBeenCalledWith({ name: "Atai_session", path: "/", domain: ".atai.ink" })

    mockCookiesDelete.mockClear()
    requestFrom({ host: "localhost:3000" })
    await clearSessionCookie()
    expect(mockCookiesDelete).toHaveBeenCalledWith({ name: "Atai_session", path: "/", domain: undefined })
  })
})
