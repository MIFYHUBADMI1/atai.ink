import http from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"
import {
  assertAllAddressesPublic,
  defaultSecureFetchDeps,
  DomainFetchError,
  safeFetchDocument,
  type RawRequestOptions,
  type RawResponse,
  type SecureFetchDeps,
} from "./secure-fetch"
import type { SiteTarget } from "./host"

const PUBLIC_IP = "93.184.216.34"

function htmlResponse(body = "<html><head></head><body>ok</body></html>"): RawResponse {
  return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body }
}

function redirect(location: string, status = 302): RawResponse {
  return { status, headers: { location }, body: "" }
}

/** Deps whose request must never be reached — proves the guard fires first. */
function forbiddenDeps(addresses: string[] = [PUBLIC_IP]): SecureFetchDeps & {
  resolveAddresses: ReturnType<typeof vi.fn>
  request: ReturnType<typeof vi.fn>
} {
  return {
    resolveAddresses: vi.fn(async () => addresses),
    request: vi.fn(async () => htmlResponse()),
  }
}

function scriptedDeps(responses: RawResponse[], addresses: string[] = [PUBLIC_IP]) {
  const calls: RawRequestOptions[] = []
  let index = 0
  const deps: SecureFetchDeps = {
    resolveAddresses: vi.fn(async () => addresses),
    request: vi.fn(async (options: RawRequestOptions) => {
      calls.push(options)
      const response = responses[Math.min(index, responses.length - 1)]
      index += 1
      return response
    }),
  }
  return { deps, calls }
}

async function expectFetchError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

describe("safeFetchDocument — string-level policy (no socket, no DNS)", () => {
  const blockedUrls = [
    "http://sub.localhost/",
    "http://127.0.0.1/",
    "http://127.1.2.3/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://100.64.0.1/", // CGNAT
    "http://0.0.0.0/",
    "http://metadata.google.internal/",
    "http://printer.local/",
    "http://db.internal/",
    "http://kubernetes.default.svc/",
  ]

  for (const url of blockedUrls) {
    it(`rejects ${url} before DNS or any request`, async () => {
      const deps = forbiddenDeps()
      await expectFetchError(safeFetchDocument(url, "/", {}, deps), "UNSAFE_DESTINATION")
      expect(deps.resolveAddresses).not.toHaveBeenCalled()
      expect(deps.request).not.toHaveBeenCalled()
    })
  }

  // These fail closed even earlier, in hostname validation: bare "localhost"
  // has no dot, and raw IPv6 literals are not accepted as submitted hosts at
  // all. Either way no DNS lookup or socket happens.
  const earlyRejected: Array<[string, string]> = [
    ["http://localhost/", "DOMAIN_NO_DOT"],
    ["http://[::1]/", "DOMAIN_INVALID"],
    ["http://[::]/", "DOMAIN_INVALID"],
    ["http://[fd00::1]/", "DOMAIN_INVALID"],
    ["http://[fe80::1]/", "DOMAIN_INVALID"],
    ["http://[::ffff:127.0.0.1]/", "DOMAIN_INVALID"],
  ]

  for (const [url, code] of earlyRejected) {
    it(`rejects ${url} at hostname validation (${code})`, async () => {
      const deps = forbiddenDeps()
      await expect(safeFetchDocument(url, "/", {}, deps)).rejects.toMatchObject({ code })
      expect(deps.resolveAddresses).not.toHaveBeenCalled()
      expect(deps.request).not.toHaveBeenCalled()
    })
  }

  const malformed: Array<[string, string]> = [
    ["file:///etc/passwd", "DOMAIN_SCHEME"],
    ["ftp://example.com/", "DOMAIN_SCHEME"],
    ["gopher://example.com/", "DOMAIN_SCHEME"],
    // Without "//" these are not even parsed as URLs after scheme prefixing,
    // so they fail closed as invalid rather than as a scheme violation.
    ["javascript:alert(1)", "DOMAIN_INVALID"],
    ["data:text/html,hello", "DOMAIN_INVALID"],
    ["https://user:pass@example.com/", "DOMAIN_CREDENTIALS"],
    ["https://example.com:8443/", "DOMAIN_PORT"],
    ["http://example.com:22/", "DOMAIN_PORT"],
    ["https://example.com:80/", "DOMAIN_PORT"],
    ["not a url at all", "DOMAIN_INVALID"],
    ["https://under_score.example.com/", "DOMAIN_INVALID"],
  ]

  for (const [url, code] of malformed) {
    it(`rejects ${url} with ${code}`, async () => {
      const deps = forbiddenDeps()
      await expect(safeFetchDocument(url, "/", {}, deps)).rejects.toMatchObject({ code })
      expect(deps.request).not.toHaveBeenCalled()
    })
  }
})

