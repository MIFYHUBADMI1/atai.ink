import "server-only"
import { z } from "zod"
import type { ProviderExecutionResponse } from "@/runtime/contracts/router"
import type { AnalyticsEventDoc } from "@/lib/types/db"
import { ProviderExecutionError } from "@/lib/runtime/router/adapter"
import {
  MAX_LABEL_CHARS,
  MAX_PATH_CHARS,
  eventNameFor,
  normaliseKind,
  normaliseLabel,
  normalisePath,
  normaliseRole,
  referrerHost,
} from "@/lib/analytics/product/normalize"

/**
 * Atai Runtime — first-party analytics request/response mapper (server-only).
 *
 * Serves `analytics`/`track` and `analytics`/`summary`. Events are scoped to the
 * authenticated project (the trusted project id comes from the runtime context,
 * never from request input). Strict schemas; unknown fields are rejected, and
 * event properties are reduced to bounded scalar app data so credentials or raw
 * payloads can never be persisted.
 *
 * @module lib/runtime/router/adapters/analytics/mapper
 */

/** Events are retained for 90 days, then auto-purged by the TTL index. */
export const ANALYTICS_RETENTION_DAYS = 90

const MAX_EVENTS_PER_REQUEST = 100
const MAX_EVENT_NAME_CHARS = 100
const MAX_VISITOR_ID_CHARS = 200
const MAX_PROPERTY_KEYS = 20
const MAX_PROPERTY_STRING_CHARS = 500
const MAX_PROPERTIES_BYTES = 8 * 1024
/** Client clocks are trusted only within this skew; otherwise server time wins. */
const MAX_PAST_SKEW_MS = 7 * 24 * 60 * 60 * 1000
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

const CREDENTIAL_LIKE_KEY = /(api[_-]?key|token|secret|authorization|password|credential|cookie)/i

const MAX_SESSION_ID_CHARS = 200
const MAX_DURATION_MS = 24 * 60 * 60 * 1000

const EventSchema = z
  .object({
    name: z.string().min(1).max(MAX_EVENT_NAME_CHARS),
    /** page_view | click | page_leave | session_start | conversion | custom */
    kind: z.string().max(32).optional(),
    visitorId: z.string().min(1).max(MAX_VISITOR_ID_CHARS).optional(),
    sessionId: z.string().min(1).max(MAX_SESSION_ID_CHARS).optional(),
    /** Path or full URL; normalised to a grouped route server-side. */
    path: z.string().max(2_000).optional(),
    referrer: z.string().max(2_000).optional(),
    /** Coarse device class; a supplied value is trusted only if recognised. */
    device: z.string().max(16).optional(),
    durationMs: z.number().finite().min(0).max(MAX_DURATION_MS).optional(),
    element: z
      .object({
        role: z.string().max(64).optional(),
        label: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    /** Epoch ms; clamped server-side to a sane window around now. */
    timestamp: z.number().finite().optional(),
  })
  .strict()

export const AnalyticsTrackInputSchema = z
  .object({
    events: z.array(EventSchema).min(1).max(MAX_EVENTS_PER_REQUEST),
  })
  .strict()

export const AnalyticsSummaryInputSchema = z
  .object({
    /** Look-back window in days (1–90). Defaults to 7. */
    windowDays: z.number().int().min(1).max(ANALYTICS_RETENTION_DAYS).optional(),
  })
  .strict()

export type AnalyticsTrackInput = z.infer<typeof AnalyticsTrackInputSchema>
export type AnalyticsSummaryInput = z.infer<typeof AnalyticsSummaryInputSchema>

export interface AnalyticsTrackResultData {
  /** How many events were persisted. */
  accepted: number
}

export interface AnalyticsTopEvent {
  name: string
  count: number
}

export interface AnalyticsDailyBucket {
  /** UTC calendar day (YYYY-MM-DD). */
  date: string
  events: number
  visitors: number
}

export interface AnalyticsSummaryResultData {
  windowDays: number
  /** Start of the window (epoch ms). */
  since: number
  totalEvents: number
  uniqueVisitors: number
  returningVisitors: number
  newVisitors: number
  topEvents: AnalyticsTopEvent[]
  daily: AnalyticsDailyBucket[]
}

function invalidInput(message: string): ProviderExecutionError {
  return new ProviderExecutionError(
    "unsupported_operation",
    "The request body is invalid for this capability.",
    `analytics ${message}`,
  )
}

/** Reduce arbitrary properties to bounded scalar app data (never secrets). */
function sanitizeProperties(
  raw: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!raw) return undefined
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_PROPERTY_KEYS) break
    if (CREDENTIAL_LIKE_KEY.test(key)) continue
    if (typeof value === "string") {
      out[key] = value.slice(0, MAX_PROPERTY_STRING_CHARS)
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value
    } else if (typeof value === "boolean") {
      out[key] = value
    }
    // Objects/arrays/null are dropped — properties stay scalar and bounded.
  }
  if (Object.keys(out).length === 0) return undefined
  if (Buffer.byteLength(JSON.stringify(out), "utf8") > MAX_PROPERTIES_BYTES) {
    throw invalidInput("properties must serialize to at most 8KB")
  }
  return out
}

