import "server-only"

import { checkRateLimit } from "@/lib/auth/rate-limit"
import { readJsonBody } from "@/lib/api/request-body"
import { normalizeClientErrorReport } from "@/lib/client-error-payload"
import { logger } from "@/lib/logging/logger"

/**
 * The one place a client boundary can report what it caught.
 *
 * This is deliberately anonymous: it accepts no session, stores nothing, and
 * never records an IP, user agent, email or cookie. The IP is used only as the
 * rate-limit key and then discarded — the same rule as the public analytics
 * collector. Everything is bounded and truncated before it is logged, and a
 * malformed report is a quiet no-op rather than an error the browser sees.
 *
 * The single log line carries `reason` and `digest`; the digest is the string
 * the founder sees as "Reference", so support can join the two.
 */

const MAX_BODY_BYTES = 16 * 1024

function clientIdentifier(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  const first = forwarded?.split(",")[0]?.trim()
  return first || req.headers.get("x-real-ip") || "unknown"
}

function accepted(): Response {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } })
}

export async function POST(req: Request): Promise<Response> {
  try {
    // Generous enough for a broken page that keeps retrying, tight enough that
    // the endpoint cannot be used to flood the logs. A refusal is silent.
    try {
      await checkRateLimit({ action: "client_error", identifier: clientIdentifier(req), limit: 30, windowMs: 60_000 })
    } catch {
      return accepted()
    }

    const body = await readJsonBody(req, MAX_BODY_BYTES).catch(() => null)
    const report = normalizeClientErrorReport(body)
    if (!report) return accepted()

    logger.error("client_error", "a client boundary caught an error", {
      reason: report.message,
      scope: report.scope,
      digest: report.digest,
      path: report.path,
      locale: report.locale,
      timeZone: report.timeZone,
      stack: report.stack,
      componentStack: report.componentStack,
    })

    return accepted()
  } catch {
    // A reporter must never surface a failure of its own.
    return accepted()
  }
}
