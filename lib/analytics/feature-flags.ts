import "server-only"
import { createHash } from "crypto"

/**
 * Operator flag for co-founder product-analytics insights.
 *
 * Same convention as lib/marketing/feature-flags.ts (plain process.env reads +
 * deterministic percent rollout keyed on a hash of the user id). This surface
 * ships in this phase, so the default is ON; ANALYTICS_INSIGHTS_ENABLED=false
 * is the kill switch. When off, the `get_product_analytics` tool refuses and
 * the Intelligence page renders exactly as before (no consent card).
 *
 * This flag gates CAPABILITY REACHABILITY only. The actual permission is the
 * founder's per-project consent (MirrorProject.analyticsConsent, default OFF)
 * — both must pass before any analytics summary is read.
 */
export function isAnalyticsInsightsEnabledForUser(userId: string): boolean {
  const hard = process.env.ANALYTICS_INSIGHTS_ENABLED
  if (hard === "false" || hard === "0") return false
  if (hard === "true" || hard === "1") return true

  const raw = process.env.ANALYTICS_INSIGHTS_ROLLOUT_PERCENT
  const percent = raw === undefined ? 100 : clampPercent(parseInt(raw, 10))
  if (percent >= 100) return true
  if (percent <= 0) return false

  const bucket = createHash("sha256").update(`analytics-insights:${userId}`).digest().readUInt32BE(0) % 100
  return bucket < percent
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}