function clampTimestamp(raw: number | undefined, now: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return now
  if (raw < now - MAX_PAST_SKEW_MS || raw > now + MAX_FUTURE_SKEW_MS) return now
  return Math.round(raw)
}

/**
 * Validate and normalize a track request into persistable documents. The
 * trusted project id and environment come from the authenticated runtime
 * context — a caller can never write events into another project.
 */
export function toAnalyticsEvents(
  input: unknown,
  projectId: string,
  environment: "development" | "production",
  now: number,
): AnalyticsEventDoc[] {
  const parsed = AnalyticsTrackInputSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw invalidInput(
      `track input validation failed: ${issue?.path.join(".") ?? "unknown"} ${issue?.message ?? ""}`.trim(),
    )
  }
  const expiresAt = new Date(now + ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  return parsed.data.events.map((event) => {
    const rawName = event.name.trim()
    if (!rawName) throw invalidInput("event name must not be blank")
    const kind = normaliseKind(event.kind)
    const visitorId = event.visitorId?.trim()
    const sessionId = event.sessionId?.trim()
    const path = normalisePath(event.path)
    const referrer = referrerHost(event.referrer)
    const device =
      event.device === "mobile" || event.device === "tablet" || event.device === "desktop"
        ? event.device
        : undefined
    const role = normaliseRole(event.element?.role)
    const label = normaliseLabel(event.element?.label)
    const properties = sanitizeProperties(event.properties)
    return {
      projectId,
      environment,
      kind,
      name: eventNameFor(kind, rawName).slice(0, MAX_EVENT_NAME_CHARS),
      ...(visitorId ? { visitorId: visitorId.slice(0, MAX_VISITOR_ID_CHARS) } : {}),
      ...(sessionId ? { sessionId: sessionId.slice(0, MAX_SESSION_ID_CHARS) } : {}),
      ...(path ? { path: path.slice(0, MAX_PATH_CHARS) } : {}),
      ...(referrer ? { referrerHost: referrer } : {}),
      ...(device ? { device } : {}),
      ...(event.durationMs !== undefined ? { durationMs: Math.round(event.durationMs) } : {}),
      ...(role || label ? { element: { ...(role ? { role } : {}), ...(label ? { label: label.slice(0, MAX_LABEL_CHARS) } : {}) } } : {}),
      ...(properties ? { properties } : {}),
      timestamp: clampTimestamp(event.timestamp, now),
      recordedAt: now,
      expiresAt,
    }
  })
}

export function parseSummaryWindow(input: unknown): number {
  const parsed = AnalyticsSummaryInputSchema.safeParse(input ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw invalidInput(
      `summary input validation failed: ${issue?.path.join(".") ?? "unknown"} ${issue?.message ?? ""}`.trim(),
    )
  }
  return parsed.data.windowDays ?? 7
}

export function toTrackResult(accepted: number): ProviderExecutionResponse<AnalyticsTrackResultData> {
  return { provider: "atai", data: { accepted } }
}

export function toSummaryResult(
  data: AnalyticsSummaryResultData,
): ProviderExecutionResponse<AnalyticsSummaryResultData> {
  return { provider: "atai", data }
}