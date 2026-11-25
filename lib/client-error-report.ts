"use client"

import { LIMITS, clip, describeError, type BoundaryScope, type ClientErrorReport } from "./client-error-payload"

export type { BoundaryScope, ClientErrorReport } from "./client-error-payload"

/**
 * The one way a boundary tells the server it fired.
 *
 * There is no Sentry in this repo, so without this a production failure is an
 * anonymous page. The report is deliberately tiny and boring: bounded strings,
 * no batching, no dependency. It never carries personal data — no IP, no user
 * agent, no email, no cookies. A failed report must never break the boundary,
 * so every call is wrapped and swallowed.
 *
 * @module lib/client-error-report
 */

function environment(): { path?: string; locale?: string; timeZone?: string } {
  if (typeof window === "undefined") return {}
  let timeZone: string | undefined
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    timeZone = undefined
  }
  return {
    path: clip(window.location.pathname, LIMITS.path),
    locale: clip(navigator.language, LIMITS.locale),
    timeZone: clip(timeZone, LIMITS.timeZone),
  }
}

export function buildClientErrorReport(scope: BoundaryScope, error: unknown, componentStack?: string): ClientErrorReport {
  const described = describeError(error)
  const env = environment()
  const component = clip(componentStack, LIMITS.componentStack)
  return {
    scope,
    message: described.message,
    ...(described.digest ? { digest: described.digest } : {}),
    ...(described.stack ? { stack: described.stack } : {}),
    ...(component ? { componentStack: component } : {}),
    ...(env.path ? { path: env.path } : {}),
    ...(env.locale ? { locale: env.locale } : {}),
    ...(env.timeZone ? { timeZone: env.timeZone } : {}),
  }
}

/** Fire-and-forget. `keepalive` lets the report survive the reload the founder
 * is about to press. */
export async function reportClientError(report: ClientErrorReport): Promise<void> {
  try {
    await fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
    })
  } catch {
    // Reporting is best-effort by design.
  }
}
