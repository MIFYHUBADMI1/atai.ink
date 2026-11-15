import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { generateKeyPairSync } from "node:crypto"

/**
 * Search Console integration boundary.
 *
 * The point of these tests is honesty: when the integration is not connected
 * the admin UI must be able to say "unavailable" rather than showing zeros
 * that look like real performance data.
 */

vi.mock("server-only", () => ({}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  bingWebmasterStatus,
  fetchSearchPerformance,
  searchConsoleConfigured,
} from "@/lib/blog/search-console"

const ENV_KEYS = [
  "SEARCH_CONSOLE_CLIENT_EMAIL",
  "SEARCH_CONSOLE_PRIVATE_KEY",
  "SEARCH_CONSOLE_SITE_URL",
  "BING_WEBMASTER_API_KEY",
]

/** A real RSA key so the service-account assertion is actually signed. */
let privateKeyPem = ""

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  })
  privateKeyPem = privateKey
})

function configureCredentials() {
  process.env.SEARCH_CONSOLE_CLIENT_EMAIL = "sc@example.iam.gserviceaccount.com"
  process.env.SEARCH_CONSOLE_PRIVATE_KEY = privateKeyPem
  process.env.SEARCH_CONSOLE_SITE_URL = "sc-domain:atai.ink"
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  vi.unstubAllGlobals()
})

describe("searchConsoleConfigured", () => {
  it("is false when no credentials are present", () => {
    expect(searchConsoleConfigured()).toBe(false)
  })

  it("is true once every credential is present", () => {
    configureCredentials()
    expect(searchConsoleConfigured()).toBe(true)
  })

  it("is false when only part of the configuration is present", () => {
    process.env.SEARCH_CONSOLE_CLIENT_EMAIL = "sc@example.iam.gserviceaccount.com"
    expect(searchConsoleConfigured()).toBe(false)
  })
})

describe("fetchSearchPerformance", () => {
  it("reports an unconnected integration instead of returning zero performance", async () => {
    const report = await fetchSearchPerformance({ days: 30 })

    expect(report.status).toBe("not-configured")
    expect(report.configured).toBe(false)
    expect(report.rows).toEqual([])
    expect(report.totals).toBeNull()
    expect(report.message).toContain("not connected")
  })

  it("never reports a failed lookup as zero performance", async () => {
    configureCredentials()

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down")
      }),
    )

    const report = await fetchSearchPerformance({ days: 30 })
    expect(report.status).toBe("error")
    expect(report.totals).toBeNull()
    expect(report.rows).toEqual([])
  })

  it("reports an unauthorised property distinctly from a missing connection", async () => {
    configureCredentials()

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("oauth2.googleapis.com")) {
          return new Response(JSON.stringify({ access_token: "token" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })
      }),
    )

    const report = await fetchSearchPerformance({ days: 30 })
    expect(report.status).toBe("unauthorized")
    expect(report.totals).toBeNull()
  })

  it("returns real totals when the API answers", async () => {
    configureCredentials()

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("oauth2.googleapis.com")) {
          return new Response(JSON.stringify({ access_token: "token" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response(
          JSON.stringify({
            rows: [
              { keys: ["https://atai.ink/blog/one"], clicks: 10, impressions: 100, ctr: 0.1, position: 4.5 },
              { keys: ["https://atai.ink/blog/two"], clicks: 5, impressions: 50, ctr: 0.1, position: 7.5 },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }),
    )

    const report = await fetchSearchPerformance({ days: 30 })
    expect(report.status).toBe("ready")
    expect(report.totals?.clicks).toBe(15)
    expect(report.totals?.impressions).toBe(150)
    expect(report.totals?.ctr).toBeCloseTo(0.1)
    expect(report.totals?.position).toBeCloseTo(6)
    expect(report.rows).toHaveLength(2)
  })
})

describe("bingWebmasterStatus", () => {
  it("says metrics are unavailable when no API key is configured", () => {
    const status = bingWebmasterStatus()
    expect(status.metricsAvailable).toBe(false)
    expect(status.message).toContain("not configured")
  })

  it("reports the connection once a key is configured", () => {
    process.env.BING_WEBMASTER_API_KEY = "bing-key"
    const status = bingWebmasterStatus()
    expect(status.metricsAvailable).toBe(true)
    expect(status.message).toContain("connected")
  })
})
