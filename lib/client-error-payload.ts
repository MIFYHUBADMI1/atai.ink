/**
 * The pure half of the client-error reporter: types, bounds and validation.
 *
 * Kept free of `"use client"` and of `window` so the server route and the
 * boundary share one definition and the parser can be unit-tested without a
 * DOM or a database.
 *
 * @module lib/client-error-payload
 */

export type BoundaryScope = "app" | "business" | "page" | "global"

export const BOUNDARY_SCOPES: readonly BoundaryScope[] = ["app", "business", "page", "global"]

export const LIMITS = {
  message: 500,
  digest: 200,
  stack: 4_000,
  componentStack: 4_000,
  path: 300,
  locale: 40,
  timeZone: 80,
} as const

export interface ClientErrorReport {
  scope: BoundaryScope
  message: string
  digest?: string
  stack?: string
  componentStack?: string
  path?: string
  locale?: string
  timeZone?: string
}

export function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

/** Normalise whatever a boundary was handed into bounded, printable fields. */
export function describeError(error: unknown): { message: string; digest?: string; stack?: string } {
  if (error instanceof Error) {
    const rawDigest = (error as { digest?: unknown }).digest
    const digest = typeof rawDigest === "string" ? clip(rawDigest, LIMITS.digest) : undefined
    const stack = clip(error.stack, LIMITS.stack)
    return {
      message: clip(error.message, LIMITS.message) ?? "Unknown error",
      ...(digest ? { digest } : {}),
      ...(stack ? { stack } : {}),
    }
  }
  if (typeof error === "string") {
    return { message: clip(error, LIMITS.message) ?? "Unknown error" }
  }
  if (error && typeof error === "object") {
    try {
      return { message: clip(JSON.stringify(error), LIMITS.message) ?? "Unknown error" }
    } catch {
      return { message: "Unserialisable error" }
    }
  }
  return { message: "Unknown error" }
}

function optional(body: Record<string, unknown>, key: keyof typeof LIMITS): string | undefined {
  return clip(body[key], LIMITS[key])
}

/**
 * Validate a posted report. Returns `null` for a non-object body; every field is
 * optional except the message, and an unknown scope falls back to `page` so a
 * future boundary cannot be silently dropped.
 */
export function normalizeClientErrorReport(body: unknown): ClientErrorReport | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const input = body as Record<string, unknown>
  const scope =
    typeof input.scope === "string" && (BOUNDARY_SCOPES as readonly string[]).includes(input.scope)
      ? (input.scope as BoundaryScope)
      : "page"
  const report: ClientErrorReport = {
    scope,
    message: clip(input.message, LIMITS.message) ?? "Unknown error",
  }
  const digest = optional(input, "digest")
  const stack = optional(input, "stack")
  const componentStack = optional(input, "componentStack")
  const path = optional(input, "path")
  const locale = optional(input, "locale")
  const timeZone = optional(input, "timeZone")
  if (digest) report.digest = digest
  if (stack) report.stack = stack
  if (componentStack) report.componentStack = componentStack
  if (path) report.path = path
  if (locale) report.locale = locale
  if (timeZone) report.timeZone = timeZone
  return report
}
