/**
 * Hostname normalization for domain ownership verification.
 *
 * SECURITY INVARIANT: the verification target is always the EXACT hostname the
 * founder submitted. `registrableDomain` is a display/grouping convenience and
 * must never be used to decide whether something is verified — verifying
 * `example.com` never verifies `shop.example.com`.
 */

export const MAX_HOSTNAME_LENGTH = 253
export const MAX_LABEL_LENGTH = 63

/** Second-level public suffixes we know about. This list exists so that
 * "example.co.uk" displays as belonging to "example.co.uk" rather than
 * "co.uk". It is deliberately NOT a security boundary and it is not a full
 * public suffix list: an unknown suffix only makes the display grouping
 * coarser (it falls back to the last two labels), never weaker. */
const KNOWN_SECOND_LEVEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "net.nz", "org.nz", "govt.nz",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp",
  "com.br", "net.br", "org.br", "gov.br",
  "com.mx", "org.mx", "gob.mx",
  "co.za", "org.za", "net.za", "gov.za",
  "com.sg", "edu.sg", "gov.sg", "net.sg", "org.sg",
  "com.hk", "org.hk", "gov.hk", "idv.hk",
  "co.in", "net.in", "org.in", "gov.in", "ac.in",
  "com.tr", "org.tr", "gov.tr", "net.tr",
  "com.ar", "net.ar", "org.ar", "gob.ar",
  "com.pe", "gob.pe", "net.pe", "org.pe",
  "co.kr", "or.kr", "ne.kr", "go.kr", "re.kr",
  "com.ua", "in.ua", "gov.ua",
  "com.pl", "net.pl", "org.pl", "gov.pl",
  "co.il", "org.il", "net.il", "gov.il", "muni.il",
  "com.eg", "net.eg", "org.eg",
  "com.sa", "edu.sa", "gov.sa", "com.pk", "edu.pk", "gov.pk",
  "com.my", "net.my", "org.my", "gov.my",
  "com.ph", "net.ph", "org.ph", "gov.ph",
  "com.vn", "net.vn", "org.vn", "gov.vn",
  "com.ng", "org.ng", "gov.ng", "com.gh", "org.gh", "gov.gh",
  "com.bd", "edu.bd", "gov.bd", "com.tw", "org.tw", "gov.tw",
  "co.id", "web.id", "or.id", "go.id",
])

export class DomainInputError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "DomainInputError"
    this.code = code
  }
}

/**
 * Turn anything the founder typed into a lowercase, IDNA-punycoded hostname.
 * `new URL()` does the heavy lifting: it lowercases, applies IDNA (so
 * `例え.jp` becomes `xn--r8jz45g.jp`), drops the default port, and rejects
 * malformed authorities. Credentials are stripped deliberately here so a
 * `user:pass@host` string can never reach the SSRF guard looking harmless —
 * the URL parser in `assertSiteUrl` rejects them outright.
 */
export function normalizeHostname(raw: string): string {
  const value = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "")
  if (!value) throw new DomainInputError("DOMAIN_EMPTY", "Enter a website address.")

  let candidate = value
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new DomainInputError("DOMAIN_INVALID", "That does not look like a website address.")
  }

  let host = url.hostname
  if (!host) throw new DomainInputError("DOMAIN_INVALID", "That does not look like a website address.")

  // Bracketed IPv6 keeps its brackets in URL#hostname; they are part of the
  // literal for our purposes, so strip them and re-add at connect time.
  const v6 = host.match(/^\[(.*)\]$/)
  if (v6) host = v6[1]

  host = host.replace(/\.$/, "")
  if (!host) throw new DomainInputError("DOMAIN_INVALID", "That does not look like a website address.")
  if (host.length > MAX_HOSTNAME_LENGTH) throw new DomainInputError("DOMAIN_TOO_LONG", "That website address is too long.")

  for (const label of host.split(".")) {
    if (!label || label.length > MAX_LABEL_LENGTH) {
      throw new DomainInputError("DOMAIN_INVALID", "That website address has an invalid label.")
    }
    // `URL#hostname` is already lowercased and IDNA-punycoded, so a valid
    // label here is ASCII letters, digits and hyphens. Anything else (path
    // separators, controls, spaces, underscores) is rejected before a socket
    // is opened.
    if (!/^[a-z0-9-]+$/.test(label)) {
      throw new DomainInputError("DOMAIN_INVALID", "That website address has an invalid character.")
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      throw new DomainInputError("DOMAIN_INVALID", "That website address has a label that starts or ends with a hyphen.")
    }
  }
  if (!host.includes(".")) throw new DomainInputError("DOMAIN_NO_DOT", "Enter a full website address, like yourbusiness.com.")
  return host
}

