import "server-only"

import { AppError } from "@/lib/errors"

/**
 * Atai's platform mail provider (Resend).
 *
 * ONE access point for the Resend credential AND the platform sender
 * identity. The sender (`from`) is a PLATFORM decision: no caller can set
 * it, so a generated app or a stored article can never spoof the platform's
 * mail identity.
 *
 * The Runtime capability has its own adapter
 * (lib/runtime/router/adapters/resend) because it maps a tenant-facing
 * request shape; this module is the platform's own transactional and
 * announcement mail.
 */

/** Official Resend API root. Override only for tests (trusted server env). */
export const RESEND_API_BASE = "https://api.resend.com"

export const DEFAULT_RESEND_TIMEOUT_MS = 20_000
const MAX_RESEND_TIMEOUT_MS = 60_000

export function getResendBaseUrl(): string {
  return process.env.RESEND_BASE_URL || RESEND_API_BASE
}

export function getResendApiKey(): string {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new AppError("EMAIL_UNAVAILABLE", "The mail provider is not configured.")
  return key
}

/** The platform sender. Required before any platform mail can be sent. */
export function getResendFromAddress(): string | undefined {
  return process.env.RESEND_FROM_EMAIL || undefined
}

export function getResendTimeoutMs(): number {
  const raw = Number(process.env.RESEND_TIMEOUT_MS)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RESEND_TIMEOUT_MS
  return Math.min(raw, MAX_RESEND_TIMEOUT_MS)
}

/** Configured means "has both a key and a sender" — not "can deliver right now". */
export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && getResendFromAddress())
}

export function resendHeaders(idempotencyKey?: string): Record<string, string> {
  return {
    authorization: `Bearer ${getResendApiKey()}`,
    "content-type": "application/json",
    // Resend deduplicates on this key for 24 hours, so a retried send of the
    // same logical message can never deliver twice.
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  }
}

export interface ResendEmailInput {
  to: string
  subject: string
  html: string
  text?: string
  /** Extra per-message headers (e.g. List-Unsubscribe). */
  headers?: Record<string, string>
  /** Stable key for the same logical message — a retry must not double-send. */
  idempotencyKey?: string
}

export interface ResendSendResult {
  id: string
}

/**
 * Send one message through Resend.
 *
 * Throws `AppError("EMAIL_UNAVAILABLE")` when the provider is unconfigured or
 * rejects the message. The provider's own message is never exposed to a
 * client — callers log it and report an honest outcome.
 */
export async function sendResendEmail(input: ResendEmailInput): Promise<ResendSendResult> {
  const from = getResendFromAddress()
  if (!from) throw new AppError("EMAIL_UNAVAILABLE", "The mail provider is not configured.")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), getResendTimeoutMs())
  try {
    const response = await fetch(`${getResendBaseUrl()}/emails`, {
      method: "POST",
      headers: resendHeaders(input.idempotencyKey),
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
      }),
      signal: controller.signal,
    })
    const payload = (await response.json().catch(() => null)) as { id?: string; message?: string } | null
    if (!response.ok) {
      throw new AppError("EMAIL_UNAVAILABLE", `The mail provider rejected the message: ${payload?.message ?? response.status}`)
    }
    return { id: typeof payload?.id === "string" ? payload.id : "" }
  } finally {
    clearTimeout(timer)
  }
}
