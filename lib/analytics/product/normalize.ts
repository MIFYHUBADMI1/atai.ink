/**
 * Product analytics — pure normalisation rules.
 *
 * Both entry points into `analytics_events` use these: the key-authenticated
 * runtime (`analytics`/`track`, for server code and the SDK) and the public
 * collector (`/api/analytics/collect`, for a browser snippet installed in an
 * app we do not host). Two entry points, one set of rules — otherwise a page
 * path captured in the browser would never group with the same path captured
 * server-side, and every read would quietly under-count.
 *
 * Nothing here touches a database, a request, or a provider: it is pure, so the
 * grouping rules can be tested without either entry point existing.
 */

/** Event kinds the product surfaces know how to read. Anything else is `custom`. */
export const PRODUCT_EVENT_KINDS = [
  "page_view",
  "click",
  "page_leave",
  "session_start",
  "conversion",
  "custom",
] as const

export type ProductEventKind = (typeof PRODUCT_EVENT_KINDS)[number]

export const MAX_PATH_CHARS = 300
export const MAX_LABEL_CHARS = 80
export const MAX_ROLE_CHARS = 32
export const MAX_REFERRER_CHARS = 200

export type DeviceKind = "mobile" | "tablet" | "desktop"

/**
 * A path is grouped by its shape, not its ids: `/orders/12345` and
 * `/orders/98765` are one page in every funnel that matters, and grouping them
 * separately is what makes "top pages" a list of one-off strings.
 */
const NUMERIC_SEGMENT = /^\d+$/
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_ID_SEGMENT = /^[0-9a-f]{16,}$/i
const OPAQUE_ID_SEGMENT = /^[A-Za-z0-9_-]{24,}$/

/** Strip origin, query and hash, then collapse id-shaped segments. */
export function normalisePath(raw?: string | null): string | undefined {
  if (!raw) return undefined
  let value = raw.trim()
  if (!value) return undefined

  // Accept a full URL as well as a path — the browser snippet may send either.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname
    } catch {
      return undefined
    }
  }

  value = value.split("#")[0] ?? value
  value = value.split("?")[0] ?? value
  if (!value.startsWith("/")) value = `/${value}`

  const segments = value.split("/").map((segment) => {
    if (!segment) return segment
    if (NUMERIC_SEGMENT.test(segment) || UUID_SEGMENT.test(segment) || HEX_ID_SEGMENT.test(segment)) return ":id"
    if (OPAQUE_ID_SEGMENT.test(segment)) return ":id"
    return segment.slice(0, 60)
  })

  const normalised = segments.join("/").replace(/\/{2,}/g, "/")
  return normalised.slice(0, MAX_PATH_CHARS)
}

/** A click label is what a person would call the thing they pressed. */
export function normaliseLabel(raw?: string | null): string | undefined {
  if (!raw) return undefined
  const collapsed = raw.replace(/\s+/g, " ").trim()
  if (!collapsed) return undefined
  return collapsed.slice(0, MAX_LABEL_CHARS)
}

export function normaliseRole(raw?: string | null): string | undefined {
  if (!raw) return undefined
  const collapsed = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "")
  if (!collapsed) return undefined
  return collapsed.slice(0, MAX_ROLE_CHARS)
}

/**
 * Traffic we must not measure. A monitor, a link preview or a crawler is not a
 * customer, and counting it as one inflates every number the founder is asked
 * to act on.
 */
const BOT_UA =
  /(bot\b|crawler|spider|crawling|headlesschrome|phantomjs|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|embedly|pinterest|curl\/|wget\/|python-requests|python-urllib|node-fetch|axios\/|go-http-client|okhttp|java\/|apache-httpclient|libwww-perl|monitor|uptime|pingdom|site24x7|lighthouse|pagespeed)/i

export function isBotUserAgent(userAgent?: string | null): boolean {
  if (!userAgent) return false
  return BOT_UA.test(userAgent)
}

/** Coarse device class only — never a device model, never a fingerprint. */
export function inferDevice(userAgent?: string | null): DeviceKind | undefined {
  if (!userAgent) return undefined
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(userAgent)) return "tablet"
  if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(userAgent)) return "mobile"
  if (/mozilla|chrome|safari|firefox|edg\//i.test(userAgent)) return "desktop"
  return undefined
}

/** Referrer host only: a full referring URL can carry another site's query data. */
export function referrerHost(raw?: string | null): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return url.hostname.toLowerCase().slice(0, MAX_REFERRER_CHARS)
  } catch {
    return undefined
  }
}

/** A kind we do not recognise is a custom event, never a dropped one. */
export function normaliseKind(raw?: string | null): ProductEventKind {
  if (!raw) return "custom"
  const value = raw.trim().toLowerCase()
  return (PRODUCT_EVENT_KINDS as readonly string[]).includes(value) ? (value as ProductEventKind) : "custom"
}

/**
 * Page views and clicks are named by their kind so every reader can group by
 * `name` without special-casing the collector's output. A custom event keeps
 * the app's own name.
 */
export function eventNameFor(kind: ProductEventKind, rawName?: string | null): string {
  const name = rawName?.trim()
  if (kind === "custom" || kind === "conversion") return (name || kind).slice(0, 100)
  return kind
}
