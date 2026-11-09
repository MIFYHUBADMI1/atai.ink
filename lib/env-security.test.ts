import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getAppUrl,
  getDeveloperPortalOrigin,
  getDeveloperPortalUrl,
  getOAuthRedirectUri,
  getPaymentEnvironment,
  getPublicSiteUrl,
} from "./env"
import { getDodoBaseUrl } from "./runtime/router/adapters/dodo/config"

afterEach(() => vi.unstubAllEnvs())
describe("security-sensitive production configuration", () => {
  it("requires an explicit production application URL even on Vercel", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "")
    vi.stubEnv("VERCEL_URL", "preview.example.com")
    expect(getAppUrl).toThrow()
  })
  it.each(["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?token=x", "https://localhost", "not-a-url", "javascript:alert(1)"])("rejects unsafe origin %s", (url) => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", url)
    expect(getAppUrl).toThrow()
  })
  it("accepts an explicit HTTPS origin", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com/")
    expect(getAppUrl()).toBe("https://example.com")
  })
  it("keeps development defaults", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "")
    vi.stubEnv("VERCEL_URL", "")
    vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", "")
    expect(getAppUrl()).toBe("http://localhost:3000")
    expect(getPaymentEnvironment()).toBe("test_mode")
  })
  it("keeps test defaults instead of requiring production secrets", () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "")
    vi.stubEnv("VERCEL_URL", "")
    vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", "")
    expect(getAppUrl()).toBe("http://localhost:3000")
    expect(getPaymentEnvironment()).toBe("test_mode")
  })
  it.each(["", "production", "LIVE_MODE"])("rejects missing or invalid production payment mode %s", (mode) => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", mode)
    expect(getPaymentEnvironment).toThrow()
  })
  it.each(["test_mode", "live_mode"])("accepts intentional mode %s", (mode) => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", mode)
    expect(getPaymentEnvironment()).toBe(mode)
  })
  it.each([
    ["https://evil.example", "an attacker-controlled origin"],
    ["https://example.com/open-redirect", "a path outside the callback"],
    ["https://example.com/?next=/admin", "a query"],
    ["http://example.com", "a non-HTTPS origin"],
  ])("rejects production OAuth override %s because it is %s", (override, reason) => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com")
    expect(() => getOAuthRedirectUri("google", override)).toThrow()
    void reason
  })
  it("pins the production OAuth callback to the canonical origin", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://atai.ink")
    expect(getOAuthRedirectUri("google", "https://atai.ink")).toBe("https://atai.ink/api/auth/google/callback")
    expect(getOAuthRedirectUri("github")).toBe("https://atai.ink/api/auth/github/callback")
  })
  it("allows a development OAuth override for tunnelled callbacks", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "")
    expect(getOAuthRedirectUri("google", "https://tunnel.example")).toBe("https://tunnel.example/api/auth/google/callback")
  })
  it("refuses a production Dodo host override that would bypass the declared environment", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", "live_mode")
    vi.stubEnv("DODO_PAYMENTS_BASE_URL", "https://test.dodopayments.com")
    expect(getDodoBaseUrl).toThrow()
    vi.stubEnv("DODO_PAYMENTS_BASE_URL", "https://live.dodopayments.com")
    expect(getDodoBaseUrl()).toBe("https://live.dodopayments.com")
    vi.stubEnv("DODO_PAYMENTS_BASE_URL", "")
    expect(getDodoBaseUrl()).toBe("https://live.dodopayments.com")
  })
})

// ---------------------------------------------------------------------------
// SEO surface regression: canonicals, og:url, JSON-LD, sitemap.xml and
// robots.txt are all built from SITE_URL. It used to equal getAppUrl(), so a
// stale NEXT_PUBLIC_APP_URL published retired hosts ("app.atai.ink",
// "mirrorsite.atai.ink", "developers.atai.ink") as the canonical location of
// every live page — crawlers were pointed at 404s, and Google sign-in broke.
// ---------------------------------------------------------------------------
describe("public origin stays pinned to one location", () => {
  it("ignores a stale or retired deployment host", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "")
    for (const stale of ["https://mirrorsite.atai.ink", "https://app.atai.ink", "https://atai-ink-git-main.vercel.app"]) {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", stale)
      expect(getPublicSiteUrl()).toBe("https://atai.ink")
    }
  })
  it("honors an intentional HTTPS override and keeps only its origin", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://staging.atai.ink/some/path")
    expect(getPublicSiteUrl()).toBe("https://staging.atai.ink")
  })
  it.each(["http://atai.ink", "not-a-url", ""])("falls back to the canonical origin for unsafe override %s", (value) => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", value)
    expect(getPublicSiteUrl()).toBe("https://atai.ink")
  })
  it("serves the developer portal from the canonical origin, never a subdomain", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://mirrorsite.atai.ink")
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "")
    vi.stubEnv("NEXT_PUBLIC_DEV_PORTAL_HOST", "")
    expect(getDeveloperPortalOrigin()).toBe("https://atai.ink")
    expect(getDeveloperPortalUrl()).toBe("https://atai.ink/developers")
  })
  it("still allows an explicit staging portal host", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_DEV_PORTAL_HOST", "developers.staging.example")
    expect(getDeveloperPortalUrl()).toBe("https://developers.staging.example")
    expect(getDeveloperPortalOrigin()).toBe("https://developers.staging.example")
  })
})
