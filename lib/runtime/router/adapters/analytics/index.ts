import "server-only"
import { analyticsAdapter } from "./adapter"
import { registerProviderAdapter } from "@/lib/runtime/router/provider-registry"

/**
 * Atai Runtime — first-party analytics adapter barrel (server-only).
 *
 * @module lib/runtime/router/adapters/analytics
 */

export { analyticsAdapter, ANALYTICS_PROVIDER_ID } from "./adapter"
export {
  ANALYTICS_RETENTION_DAYS,
  AnalyticsTrackInputSchema,
  AnalyticsSummaryInputSchema,
} from "./mapper"
export type {
  AnalyticsTrackResultData,
  AnalyticsSummaryResultData,
  AnalyticsTopEvent,
  AnalyticsDailyBucket,
} from "./mapper"
export { recordEvents, computeSummary } from "./store"

/** Register Atai's first-party analytics provider for its capability+operations. */
export function registerAnalyticsAdapter(): void {
  registerProviderAdapter(analyticsAdapter)
}