/** Is the normalized hostname a raw IP literal rather than a domain name? */
export function isIpLiteralHost(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true
  return hostname.includes(":")
}

/**
 * Display grouping only — see the file header. Never trust this for
 * authorization, uniqueness, or a verification decision.
 */
export function registrableDomainOf(hostname: string): string {
  if (isIpLiteralHost(hostname)) return hostname
  const labels = hostname.split(".")
  if (labels.length <= 2) return hostname
  const lastTwo = labels.slice(-2).join(".")
  if (KNOWN_SECOND_LEVEL_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".")
  }
  return lastTwo
}

/** `true` when the host is a bare public suffix (`com`, `co.uk`) — such a host
 * can never be a business on its own, so `www.` in front of it is not an alias. */
function isPublicSuffixOnly(host: string): boolean {
  const labels = host.split(".")
  if (labels.length === 1) return true
  return labels.length === 2 && KNOWN_SECOND_LEVEL_SUFFIXES.has(host)
}

/**
 * Hosting platforms where every subdomain is a different business.
 *
 * `registrableDomainOf` groups by the last two labels, which is right for
 * `shop.example.com` and `example.com`, and wrong for `a.vercel.app` and
 * `b.vercel.app` — those are two unrelated sites on a shared platform. Callers
 * that are about to treat two hosts as "the same site" must ask this first.
 */
const SHARED_HOSTING_SUFFIXES: readonly string[] = [
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "web.app",
  "firebaseapp.com",
  "github.io",
  "gitlab.io",
  "herokuapp.com",
  "onrender.com",
  "fly.dev",
  "railway.app",
  "replit.app",
  "repl.co",
  "glitch.me",
  "webflow.io",
  "wixsite.com",
  "blogspot.com",
  "wordpress.com",
  "myshopify.com",
  "squarespace.com",
  "notion.site",
  "substack.com",
  "medium.com",
  "tumblr.com",
  "weebly.com",
  "carrd.co",
  "framer.app",
  "surge.sh",
  "now.sh",
  "azurewebsites.net",
  "cloudfront.net",
  "appspot.com",
  "run.app",
  "deno.dev",
  "val.town",
  "bubbleapps.io",
  "softr.app",
]

/** `true` when the hostname lives on a platform where a sibling subdomain is a
 * different business, not the same site. */
