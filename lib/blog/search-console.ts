import "server-only"

import { createSign } from "node:crypto"

import { logger } from "@/lib/logging/logger"
import { getBlogSettings } from "@/lib/blog/store"

/**
 * Google Search Console integration boundary.
 *
 * The Content Studio must be able to show search impressions, clicks, queries and
 * average position — but only when the property is actually connected. This
 * module therefore separates three states that are easy to conflate:
 *
 *   - "not-configured"  no service-account credentials in the environment
 *   - "unauthorized"    credentials present but the property rejects them
 *   - "ready"           the API answered with real numbers
 *
 * A missing integration is reported as unavailable, never as zero performance.
 *
 * Required environment:
 *   SEARCH_CONSOLE_CLIENT_EMAIL  service-account email
 *   SEARCH_CONSOLE_PRIVATE_KEY   PEM private key ("\n" escapes are accepted)
 *   SEARCH_CONSOLE_SITE_URL      the property, e.g. "sc-domain:atai.ink"
 */

type SearchConsoleStatus = "not-configured" | "unauthorized" | "error" | "ready"

interface SearchPerformanceRow {
  /** Dimension values, e.g. ["https://atai.ink/blog/foo"] for the page dimension. */
  keys: string[]
  clicks: number
  impressions: number
  /** Click-through rate, 0–1. */
  ctr: number
  /** Average position. Lower is better. */
  position: number
}

interface SearchPerformanceTotals {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface SearchPerformanceReport {
  status: SearchConsoleStatus
  /** Human-readable explanation shown verbatim in the admin UI. */
  message: string
  configured: boolean
  rows: SearchPerformanceRow[]
  /** null when the API was never reached — unavailable data is not zero. */
  totals: SearchPerformanceTotals | null
  range: { startDate: string; endDate: string }
  fetchedAtMs: number
}

interface SearchConsoleConfig {
  clientEmail: string
  privateKey: string
  siteUrl: string
}

function readConfig(): SearchConsoleConfig | null {
  const clientEmail = process.env.SEARCH_CONSOLE_CLIENT_EMAIL?.trim()
  const rawKey = process.env.SEARCH_CONSOLE_PRIVATE_KEY?.trim()
  const siteUrl = process.env.SEARCH_CONSOLE_SITE_URL?.trim()
  if (!clientEmail || !rawKey || !siteUrl) return null
  // A PEM pasted through a single-line env var keeps literal "\n" escapes.
  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey
  return { clientEmail, privateKey, siteUrl }
}

/** True when credentials exist. Says nothing about whether they work. */
export function searchConsoleConfigured(): boolean {
  return readConfig() !== null
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url")
}

/** Exchange a signed service-account assertion for a short-lived access token. */
async function accessToken(config: SearchConsoleConfig): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = { alg: "RS256", typ: "JWT" }
  const claims = {
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const signature = createSign("RSA-SHA256").update(signingInput).sign(config.privateKey)
  const assertion = `${signingInput}.${signature.toString("base64url")}`

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`Search Console token request failed with ${response.status}`)
  }
  const payload = (await response.json()) as { access_token?: string }
  if (!payload.access_token) throw new Error("Search Console token response had no access token.")
  return payload.access_token
}

function isoDate(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10)
}

function emptyReport(
  status: SearchConsoleStatus,
  message: string,
  range: { startDate: string; endDate: string },
): SearchPerformanceReport {
  return {
    status,
    message,
    configured: searchConsoleConfigured(),
    rows: [],
    totals: null,
    range,
    fetchedAtMs: Date.now(),
  }
}

/**
 * Pull real search performance for the site. Never throws: an integration that
 * cannot be reached is reported as a status, not as a broken page.
 */
export async function fetchSearchPerformance(options?: {
  days?: number
  dimension?: "page" | "query"
}): Promise<SearchPerformanceReport> {
  const days = Math.min(365, Math.max(1, Math.round(options?.days ?? 30)))
  const dimension = options?.dimension ?? "page"
  const range = { startDate: isoDate(days), endDate: isoDate(2) }

  const config = readConfig()
  if (!config) {
    return emptyReport(
      "not-configured",
      "Google Search Console is not connected. Add the service-account credentials to read impressions, clicks and average position.",
      range,
    )
  }

  try {
    const token = await accessToken(config)
    const response = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: range.startDate,
          endDate: range.endDate,
          dimensions: [dimension],
          rowLimit: 100,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (response.status === 401 || response.status === 403) {
      return emptyReport(
        "unauthorized",
        "Search Console rejected the credentials. Check that the service account has access to the verified property.",
        range,
      )
    }
    if (!response.ok) {
      return emptyReport(
        "error",
        `Search Console responded ${response.status}. The data is unavailable, not zero.`,
        range,
      )
    }
    const payload = (await response.json()) as {
      rows?: { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }[]
    }
    const rows: SearchPerformanceRow[] = (payload.rows ?? []).map((row) => ({
      keys: row.keys ?? [],
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    }))
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0)
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0)
    const position = rows.length ? rows.reduce((sum, row) => sum + row.position, 0) / rows.length : 0
    return {
      status: "ready",
      message: rows.length
        ? `Search Console returned ${rows.length} row(s) for the last ${days} days.`
        : `Search Console has no rows for the last ${days} days.`,
      configured: true,
      rows,
      totals: {
        clicks,
        impressions,
        ctr: impressions ? clicks / impressions : 0,
        position,
      },
      range,
      fetchedAtMs: Date.now(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn("blog.search-console", "Search Console request failed", { message })
    return emptyReport("error", `Search Console could not be reached: ${message}`, range)
  }
}

/**
 * Bing Webmaster Tools. The verification token proves the site is claimed, but
 * query-level metrics need a Webmaster API key. Without one the admin UI says
 * "unavailable" rather than showing an empty dashboard.
 */
export async function bingWebmasterStatus(): Promise<{
  verified: boolean
  metricsAvailable: boolean
  message: string
}> {
  const apiKey = process.env.BING_WEBMASTER_API_KEY?.trim()
  const settings = await getBlogSettings()
  // Verification is a fact about the site, not an assumption: it is true only
  // once the token is in the settings.
  const verified = Boolean(settings.bingVerification)
  return {
    verified,
    metricsAvailable: Boolean(apiKey),
    message: !verified
      ? "Bing Webmaster Tools is not verified yet — add the verification code in Content Studio settings."
      : apiKey
        ? "Bing Webmaster Tools is connected."
        : "Bing Webmaster Tools is verified, but query metrics need a Bing Webmaster API key, which is not configured.",
  }
}
