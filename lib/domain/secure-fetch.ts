/**
 * SSRF-safe, resource-bounded HTTP GET for domain ownership verification.
 *
 * This is deliberately NOT the general-purpose website fetcher. Verification
 * opens a socket from Atai's own network straight to a founder-supplied host,
 * so it gets its own policy:
 *
 *  1. String-level URL policy (scheme, credentials, blocked hostnames, encoded
 *     IP forms) via the existing `assertPublicHttpUrl`.
 *  2. DNS is resolved BY US first, every A/AAAA answer is validated, and a
 *     mixed public/private answer is rejected outright.
 *  3. The connection is pinned to an address we already validated (custom
 *     `lookup`), so a rebinding second answer cannot redirect the socket. TLS
 *     still verifies the certificate against the real hostname via
 *     `servername` — pinning an IP never disables certificate checks.
 *  4. Redirects are followed by us, max N hops, and every hop re-runs 1-3.
 *     File verification additionally refuses a hop to a different hostname.
 *  5. One document only: no subresources, no JS, no site crawling, hard byte
 *     cap, content-type cap, hard timeouts.
 *  6. Failures are reported as stable codes. Raw network errors, internal
 *     addresses and DNS detail never reach the client.
 */
import http from "node:http"
import https from "node:https"
import { assertPublicHttpUrl, isPrivateIpv4, isPrivateIpv6 } from "@/lib/runtime/router/adapters/shared/ssrf"
import { assertSiteUrl, formatHostForUrl, isIpLiteralHost, normalizeHostname, type SiteTarget } from "./host"

export class DomainFetchError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "DomainFetchError"
    this.code = code
  }
}

export interface FetchLimits {
  maxBytes: number
  totalTimeoutMs: number
  maxRedirects: number
  /** Substrings matched case-insensitively against the Content-Type header. */
  acceptContentTypes: string[]
  /** Default true (a www→apex redirect is normal). File verification sets it
   * false: the token file must be found on the exact hostname claimed. */
  allowHostnameChange: boolean
  userAgent?: string
}

const DEFAULT_LIMITS: FetchLimits = {
  maxBytes: 256 * 1024,
  totalTimeoutMs: 10_000,
  maxRedirects: 3,
  acceptContentTypes: ["text/html", "text/plain"],
  allowHostnameChange: true,
  userAgent: "AtaiDomainVerification/1.0 (+https://atai.ink)",
}

export interface RawRequestOptions {
  target: SiteTarget
  /** Addresses already validated public for this hostname. */
  addresses: string[]
  path: string
  headers: Record<string, string>
  limits: FetchLimits
}

export interface RawResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

export interface SecureFetchDeps {
  /** Returns every A and AAAA record for the hostname. */
  resolveAddresses: (hostname: string) => Promise<string[]>
  request: (options: RawRequestOptions) => Promise<RawResponse>
}

export interface FetchedDocument {
  status: number
  body: string
  contentType: string
  /** Final hostname that answered, for diagnostics only. */
  hostname: string
  redirects: number
}

/** A raw IP literal is checked directly — there is no DNS step to trust. */
function assertPublicAddressLiteral(address: string): void {
  if (address.includes(":")) {
    const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
    if (mapped && (isPrivateIpv4(mapped[1]) || isPrivateIpv6(address))) {
      throw new DomainFetchError("UNSAFE_DESTINATION", "That address is not publicly reachable.")
    }
    if (isPrivateIpv6(address)) throw new DomainFetchError("UNSAFE_DESTINATION", "That address is not publicly reachable.")
    return
  }
  if (isPrivateIpv4(address)) throw new DomainFetchError("UNSAFE_DESTINATION", "That address is not publicly reachable.")
}

/**
 * Reject unless EVERY resolved address is public. A response that mixes a
 * public and a private record is treated as hostile, not as a tie to break.
 */
export function assertAllAddressesPublic(hostname: string, addresses: string[]): string[] {
  if (isIpLiteralHost(hostname)) {
    assertPublicAddressLiteral(hostname)
    return [hostname]
  }
  if (!addresses.length) {
    throw new DomainFetchError("DNS_NOT_FOUND", "We could not find that website on the internet.")
  }
  for (const address of addresses) {
    assertPublicAddressLiteral(address)
  }
  return addresses
}

async function defaultResolveAddresses(hostname: string): Promise<string[]> {
  const { promises: dns } = await import("node:dns")
  const [v4, v6] = await Promise.all([
    dns.resolve4(hostname).catch(() => [] as string[]),
    dns.resolve6(hostname).catch(() => [] as string[]),
  ])
  // CNAME chains are resolved by the resolver; A/AAAA answers are what we
  // validate, so an alias into an internal name still has to pass the guard on
  // the address it actually resolves to.
  return [...v4, ...v6]
}

function headerValue(headers: RawResponse["headers"], name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(raw) ? raw[0] : raw
}