describe("safeFetchDocument — DNS validation and pinning", () => {
  it("fails DNS_NOT_FOUND when the hostname has no records", async () => {
    const deps = forbiddenDeps([])
    await expectFetchError(safeFetchDocument("https://example.com/", "/", {}, deps), "DNS_NOT_FOUND")
    expect(deps.request).not.toHaveBeenCalled()
  })

  it("fails DNS_FAILED when resolution itself errors, without leaking the error", async () => {
    const deps: SecureFetchDeps = {
      resolveAddresses: vi.fn(async () => {
        throw new Error("queryA ECONNREFUSED 10.0.0.53:53")
      }),
      request: vi.fn(),
    }
    const promise = safeFetchDocument("https://example.com/", "/", {}, deps)
    await expectFetchError(promise, "DNS_FAILED")
    await expect(promise).rejects.not.toMatchObject({ message: expect.stringContaining("10.0.0.53") })
  })

  it("rejects a public-looking hostname that resolves to a private address", async () => {
    const deps = forbiddenDeps(["127.0.0.1"])
    await expectFetchError(safeFetchDocument("https://innocent.example.com/", "/", {}, deps), "UNSAFE_DESTINATION")
    expect(deps.request).not.toHaveBeenCalled()
  })

  it("rejects a MIXED public/private answer outright — never picks the public one", async () => {
    const deps = forbiddenDeps([PUBLIC_IP, "10.0.0.5"])
    await expectFetchError(safeFetchDocument("https://mixed.example.com/", "/", {}, deps), "UNSAFE_DESTINATION")
    expect(deps.request).not.toHaveBeenCalled()
  })

  it("rejects private IPv6 answers", async () => {
    for (const address of ["::1", "fd12::1", "fe80::1", "::ffff:169.254.169.254"]) {
      const deps = forbiddenDeps([address])
      await expectFetchError(safeFetchDocument("https://v6.example.com/", "/", {}, deps), "UNSAFE_DESTINATION")
      expect(deps.request).not.toHaveBeenCalled()
    }
  })

  it("pins the request to the validated addresses", async () => {
    const { deps, calls } = scriptedDeps([htmlResponse()], [PUBLIC_IP, "2606:2800:220::1"])
    const doc = await safeFetchDocument("https://example.com/", "/", {}, deps)
    expect(doc.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].addresses).toEqual([PUBLIC_IP, "2606:2800:220::1"])
    expect(calls[0].target.hostname).toBe("example.com")
    expect(calls[0].path).toBe("/")
  })

  it("checks raw IP literals directly without a DNS step", async () => {
    const deps = forbiddenDeps()
    await expectFetchError(safeFetchDocument("http://10.1.2.3/", "/", {}, deps), "UNSAFE_DESTINATION")
    expect(deps.resolveAddresses).not.toHaveBeenCalled()
  })

  it("accepts a public IP literal and requests it directly", async () => {
    const { deps, calls } = scriptedDeps([htmlResponse()])
    const doc = await safeFetchDocument(`http://${PUBLIC_IP}/`, "/", {}, deps)
    expect(doc.hostname).toBe(PUBLIC_IP)
    expect(deps.resolveAddresses).not.toHaveBeenCalled()
    expect(calls[0].addresses).toEqual([PUBLIC_IP])
  })
})

describe("assertAllAddressesPublic", () => {
  it("accepts an all-public answer set", () => {
    expect(assertAllAddressesPublic("example.com", [PUBLIC_IP, "2606:2800:220::1"])).toEqual([
      PUBLIC_IP,
      "2606:2800:220::1",
    ])
  })

  it("throws DNS_NOT_FOUND for an empty answer set", () => {
    expect(() => assertAllAddressesPublic("example.com", [])).toThrow(DomainFetchError)
    try {
      assertAllAddressesPublic("example.com", [])
    } catch (error) {
      expect((error as DomainFetchError).code).toBe("DNS_NOT_FOUND")
    }
  })
})

