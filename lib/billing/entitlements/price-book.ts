/**
 * Atai — Published price book (Phase A1).
 *
 * Monetary values are stored and compared in INTEGER MINOR UNITS (USD cents).
 * The catalog's display values (`PLAN_PRICING`, `LEGACY_SUBSCRIPTION_PLANS`)
 * remain the customer-facing source; this table freezes the same amounts as
 * integers so a subscription can pin the price it actually paid without a
 * floating-point calculation at activation or renewal time.
 *
 * A price change publishes a NEW `PRICE_BOOK_VERSION`; existing subscriptions
 * keep the version they purchased.
 *
 * @module lib/billing/entitlements/price-book
 */

import type { BillingInterval } from "@/lib/billing/billing-types"

export const PRICE_BOOK_VERSION = "PRICE_BOOK_V1"
/**
 * Marker for a price reconstructed from a pre-versioning subscription record.
 * It is a real published version (seeded by `versions.ts`) whose entries are
 * empty because the original purchase predates the price book; the amount is
 * taken from the record's own stored `priceUSD`.
 */
export const PRICE_BOOK_PRE_VERSIONING = "PRICE_BOOK_PRE_VERSIONING"
export const PRICE_BOOK_CURRENCY = "USD"

/** Commercial five-plan catalog, integer cents. Mirrors PLAN_PRICING. */
export const COMMERCIAL_PRICE_BOOK_MINOR: Record<string, Record<BillingInterval, number | null>> = {
  explorer: { monthly: 0, annual: 0 },
  starter: { monthly: 8_999, annual: 98_989 },
  growth: { monthly: 19_999, annual: 219_989 },
  scale: { monthly: 49_999, annual: 549_989 },
  enterprise: { monthly: null, annual: null },
}

/** Legacy six-plan catalog, integer cents. Mirrors LEGACY_SUBSCRIPTION_PLANS. */
export const LEGACY_PRICE_BOOK_MINOR: Record<string, number> = {
  free: 0,
  explorer: 1_200,
  starter: 7_900,
  business: 13_900,
  professional: 21_900,
  enterprise: 49_900,
}

/**
 * Boundary conversion for a legacy USD value stored before the price book
 * existed. Decimal-string formatting (not float arithmetic) keeps the result
 * exact for the values this catalog contains.
 */
export function legacyUsdToMinorUnits(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  const [whole, fraction = ""] = value.toFixed(2).split(".")
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2))
}

/** Price for a commercial plan + interval, or undefined when not published. */
export function commercialPriceMinor(
  planId: string,
  interval: BillingInterval,
): number | undefined {
  return COMMERCIAL_PRICE_BOOK_MINOR[planId]?.[interval] ?? undefined
}

/** Price for a legacy plan, or undefined when the id is unknown. */
export function legacyPriceMinor(planId: string): number | undefined {
  return LEGACY_PRICE_BOOK_MINOR[planId]
}
