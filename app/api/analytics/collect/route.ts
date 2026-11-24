import "server-only"

import { checkRateLimit } from "@/lib/auth/rate-limit"
import { handleRouteError } from "@/lib/api/respond"
import { findActiveApiKeyBySecret } from "@/lib/runtime/keys/service"
import { toAnalyticsEvents } from "@/lib/runtime/router/adapters/analytics/mapper"
import { recordEvents } from "@/lib/runtime/router/adapters/analytics/store"
import { isBotUserAgent } from "@/lib/analytics/product/normalize"

/**
 * Public analytics collector.
 *
 * This is how an app Atai does not host — a connected business, or a build the
 * founder already runs somewhere — reports what its visitors actually do. The
 * snippet in `public/atai-analytics.js` posts here with a **publishable** key.
 *
 * The trust model, in order:
 *   1. A publishable key identifies the project and nothing else. It carries
 *      the single `analytics` scope, so a key lifted from a page source can
 *      only append events — it cannot read a summary, call a provider or spend
 *      a credit. A secret key is refused here outright.
 *   2. The project id and environment come from the key record, never from the
 *      body, so a caller cannot write into another project.
 *   3. Bots are dropped silently (a crawler is not a customer). Nothing is
 *      stored that could identify a person: no IP, no user agent, no cookie.
 *   4. The response is always `accepted` — the browser has already moved on.
 */

const MAX_BODY_BYTES = 256 * 1024

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
  "cache-control": "no-store",
} as const

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS })
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

interface CollectBody {
  key?: unknown
  events?: unknown
}

function bearerKey(req: Request): string | null {
  const header = req.headers.get("authorization")
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() || null
}

function clientIdentifier(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  const first = forwarded?.split(",")[0]?.trim()
  return first || req.headers.get("x-real-ip") || "unknown"
}

export async function POST(req: Request): Promise<Response> {
  try {
    // A crawler, a monitor or a link preview is not a visitor. Answer politely
    // and store nothing.
    if (isBotUserAgent(req.headers.get("user-agent"))) {
      return json({ ok: true, data: { accepted: 0, skipped: "bot" } })
    }

    const contentLength = Number(req.headers.get("content-length") ?? "0")
    if (contentLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: { code: "VALIDATION", message: "Batch too large." } }, 413)
    }

    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) {
      return json({ ok: false, error: { code: "VALIDATION", message: "Batch too large." } }, 413)
    }

    let body: CollectBody
    try {
      body = JSON.parse(raw) as CollectBody
    } catch {
      return json({ ok: false, error: { code: "VALIDATION", message: "A JSON body is required." } }, 422)
    }
    if (!body || typeof body !== "object") {
      return json({ ok: false, error: { code: "VALIDATION", message: "A JSON body is required." } }, 422)
    }

    // sendBeacon cannot set an Authorization header, so the key may travel in
    // the body. Either way it is the only thing that decides the project.
    const presented = bearerKey(req) ?? (typeof body.key === "string" ? body.key : null)
    if (!presented) {
      return json({ ok: false, error: { code: "UNAUTHORIZED", message: "A publishable key is required." } }, 401)
    }

    const key = await findActiveApiKeyBySecret(presented)
    // Same answer for "no such key", "revoked" and "this is a secret key":
    // a public endpoint must not tell an attacker which one it was.
    if (!key || key.kind !== "publishable") {
      return json({ ok: false, error: { code: "UNAUTHORIZED", message: "This key cannot record events." } }, 401)
    }

    try {
      await checkRateLimit({
        action: "analytics_collect",
        identifier: `${key.id}:${clientIdentifier(req)}`,
        limit: 240,
        windowMs: 60_000,
      })
    } catch {
      return json({ ok: false, error: { code: "RATE_LIMITED", message: "Slow down." } }, 429)
    }

    // The normaliser is the one schema both entry points share. Its rejections
    // are input-shaped by construction, so a bad batch is a 422 the snippet
    // drops — never a 500 the app it is installed in has to think about.
    let events
    try {
      events = await toAnalyticsEvents({ events: body.events }, key.projectId, key.environment, Date.now())
    } catch {
      return json({ ok: false, error: { code: "VALIDATION", message: "This batch is not valid." } }, 422)
    }

    const accepted = await recordEvents(events)
    return json({ ok: true, data: { accepted } })
  } catch (e) {
    // A collector must never break the app it is installed in. Anything the
    // normaliser rejects is a 422 the snippet drops; anything else is logged.
    const response = handleRouteError("api.analytics.collect", e)
    response.headers.set("access-control-allow-origin", "*")
    return response
  }
}
