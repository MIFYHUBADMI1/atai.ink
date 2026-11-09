import { describe, expect, it } from "vitest"
import {
  costStatusFromProviderCost,
  deriveCostStatus,
  deriveCostCurrency,
} from "./cost-status"

/**
 * Phase 2 — provider-cost status vocabulary (pure, no Mongo, no providers).
 * Core honesty rules under test: missing is NEVER zero; an unlabeled numeric
 * amount is never silently called USD; legacy rows derive status at read time.
 */

describe("costStatusFromProviderCost (write-time)", () => {
  it("confirms a provider-reported numeric amount", () => {
    expect(costStatusFromProviderCost({ amount: 0.0123, source: "provider_reported" })).toBe("confirmed")
  })

  it("marks provider_estimated as estimated (reserved — no adapter emits it today)", () => {
    expect(costStatusFromProviderCost({ amount: 1, source: "provider_estimated" })).toBe("estimated")
  })

  it("source unavailable → unavailable even if an amount leaked in", () => {
    expect(costStatusFromProviderCost({ amount: 5, source: "unavailable" })).toBe("unavailable")
  })

  it("missing / non-finite amount → unavailable, never 0-coerced", () => {
    expect(costStatusFromProviderCost({ source: "provider_reported" })).toBe("unavailable")
    expect(costStatusFromProviderCost({ amount: NaN, source: "provider_reported" })).toBe("unavailable")
    expect(costStatusFromProviderCost({ amount: Infinity, source: "provider_reported" })).toBe("unavailable")
  })
})

describe("deriveCostStatus (read-time, incl. pre-Phase-2 rows)", () => {
  it("an explicit persisted status is authoritative", () => {
    expect(deriveCostStatus({ costStatus: "confirmed", providerCost: 0.1 })).toBe("confirmed")
    expect(deriveCostStatus({ costStatus: "not_applicable" })).toBe("not_applicable")
    expect(deriveCostStatus({ costStatus: "unavailable", providerCost: 9 })).toBe("unavailable")
  })

  it("invalid persisted status strings fall through to derivation", () => {
    expect(deriveCostStatus({ costStatus: "garbage", providerCost: 0.2 })).toBe("confirmed")
  })

  it("legacy numeric row without a status → confirmed (only reported amounts were ever written)", () => {
    expect(deriveCostStatus({ providerCost: 0.048, providerCostSource: "provider_reported" })).toBe("confirmed")
    expect(deriveCostStatus({ providerCost: 0.048 })).toBe("confirmed")
  })

  it("legacy numeric row with provider_estimated source → estimated", () => {
    expect(deriveCostStatus({ providerCost: 2, providerCostSource: "provider_estimated" })).toBe("estimated")
  })

  it("missing metadata / null providerCost / non-numeric → unavailable", () => {
    expect(deriveCostStatus(undefined)).toBe("unavailable")
    expect(deriveCostStatus(null)).toBe("unavailable")
    expect(deriveCostStatus({})).toBe("unavailable")
    expect(deriveCostStatus({ providerCost: null })).toBe("unavailable")
    // Non-monetary units (Firecrawl creditsUsed, ElevenLabs characters) must
    // NOT be mistaken for money even if mis-persisted as a string.
    expect(deriveCostStatus({ providerCost: "12 credits" })).toBe("unavailable")
  })
})

describe("deriveCostCurrency", () => {
  it("returns the labeled currency uppercased for a numeric cost", () => {
    expect(deriveCostCurrency({ providerCost: 0.01, providerCostCurrency: "usd" })).toBe("USD")
    expect(deriveCostCurrency({ providerCost: 5, providerCostCurrency: "UGX" })).toBe("UGX")
  })

  it("numeric cost WITHOUT a currency label is 'unknown' — never assumed USD", () => {
    expect(deriveCostCurrency({ providerCost: 0.01 })).toBe("unknown")
    expect(deriveCostCurrency({ providerCost: 0.01, providerCostCurrency: "" })).toBe("unknown")
  })

  it("no numeric cost → null (no currency applies)", () => {
    expect(deriveCostCurrency(undefined)).toBeNull()
    expect(deriveCostCurrency({ providerCostCurrency: "USD" })).toBeNull()
    expect(deriveCostCurrency({ providerCost: null, providerCostCurrency: "USD" })).toBeNull()
  })
})
