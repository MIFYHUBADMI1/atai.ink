/**
 * Net position in a single currency.
 *
 * Attributed earnings arrive as money in whatever currency the buyer paid;
 * runtime spend is recorded in credits. Credits have no one cash value (packs
 * sell 200k for $59 and 500k for $119), so subtracting them from earnings
 * produces a number in no unit at all. The only defensible net is money minus
 * money: earnings less what the model providers charged, and only when both
 * sides are denominated the same way.
 *
 * @module lib/finances/net-position
 */

export interface NetPosition {
  /** Minor units of `currency`; null whenever no honest net exists. */
  minor: number | null
  currency: string | null
  /** Why there is no figure — shown instead of a fabricated number. */
  reason: string | null
}

export interface NetPositionInput {
  /** Attributed earnings, minor units; null when the feed hasn't reported. */
  earningsMinor: number | null
  /** USD the providers reported; null when no call carried a numeric cost. */
  providerCostUsd: number | null
  /** Distinct currencies seen among attributed payments. */
  currencies: string[]
}

export function netPosition(input: NetPositionInput): NetPosition {
  const { earningsMinor, providerCostUsd, currencies } = input

  if (earningsMinor === null) {
    return { minor: null, currency: null, reason: "The payment provider has not reported earnings for this window." }
  }
  if (currencies.length === 0) {
    return { minor: null, currency: null, reason: "No payments arrived in this window." }
  }
  if (currencies.length > 1) {
    return {
      minor: null,
      currency: null,
      reason: `Payments arrived in ${currencies.length} currencies (${currencies.join(", ")}) and no conversion is approved.`,
    }
  }
  const currency = currencies[0]
  if (currency !== "USD") {
    return {
      minor: null,
      currency: null,
      reason: `Earnings arrived in ${currency} while provider costs are reported in USD — converting them would invent a rate.`,
    }
  }
  if (providerCostUsd === null) {
    return { minor: null, currency: null, reason: "None of these calls reported a numeric provider cost." }
  }

  return {
    minor: Math.round(earningsMinor - providerCostUsd * 100),
    currency: "USD",
    reason: null,
  }
}