describe("safeFetchDocument — redirect policy", () => {
  it("re-validates every hop: a redirect to loopback is refused", async () => {
    const { deps } = scriptedDeps([redirect("http://127.0.0.1/admin"), htmlResponse()])
    await expectFetchError(safeFetchDocument("https://example.com/", "/", {}, deps), "UNSAFE_DESTINATION")
  })

  it("re-resolves the redirect target: a hop whose DNS turns private is refused (rebinding)", async () => {
    let lookups = 0
    const deps: SecureFetchDeps = {
      resolveAddresses: vi.fn(async () => {
        lookups += 1
        return lookups === 1 ? [PUBLIC_IP] : ["169.254.169.254"]
      }),
      request: vi.fn(async () => redirect("https://second.example.com/")),
    }
    await expectFetchError(safeFetchDocument("https://first.example.com/", "/", {}, deps), "UNSAFE_DESTINATION")
    expect(deps.request).toHaveBeenCalledTimes(1)
  })

  it("refuses a cross-hostname hop when allowHostnameChange is false", async () => {
    const { deps } = scriptedDeps([redirect("https://other-site.com/file.html"), htmlResponse()])
    await expectFetchError(
      safeFetchDocument("https://example.com/file.html", "/file.html", { allowHostnameChange: false }, deps),
      "REDIRECT_HOST",
    )
  })

  it("names the address that actually answered, so the founder has a next step", async () => {
    const { deps } = scriptedDeps([redirect("https://my-shop.example.net/file.html"), htmlResponse()])
    await expect(
      safeFetchDocument(
        "https://example.com/file.html",
        "/file.html",
        { allowHostnameChange: false, allowSameSiteRedirects: true },
        deps,
      ),
    ).rejects.toMatchObject({ code: "REDIRECT_HOST", hostname: "my-shop.example.net" })
  })

  it("never names a redirect target that is not a public destination", async () => {
    const { deps } = scriptedDeps([redirect("http://127.0.0.1/admin"), htmlResponse()])
    const error = await safeFetchDocument("https://example.com/", "/", { allowHostnameChange: false }, deps).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(DomainFetchError)
    expect((error as DomainFetchError).code).toBe("REDIRECT_HOST")
    expect((error as DomainFetchError).hostname).toBeUndefined()
  })

  it("allows a same-site hop when only same-site redirects are permitted", async () => {
    const { deps, calls } = scriptedDeps([redirect("https://www.example.com/"), htmlResponse()])
    const doc = await safeFetchDocument(
      "https://example.com/",
      "/",
      { allowHostnameChange: false, allowSameSiteRedirects: true },
      deps,
    )
    expect(doc.hostname).toBe("www.example.com")
    expect(calls).toHaveLength(2)
  })

  it("refuses a hop to a different registrable domain even when same-site redirects are permitted", async () => {
    const { deps } = scriptedDeps([redirect("https://other-site.com/"), htmlResponse()])
    await expectFetchError(
      safeFetchDocument(
        "https://example.com/",
        "/",
        { allowHostnameChange: false, allowSameSiteRedirects: true },
        deps,
      ),
      "REDIRECT_HOST",
    )
  })

  it("refuses a hop between two shared-hosting subdomains", async () => {
    const { deps } = scriptedDeps([redirect("https://victim.vercel.app/"), htmlResponse()])
    await expectFetchError(
      safeFetchDocument(
        "https://attacker.vercel.app/",
        "/",
        { allowHostnameChange: false, allowSameSiteRedirects: true },
        deps,
      ),
      "REDIRECT_HOST",
    )
  })

  it("allows a www→apex hop by default", async () => {
    const { deps, calls } = scriptedDeps([redirect("https://example.com/"), htmlResponse()])
    const doc = await safeFetchDocument("https://www.example.com/", "/", {}, deps)
    expect(doc.hostname).toBe("example.com")
    expect(doc.redirects).toBe(1)
    expect(calls).toHaveLength(2)
  })

  it("preserves the verification file path across a relative redirect", async () => {
    const { deps, calls } = scriptedDeps([redirect("/moved/verify.html"), htmlResponse()])
    await safeFetchDocument(
      "https://example.com/verify.html",
      "/verify.html",
      { allowHostnameChange: false },
      deps,
    )
    expect(calls[1].path).toBe("/moved/verify.html")
  })

  it("preserves the query string across a redirect", async () => {
    const { deps, calls } = scriptedDeps([redirect("/verify.html?x=1"), htmlResponse()])
    await safeFetchDocument("https://example.com/verify.html", "/verify.html", {}, deps)
    expect(calls[1].path).toBe("/verify.html?x=1")
  })

  it("stops a redirect loop with TOO_MANY_REDIRECTS", async () => {
    const { deps, calls } = scriptedDeps([redirect("https://example.com/loop")])
    await expectFetchError(safeFetchDocument("https://example.com/", "/", {}, deps), "TOO_MANY_REDIRECTS")
    // initial request + maxRedirects hops, never more
    expect(calls.length).toBeLessThanOrEqual(4)
  })

  it("reports BAD_REDIRECT for an unparseable Location", async () => {
    const { deps } = scriptedDeps([redirect("http://[broken")])
    await expectFetchError(safeFetchDocument("https://example.com/", "/", {}, deps), "BAD_REDIRECT")
  })
})

