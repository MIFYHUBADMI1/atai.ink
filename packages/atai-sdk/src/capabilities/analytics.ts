/**
 * Atai SDK — Analytics capability.
 *
 * Provider-neutral product analytics (`analytics`/`track`, `analytics`/`summary`).
 * Events are scoped to the project behind the API key and stay inside Atai — the
 * application never learns which storage runs behind the runtime, and no
 * third-party analytics key is ever needed.
 *
 * @module capabilities/analytics
 */

import { AtaiError } from "../errors.js"
import { execute } from "../transport.js"
import type { ResolvedConfig } from "../config.js"
import type {
  AnalyticsSummaryInput,
  AnalyticsSummaryResult,
  AnalyticsTrackInput,
  AnalyticsTrackResult,
  AtaiRequestOptions,
} from "../types.js"

/** Client-side validation (developer experience only; the server is authoritative). */
function validateTrackInput(input: AnalyticsTrackInput): void {
  if (input === null || typeof input !== "object" || !Array.isArray(input.events) || input.events.length === 0) {
    throw new AtaiError("atai_invalid_request", "Analytics track requires a non-empty `events` array.")
  }
  for (const event of input.events) {
    if (event === null || typeof event !== "object" || typeof event.name !== "string" || event.name.trim().length === 0) {
      throw new AtaiError("atai_invalid_request", "Each analytics event requires a non-empty `name`.")
    }
  }
}

/** The Atai analytics capability. Exposed as `atai.analytics` on the client. */
export class AnalyticsCapability {
  constructor(private readonly config: ResolvedConfig) {}

  /** Record a batch of product-analytics events (`analytics`/`track`). */
  async track(input: AnalyticsTrackInput, options?: AtaiRequestOptions): Promise<AnalyticsTrackResult> {
    validateTrackInput(input)

    const body = {
      capability: "analytics",
      operation: "track",
      input: {
        events: input.events.map((event) => ({
          name: event.name,
          ...(event.visitorId !== undefined ? { visitorId: event.visitorId } : {}),
          ...(event.properties !== undefined ? { properties: event.properties } : {}),
          ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
        })),
      },
    }

    const { envelope } = await execute<typeof body, AnalyticsTrackResult>(this.config, {
      path: "",
      method: "POST",
      body,
      options,
    })

    return assertTrackResult(envelope.data.data)
  }

  /** Read a retention/activity summary for this project (`analytics`/`summary`). */
  async summary(input?: AnalyticsSummaryInput, options?: AtaiRequestOptions): Promise<AnalyticsSummaryResult> {
    const body = {
      capability: "analytics",
      operation: "summary",
      input: {
        ...(input?.windowDays !== undefined ? { windowDays: input.windowDays } : {}),
      },
    }

    const { envelope } = await execute<typeof body, AnalyticsSummaryResult>(this.config, {
      path: "",
      method: "POST",
      body,
      options,
    })

    return assertSummaryResult(envelope.data.data)
  }
}

/** Narrow runtime check on the returned payload (server responses are never trusted blindly). */
function assertTrackResult(payload: unknown): AnalyticsTrackResult {
  const p = payload as Record<string, unknown> | null
  if (typeof p !== "object" || p === null || typeof p.accepted !== "number") {
    throw new AtaiError("atai_invalid_response", "The Atai Runtime API returned an unexpected response shape.")
  }
  return payload as unknown as AnalyticsTrackResult
}

function assertSummaryResult(payload: unknown): AnalyticsSummaryResult {
  const p = payload as Record<string, unknown> | null
  const valid =
    typeof p === "object" &&
    p !== null &&
    typeof p.windowDays === "number" &&
    typeof p.totalEvents === "number" &&
    typeof p.uniqueVisitors === "number" &&
    typeof p.returningVisitors === "number" &&
    typeof p.newVisitors === "number" &&
    Array.isArray(p.topEvents) &&
    Array.isArray(p.daily)
  if (!valid) {
    throw new AtaiError("atai_invalid_response", "The Atai Runtime API returned an unexpected response shape.")
  }
  return payload as unknown as AnalyticsSummaryResult
}