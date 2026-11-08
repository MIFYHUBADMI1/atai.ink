import "server-only"
import { computeSummary } from "@/lib/runtime/router/adapters/analytics/store"
import { isAnalyticsInsightsEnabledForUser } from "@/lib/analytics/feature-flags"
import { analyticsConsentEnabled } from "@/lib/analytics/consent"
import { toToolOutcome } from "../errors"
import type { ToolDefinition } from "../types"
import { productAnalyticsSchema } from "../schemas"
import { ownedProject } from "./projects"
import { logger } from "@/lib/logging/logger"

/**
 * Product Analytics READ tool — co-founder insights over the first-party
 * `analytics` runtime capability.
 *
 * Strictly read-only. It reads the SAME project-scoped summary the runtime
 * `analytics.summary` operation computes, but ONLY after three gates pass:
 *   1. the operator flag is on for this founder,
 *   2. the project belongs to the founder (ownedProject), and
 *   3. the founder has explicitly consented for THIS project (default OFF).
 * Consent is never a model input — it lives on the project and is flipped only
 * by the owner through the consent API. No credits, no mutation, no publishing.
 */
export const getProductAnalyticsTool: ToolDefinition = {
  name: "get_product_analytics",
  description:
    "Read first-party product analytics for one of the founder's own projects: events, unique/returning/new visitors, top events, and daily activity that the built application reported through the Atai analytics capability. Requires the founder's explicit per-project permission (off by default) — if it returns CONSENT_REQUIRED, tell the founder how to enable it and do not guess numbers. Use when the founder asks how people are using their app, about retention, or for evidence to suggest improvements. A zero with no events may mean the app isn't instrumented yet, not that nobody uses it.",
  risk: "READ",
  requiresConfirmation: false,
  inputSchema: productAnalyticsSchema,
  async execute(input, ctx) {
    try {
      const parsed = productAnalyticsSchema.parse(input)
      if (!isAnalyticsInsightsEnabledForUser(ctx.user.id)) {
        return {
          success: false,
          error: { code: "FEATURE_DISABLED", message: "Product analytics insights aren't available for this account yet.", fatal: true },
        }
      }
      const project = await ownedProject(ctx, parsed.projectId)
      if (!project) {
        return { success: false, error: { code: "UNAUTHORIZED_PROJECT_ACCESS", message: "I couldn't access that project.", fatal: true } }
      }
      if (!analyticsConsentEnabled(project)) {
        return {
          success: false,
          error: {
            code: "CONSENT_REQUIRED",
            message: `The founder hasn't given permission to read analytics for "${project.name}". They can enable it on the project's Intelligence page (Application intelligence → analytics permission). Ask them to turn it on; don't estimate usage.`,
          },
        }
      }
      const summary = await computeSummary(project.id, parsed.windowDays ?? 30)
      return {
        success: true,
        type: "product_analytics",
        data: {
          projectId: project.id,
          projectName: project.name,
          windowDays: summary.windowDays,
          totalEvents: summary.totalEvents,
          uniqueVisitors: summary.uniqueVisitors,
          returningVisitors: summary.returningVisitors,
          newVisitors: summary.newVisitors,
          topEvents: summary.topEvents,
          daily: summary.daily.slice(-14),
          caveat:
            summary.totalEvents === 0
              ? "No events were recorded in this window. The app may not be instrumented with atai.analytics yet, or it may have had no activity — do not conclude nobody uses it."
              : "Measured only from events the app reported via the Atai analytics capability; visitors are pseudonymous ids, not identified people.",
        },
        navigation: { target: "intelligence", projectId: project.id },
      }
    } catch (e) {
      logger.warn("cofounder.tool.analytics", "product analytics read failed", {
        message: e instanceof Error ? e.message : String(e),
      })
      return toToolOutcome(e, "I couldn't read the product analytics right now.")
    }
  },
}