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
import type { ResolvedConfig } from "../config.js";
import type { AnalyticsSummaryInput, AnalyticsSummaryResult, AnalyticsTrackInput, AnalyticsTrackResult, AtaiRequestOptions } from "../types.js";
/** The Atai analytics capability. Exposed as `atai.analytics` on the client. */
export declare class AnalyticsCapability {
    private readonly config;
    constructor(config: ResolvedConfig);
    /** Record a batch of product-analytics events (`analytics`/`track`). */
    track(input: AnalyticsTrackInput, options?: AtaiRequestOptions): Promise<AnalyticsTrackResult>;
    /** Read a retention/activity summary for this project (`analytics`/`summary`). */
    summary(input?: AnalyticsSummaryInput, options?: AtaiRequestOptions): Promise<AnalyticsSummaryResult>;
}
//# sourceMappingURL=analytics.d.ts.map