describe("safeFetchDocument — response policy", () => {
  it("maps 404 to NOT_FOUND", async () => {
    const { deps } = scriptedDeps([{ status: 404, headers: {}, body: "" }])
    await expectFetchError(safeFetchDocument("https://example.com/x.html", "/x.html", {}, deps), "NOT_FOUND")
  })

  it("maps 5xx to HTTP_ERROR without leaking the body", async () => {
    const { deps } = scriptedDeps([{ status: 500, headers: {}, body: "internal stack trace 10.0.0.9" }])
    const promise = safeFetchDocument("https://example.com/", "/", {}, deps)
    await expectFetchError(promise, "HTTP_ERROR")
    await expect(promise).rejects.not.toMatchObject({ message: expect.stringContaining("10.0.0.9") })
  })

  it("rejects informational statuses", async () => {
    const { deps } = scriptedDeps([{ status: 100, headers: {}, body: "" }])
    await expectFetchError(safeFetchDocument("https://example.com/", "/", {}, deps), "HTTP_STATUS")
  })

  it("rejects a non-HTML/plain content type", async () => {
    const { deps } = scriptedDeps([{ status: 200, headers: { "content-type": "application/json" }, body: "{}" }])
    await expectFetchError(safeFetchDocument("https://example.com/", "/", {}, deps), "CONTENT_TYPE")
  })

  it("accepts text/plain (the verification file)", async () => {
    const { deps } = scriptedDeps([
      { status: 200, headers: { "content-type": "text/plain" }, body: "atai-verification=tok" },
    ])
    const doc = await safeFetchDocument("https://example.com/f.txt", "/f.txt", {}, deps)
    expect(doc.body).toBe("atai-verification=tok")
  })

  it("wraps raw socket errors as UNREACHABLE without exposing internals", async () => {
    const deps: SecureFetchDeps = {
      resolveAddresses: vi.fn(async () => [PUBLIC_IP]),
      request: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.9:443")
      }),
    }
    const promise = safeFetchDocument("https://example.com/", "/", {}, deps)
    await expectFetchError(promise, "UNREACHABLE")
    await expect(promise).rejects.not.toMatchObject({ message: expect.stringContaining("10.0.0.9") })
  })

  it("passes through typed fetch errors such as TIMEOUT", async () => {
    const deps: SecureFetchDeps = {
      resolveAddresses: vi.fn(async () => [PUBLIC_IP]),
      request: vi.fn(async () => {
        throw new DomainFetchError("TIMEOUT", "The website took too long to respond.")
      }),
    }
    await expectFetchError(safeFetchDocument("https://example.com/", "/", {}, deps), "TIMEOUT")
  })
})

describe("defaultRequest — real socket bounds against a local server", () => {
  async function withServer(
    handler: http.RequestListener,
    run: (port: number) => Promise<void>,
  ): Promise<void> {
    const server = http.createServer(handler)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await run(port)
    } finally {
      server.close()
      server.closeAllConnections()
    }
  }

  function localTarget(port: number): SiteTarget {
    return {
      protocol: "http:",
      hostname: "127.0.0.1",
      port,
      registrableDomain: "127.0.0.1",
      homepageUrl: `http://127.0.0.1:${port}/`,
    }
  }

  const limits = {
    maxBytes: 1024,
    totalTimeoutMs: 500,
    maxRedirects: 3,
    acceptContentTypes: ["text/html", "text/plain"],
    allowHostnameChange: true,
    userAgent: "test",
  }

  it("fetches a small document", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" })
        res.end("<html>hello</html>")
      },
      async (port) => {
        const response = await defaultSecureFetchDeps.request({
          target: localTarget(port),
          addresses: ["127.0.0.1"],
          path: "/",
          headers: {},
          limits,
        })
        expect(response.status).toBe(200)
        expect(response.body).toBe("<html>hello</html>")
      },
    )
  })

  it("enforces the byte cap mid-stream", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" })
        const chunk = "x".repeat(4096)
        const timer = setInterval(() => res.write(chunk), 10)
        res.on("close", () => clearInterval(timer))
      },
      async (port) => {
        await expect(
          defaultSecureFetchDeps.request({
            target: localTarget(port),
            addresses: ["127.0.0.1"],
            path: "/",
            headers: {},
            limits,
          }),
        ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" })
      },
    )
  })

  it("enforces the total timeout on a stalled response", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" })
        res.write("start")
        // never ends
      },
      async (port) => {
        await expect(
          defaultSecureFetchDeps.request({
            target: localTarget(port),
            addresses: ["127.0.0.1"],
            path: "/",
            headers: {},
            limits: { ...limits, totalTimeoutMs: 200 },
          }),
        ).rejects.toMatchObject({ code: "TIMEOUT" })
      },
    )
  })
})