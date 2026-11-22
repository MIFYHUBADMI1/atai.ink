import { describe, expect, it } from "vitest"
import {
  DomainInputError,
  assertSiteUrl,
  canonicalBusinessHost,
  hostnameOfUrl,
  isSameSiteHost,
  sameBusinessHost,
  formatHostForUrl,
  isIpLiteralHost,
  normalizeHostname,
  registrableDomainOf,
  sameHost,
} from "./host"

describe("normalizeHostname", () => {
  it("lowercases and strips scheme, path and trailing dot", () => {
    expect(normalizeHostname("HTTPS://WWW.Example.COM/some/path?q=1")).toBe("www.example.com")
    expect(normalizeHostname("example.com.")).toBe("example.com")
    expect(normalizeHostname("  shop.example.com  ")).toBe("shop.example.com")
  })

  it("accepts a bare hostname by assuming https", () => {
    expect(normalizeHostname("yourbusiness.com")).toBe("yourbusiness.com")
  })

  it("IDNA-encodes internationalized domains", () => {
    expect(normalizeHostname("https://münchen.de")).toBe("xn--mnchen-3ya.de")
    expect(normalizeHostname("例え.jp")).toBe("xn--r8jz45g.jp")
  })

  it("keeps distinct hostnames distinct — apex, www and subdomains never collapse", () => {
    const apex = normalizeHostname("example.com")
    const www = normalizeHostname("www.example.com")
    const shop = normalizeHostname("shop.example.com")
    expect(new Set([apex, www, shop]).size).toBe(3)
  })

  it("rejects empty, malformed and invalid-label input", () => {
    expect(() => normalizeHostname("")).toThrow(DomainInputError)
    expect(() => normalizeHostname("   ")).toThrow(DomainInputError)
    expect(() => normalizeHostname("not a url")).toThrow(DomainInputError)
    expect(() => normalizeHostname("under_score.example.com")).toThrow(DomainInputError)
    expect(() => normalizeHostname("-bad.example.com")).toThrow(DomainInputError)
    expect(() => normalizeHostname("bad-.example.com")).toThrow(DomainInputError)
    expect(() => normalizeHostname("localhost")).toThrow(DomainInputError) // no dot
    expect(() => normalizeHostname(`${"a".repeat(64)}.example.com`)).toThrow(DomainInputError)
    expect(() => normalizeHostname(`${"ab.".repeat(130)}com`)).toThrow(DomainInputError)
  })

  it("strips credentials at the hostname level (assertSiteUrl rejects them outright)", () => {
    expect(normalizeHostname("https://user:pass@example.com")).toBe("example.com")
  })
})

describe("assertSiteUrl", () => {
  it("parses https and http origins with default ports", () => {
    const https = assertSiteUrl("https://example.com")
    expect(https).toMatchObject({ protocol: "https:", hostname: "example.com", port: 443 })
    expect(https.homepageUrl).toBe("https://example.com/")
    const http = assertSiteUrl("http://www.example.com/path")
    expect(http).toMatchObject({ protocol: "http:", hostname: "www.example.com", port: 80 })
  })

  it("accepts explicit default ports", () => {
    expect(assertSiteUrl("https://example.com:443").port).toBe(443)
    expect(assertSiteUrl("http://example.com:80").port).toBe(80)
  })

  it("rejects non-web schemes", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com", "data:text/html,hi", "javascript:alert(1)", "gopher://example.com"]) {
      expect(() => assertSiteUrl(url)).toThrow(DomainInputError)
    }
  })

  it("rejects URL credentials", () => {
    expect(() => assertSiteUrl("https://user:pass@example.com")).toThrow(/username or password/i)
    expect(() => assertSiteUrl("https://user@example.com")).toThrow(DomainInputError)
  })

  it("rejects arbitrary ports", () => {
    for (const url of ["https://example.com:8443", "http://example.com:8080", "http://example.com:22", "https://example.com:4430"]) {
      expect(() => assertSiteUrl(url)).toThrow(/ports/i)
    }
    // A port that does not match its scheme is also rejected.
    expect(() => assertSiteUrl("http://example.com:443")).toThrow(DomainInputError)
    expect(() => assertSiteUrl("https://example.com:80")).toThrow(DomainInputError)
  })

  it("rejects malformed and empty input", () => {
    expect(() => assertSiteUrl("")).toThrow(DomainInputError)
    expect(() => assertSiteUrl("http://")).toThrow(DomainInputError)
    expect(() => assertSiteUrl("https://exa mple.com")).toThrow(DomainInputError)
  })

  it("preserves the exact hostname being verified, including subdomains", () => {
    expect(assertSiteUrl("https://shop.example.com").hostname).toBe("shop.example.com")
    expect(assertSiteUrl("https://shop.example.com").registrableDomain).toBe("example.com")
  })
})