export function isSharedHostingHost(hostname: string): boolean {
  const host = (hostname ?? "").trim().toLowerCase().replace(/\.$/, "")
  if (!host) return false
  return SHARED_HOSTING_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

/**
 * The key that decides "this is the same business", used ONLY for uniqueness and
 * conflict checks. It is deliberately NOT a verification target: a challenge is
 * always verified against the exact hostname the founder submitted (see the file
 * header), so collapsing `www.example.com` to `example.com` here can never let
 * one site's tag verify another site.
 *
 * Rules: `www.example.com` and `example.com` are one business; subdomains
 * (`shop.example.com`) stay distinct; IP literals are left alone; `www.co.uk`
 * keeps its `www.` because `co.uk` is a public suffix, not a business.
 */
export function canonicalBusinessHost(hostname: string): string {
  let host: string
  try {
    host = normalizeHostname(hostname)
  } catch {
    return (hostname ?? "").trim().toLowerCase()
  }
  if (isIpLiteralHost(host)) return host
  if (!host.startsWith("www.")) return host
  const remainder = host.slice("www.".length)
  if (!remainder.includes(".") || isPublicSuffixOnly(remainder)) return host
  return remainder
}

/** Do two hostnames point at the same business, ignoring a safe `www.` alias? */
export function sameBusinessHost(a: string, b: string): boolean {
  return canonicalBusinessHost(a) === canonicalBusinessHost(b)
}

/**
 * Are these two hostnames one site, so a proof of one is a fact about the
 * other's business? Apex↔www and sibling subdomains qualify; a shared hosting
 * platform never does, because every customer there owns only their own
 * subdomain. IP literals are never the same site — they have no registrable
 * domain to share.
 *
 * This answers "is this the business we read?", never "is this verified?".
 */
export function isSameSiteHost(a: string, b: string): boolean {
  let left: string
  let right: string
  try {
    left = normalizeHostname(a)
    right = normalizeHostname(b)
  } catch {
    return false
  }
  if (!left || !right) return false
  if (left === right) return true
  if (isIpLiteralHost(left) || isIpLiteralHost(right)) return false
  if (isSharedHostingHost(left) || isSharedHostingHost(right)) return false
  return registrableDomainOf(left) === registrableDomainOf(right)
}

/** The hostname of an address we stored earlier, or `undefined` when it is not
 * one we can read. Used to ask "is this claim the site the co-founder read?" */
export function hostnameOfUrl(raw: string | null | undefined): string | undefined {
  const value = (raw ?? "").trim()
  if (!value) return undefined
  try {
    return normalizeHostname(new URL(value.includes("://") ? value : `https://${value}`).hostname)
  } catch {
    return undefined
  }
}

/**
 * Parse a submitted website address into the exact origin we will verify.
 * Only http/https, no credentials, no path/query, and only the default web
 * ports — anything else is rejected before a socket is ever opened.
 */
export interface SiteTarget {
  protocol: "http:" | "https:"
  hostname: string
  port: number
  /** Registrable domain for display; never a security input. */
  registrableDomain: string
  /** Canonical homepage URL for the meta-tag check. */
  homepageUrl: string
}

export function assertSiteUrl(raw: string): SiteTarget {
  const value = (raw ?? "").trim()
  if (!value) throw new DomainInputError("DOMAIN_EMPTY", "Enter a website address.")

  let candidate = value
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new DomainInputError("DOMAIN_INVALID", "That does not look like a website address.")
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DomainInputError("DOMAIN_SCHEME", "Only http and https website addresses can be verified.")
  }
  if (url.username || url.password) {
    throw new DomainInputError("DOMAIN_CREDENTIALS", "Remove the username or password from that address.")
  }

  const hostname = normalizeHostname(url.hostname)
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80
  if (!Number.isInteger(port) || (url.protocol === "https:" && port !== 443) || (url.protocol === "http:" && port !== 80)) {
    throw new DomainInputError("DOMAIN_PORT", "Only the standard web ports (80 and 443) can be verified.")
  }

  return {
    protocol: url.protocol as "http:" | "https:",
    hostname,
    port,
    registrableDomain: registrableDomainOf(hostname),
    homepageUrl: `${url.protocol}//${formatHostForUrl(hostname)}/`,
  }
}

/** Re-bracket IPv6 literals so the assembled URL stays parseable. */
export function formatHostForUrl(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname
}

/** Case-insensitive, unambiguous host equality used for conflict checks. */
export function sameHost(a: string, b: string): boolean {
  try {
    return normalizeHostname(a) === normalizeHostname(b)
  } catch {
    return false
  }
}
