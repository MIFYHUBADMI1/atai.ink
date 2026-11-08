import "server-only"
import { logger } from "@/lib/logging/logger"
import type { ProviderExecutionRequest, ProviderExecutionResponse } from "@/runtime/contracts/router"
import { ProviderExecutionError, type RuntimeProviderAdapter } from "@/lib/runtime/router/adapter"
import { parseSummaryWindow, toAnalyticsEvents, toSummaryResult, toTrackResult } from "./mapper"
import { computeSummary, recordEvents } from "./store"

/**
 * Atai Runtime — first-party analytics provider adapter (server-only).
 *
 * Serves the provider-neutral `analytics` capability (`track` and `summary`)
 * against Atai's own MongoDB. The provider id is "atai": this capability has no
 * external upstream — events stay inside atai.ink and are scoped to the
 * authenticated project. Input validation/normalization lives in the mapper;
 * persistence and aggregation live in the store.
 *
 * @module lib/runtime/router/adapters/analytics/adapter
 */

export const ANALYTICS_PROVIDER_ID = "atai"

class AnalyticsAdapter implements RuntimeProviderAdapter {
  readonly provider = ANALYTICS_PROVIDER_ID

  supports(capability: string, operation: string): boolean {
    return capability === "analytics" && (operation === "track" || operation === "summary")
  }

  async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResponse> {
    const startedAt = Date.now()
    const { projectId, environment } = request.auth
    const operation = request.request.operation

    try {
      let response: ProviderExecutionResponse
      if (operation === "track") {
        const events = toAnalyticsEvents(request.request.input, projectId, environment, Date.now())
        const accepted = await recordEvents(events)
        response = toTrackResult(accepted)
      } else {
        const windowDays = parseSummaryWindow(request.request.input)
        const summary = await computeSummary(projectId, windowDays)
        response = toSummaryResult(summary)
      }
      logger.info("runtime.analytics", "provider execution complete", {
        requestId: request.requestId,
        provider: this.provider,
        capability: request.request.capability,
        operation,
        latencyMs: Date.now() - startedAt,
      })
      return response
    } catch (e) {
      // Input-shaped rejections are already normalized (actionable, neutral).
      if (e instanceof ProviderExecutionError) throw e
      // A persistence/aggregation fault is an internal provider error — raw DB
      // detail stays server-side and never crosses the boundary.
      logger.error("runtime.analytics", "analytics execution failed", {
        requestId: request.requestId,
        operation,
        message: e instanceof Error ? e.message : String(e),
      })
      throw new ProviderExecutionError(
        "provider_error",
        "The analytics capability could not complete the request.",
        e instanceof Error ? e.message : String(e),
      )
    }
  }
}

/** The singleton adapter instance registered with the provider registry. */
export const analyticsAdapter = new AnalyticsAdapter()