describe("registrableDomainOf (display only)", () => {
  it("groups subdomains under the registrable domain", () => {
    expect(registrableDomainOf("example.com")).toBe("example.com")
    expect(registrableDomainOf("www.example.com")).toBe("example.com")
    expect(registrableDomainOf("a.b.shop.example.com")).toBe("example.com")
  })

  it("handles known second-level suffixes", () => {
    expect(registrableDomainOf("shop.example.co.uk")).toBe("example.co.uk")
    expect(registrableDomainOf("example.co.uk")).toBe("example.co.uk")
    expect(registrableDomainOf("www.example.com.au")).toBe("example.com.au")
  })

  it("passes IP literals through untouched", () => {
    expect(registrableDomainOf("93.184.216.34")).toBe("93.184.216.34")
  })
})

describe("helpers", () => {
  it("isIpLiteralHost recognizes v4 and v6 literals only", () => {
    expect(isIpLiteralHost("93.184.216.34")).toBe(true)
    expect(isIpLiteralHost("2606:2800:220:1:248:1893:25c8:1946")).toBe(true)
    expect(isIpLiteralHost("example.com")).toBe(false)
  })

  it("formatHostForUrl re-brackets IPv6", () => {
    expect(formatHostForUrl("::1")).toBe("[::1]")
    expect(formatHostForUrl("example.com")).toBe("example.com")
  })

  it("sameHost is case-insensitive and rejects garbage", () => {
    expect(sameHost("WWW.Example.com", "www.example.com")).toBe(true)
    expect(sameHost("example.com", "shop.example.com")).toBe(false)
    expect(sameHost("example.com", "")).toBe(false)
  })
})

describe("canonicalBusinessHost", () => {
  it("treats www and the apex as one business", () => {
    expect(canonicalBusinessHost("www.example.com")).toBe("example.com")
    expect(canonicalBusinessHost("example.com")).toBe("example.com")
    expect(sameBusinessHost("https://www.example.com", "https://example.com")).toBe(true)
    expect(canonicalBusinessHost("WWW.Example.COM")).toBe("example.com")
  })

  it("keeps multi-label public suffixes intact", () => {
    expect(canonicalBusinessHost("www.example.co.uk")).toBe("example.co.uk")
    expect(canonicalBusinessHost("www.co.uk")).toBe("www.co.uk")
    expect(canonicalBusinessHost("co.uk")).toBe("co.uk")
  })

  it("keeps subdomains distinct from the apex", () => {
    expect(canonicalBusinessHost("shop.example.com")).toBe("shop.example.com")
    expect(sameBusinessHost("shop.example.com", "example.com")).toBe(false)
  })

  it("leaves IP literals alone", () => {
    expect(canonicalBusinessHost("192.168.0.1")).toBe("192.168.0.1")
    expect(canonicalBusinessHost("[::1]")).toContain("::1")
    expect(canonicalBusinessHost("[::1]")).not.toBe("")
  })

  it("punycodes IDN hosts the same way verification does", () => {
    expect(canonicalBusinessHost("www.例え.jp")).toBe(canonicalBusinessHost("例え.jp"))
    expect(canonicalBusinessHost("www.例え.jp")).toBe("xn--r8jz45g.jp")
  })

  it("never throws on junk, so a conflict check cannot fail the request", () => {
    expect(typeof canonicalBusinessHost("not a host")).toBe("string")
    expect(canonicalBusinessHost("")).toBe("")
    expect(sameBusinessHost("", "example.com")).toBe(false)
  })
})

describe("isSameSiteHost — is this the business we read?", () => {
  it("treats apex and www as one site", () => {
    expect(isSameSiteHost("example.com", "www.example.com")).toBe(true)
    expect(isSameSiteHost("WWW.Example.COM", "example.com")).toBe(true)
  })

  it("treats sibling subdomains as one site", () => {
    expect(isSameSiteHost("shop.example.com", "example.com")).toBe(true)
    expect(isSameSiteHost("app.example.co.uk", "www.example.co.uk")).toBe(true)
  })

  it("never unifies two tenants of a shared host", () => {
    expect(isSameSiteHost("study-iota-lime.vercel.app", "other-project.vercel.app")).toBe(false)
    expect(isSameSiteHost("my-shop.myshopify.com", "my-shop.myshopify.com")).toBe(true)
  })

  it("keeps different registrable domains apart", () => {
    expect(isSameSiteHost("example.com", "example.net")).toBe(false)
    expect(isSameSiteHost("example.com", "notexample.com")).toBe(false)
  })

  it("never unifies IP literals or junk", () => {
    expect(isSameSiteHost("93.184.216.34", "93.184.216.34")).toBe(true)
    expect(isSameSiteHost("93.184.216.34", "93.184.216.35")).toBe(false)
    expect(isSameSiteHost("", "example.com")).toBe(false)
    expect(isSameSiteHost("not a host", "example.com")).toBe(false)
  })
})

describe("hostnameOfUrl — reading a stored address", () => {
  it("takes the host from a full URL, a bare host, or a URL with a path", () => {
    expect(hostnameOfUrl("https://Example.com/about?x=1")).toBe("example.com")
    expect(hostnameOfUrl("example.com")).toBe("example.com")
    expect(hostnameOfUrl("  https://www.example.com  ")).toBe("www.example.com")
  })

  it("returns undefined for nothing we could verify", () => {
    expect(hostnameOfUrl("")).toBeUndefined()
    expect(hostnameOfUrl(undefined)).toBeUndefined()
    expect(hostnameOfUrl("not a host")).toBeUndefined()
  })
})