function defaultRequest({ target, addresses, path, headers, limits }: RawRequestOptions): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const isTls = target.protocol === "https:"
    const mod = isTls ? https : http

    // Pin the socket to an address we validated, while SNI + certificate
    // validation continue to use the real hostname.
    const lookup: import("node:net").LookupFunction = (_hostname, options, callback) => {
      const record = (address: string) => ({ address, family: address.includes(":") ? 6 : 4 })
      if (options.all) return callback(null, addresses.map(record))
      const first = addresses[0]
      if (!first) {
        callback(Object.assign(new Error("no validated address"), { code: "ENOTFOUND" }), [], 4)
        return
      }
      callback(null, first, first.includes(":") ? 6 : 4)
    }

    const req = mod.request(
      {
        // `host`/`servername` stay the hostname so the TLS handshake and the
        // Host header are correct; `lookup` decides the actual IP.
        host: formatHostForUrl(target.hostname),
        hostname: formatHostForUrl(target.hostname),
        servername: target.hostname,
        port: target.port,
        path,
        method: "GET",
        headers: { Host: `${formatHostForUrl(target.hostname)}${target.port === 80 || target.port === 443 ? "" : `:${target.port}`}`, ...headers },
        lookup,
        setHost: false,
        agent: isTls ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false }),
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        const timer = setTimeout(() => {
          req.destroy(new DomainFetchError("TIMEOUT", "The website took too long to respond."))
        }, limits.totalTimeoutMs)

        res.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > limits.maxBytes) {
            clearTimeout(timer)
            res.destroy()
            reject(new DomainFetchError("RESPONSE_TOO_LARGE", "That page is larger than verification can read."))
          } else {
            chunks.push(chunk)
          }
        })
        res.on("end", () => {
          clearTimeout(timer)
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as RawResponse["headers"],
            body: Buffer.concat(chunks).toString("utf8"),
          })
        })
        res.on("error", (error) => {
          clearTimeout(timer)
          reject(error)
        })
      },
    )

    req.on("error", (error) => {
      reject(error instanceof DomainFetchError ? error : new DomainFetchError("UNREACHABLE", "We could not reach that website."))
    })
    req.end()
  })
}

export const defaultSecureFetchDeps: SecureFetchDeps = {
  resolveAddresses: defaultResolveAddresses,
  request: defaultRequest,
}

/**
 * GET one document with the full policy above. `pathname` is the exact path to
 * request on the target host (root "/" for the homepage, "/file.html" for the
 * verification file).
 */
export async function safeFetchDocument(
  submittedUrl: string,
  pathname: string,
  options: Partial<FetchLimits> = {},
  deps: SecureFetchDeps = defaultSecureFetchDeps,
): Promise<FetchedDocument> {
  const limits: FetchLimits = { ...DEFAULT_LIMITS, ...options }
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`
  let current = assertSiteUrl(submittedUrl)
  let requestPath = normalizedPath
  const originHostname = current.hostname
  let redirects = 0

  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    // 1. string-level policy, re-run on every hop
    try {
      assertPublicHttpUrl(`${current.protocol}//${formatHostForUrl(current.hostname)}:${current.port}/`)
    } catch {
      throw new DomainFetchError("UNSAFE_DESTINATION", "We cannot verify that address because it is not a public web destination.")
    }

    // 2-3. resolve, validate all answers, pin
    let addresses: string[]
    try {
      addresses = isIpLiteralHost(current.hostname) ? [current.hostname] : await deps.resolveAddresses(current.hostname)
    } catch {
      throw new DomainFetchError("DNS_FAILED", "We could not look up that website address.")
    }
    assertAllAddressesPublic(current.hostname, addresses)

    const res = await deps
      .request({
        target: current,
        addresses,
        path: requestPath,
        headers: { "User-Agent": limits.userAgent ?? DEFAULT_LIMITS.userAgent!, Accept: limits.acceptContentTypes.join(", ") },
        limits,
      })
      .catch((error: unknown) => {
        if (error instanceof DomainFetchError) throw error
        throw new DomainFetchError("UNREACHABLE", "We could not reach that website.")
      })

    // 4. redirects
    const location = res.status >= 300 && res.status < 400 ? headerValue(res.headers, "location") : undefined
    if (location) {
      if (redirects >= limits.maxRedirects) {
        throw new DomainFetchError("TOO_MANY_REDIRECTS", "That website keeps redirecting, so verification stopped.")
      }
      let nextUrl: URL
      try {
        nextUrl = new URL(location, `${current.protocol}//${formatHostForUrl(current.hostname)}${current.port === 80 || current.port === 443 ? "" : `:${current.port}`}${requestPath}`)
      } catch {
        throw new DomainFetchError("BAD_REDIRECT", "That website returned a redirect we could not follow.")
      }
      if (!limits.allowHostnameChange && normalizeHostname(nextUrl.hostname) !== originHostname) {
        throw new DomainFetchError("REDIRECT_HOST", "That address redirected to a different website, so verification stopped.")
      }
      redirects += 1
      // The path must survive the hop: a redirect that drops the verification
      // file's path is not a found file.
      requestPath = `${nextUrl.pathname}${nextUrl.search}`
      if (!requestPath.startsWith("/")) requestPath = `/${requestPath}`
      try {
        current = assertSiteUrl(nextUrl.origin)
      } catch {
        throw new DomainFetchError("UNSAFE_DESTINATION", "We cannot verify that address because it is not a public web destination.")
      }
      continue
    }

    if (res.status === 404) throw new DomainFetchError("NOT_FOUND", "We could not find that page on your website.")
    if (res.status >= 400) throw new DomainFetchError("HTTP_ERROR", `Your website responded with an error (HTTP ${res.status}).`)
    if (res.status < 200) throw new DomainFetchError("HTTP_STATUS", "Your website returned an unexpected response.")

    const contentType = (headerValue(res.headers, "content-type") ?? "").toLowerCase()
    if (!limits.acceptContentTypes.some((accepted) => contentType.includes(accepted))) {
      throw new DomainFetchError("CONTENT_TYPE", "That address did not return a web page we could read.")
    }

    return { status: res.status, body: res.body, contentType, hostname: current.hostname, redirects }
  }

  throw new DomainFetchError("TOO_MANY_REDIRECTS", "That website keeps redirecting, so verification stopped.")
}
