import { describe, expect, it } from "vitest"
import { netPosition } from "./net-position"

describe("netPosition — money minus money, or nothing at all", () => {
  it("nets USD earnings against USD provider cost", () => {
    expect(netPosition({ earningsMinor: 100_000, providerCostUsd: 250.25, currencies: ["USD"] })).toEqual({
      minor: 74_975,
      currency: "USD",
      reason: null,
    })
  })

  it("reports a negative position rather than clamping it to zero", () => {
    const out = netPosition({ earningsMinor: 100, providerCostUsd: 5, currencies: ["USD"] })
    expect(out.minor).toBe(-400)
    expect(out.reason).toBeNull()
  })

  it("refuses to invent an exchange rate for another currency", () => {
    const out = netPosition({ earningsMinor: 1_000_000, providerCostUsd: 5, currencies: ["UGX"] })
    expect(out.minor).toBeNull()
    expect(out.reason).toContain("UGX")
    expect(out.reason).toContain("would invent a rate")
  })

  it("refuses to mix several currencies", () => {
    const out = netPosition({ earningsMinor: 1000, providerCostUsd: 5, currencies: ["USD", "EUR"] })
    expect(out.minor).toBeNull()
    expect(out.reason).toContain("USD, EUR")
  })

  it("states why when earnings have not been reported", () => {
    expect(netPosition({ earningsMinor: null, providerCostUsd: 5, currencies: [] }).reason).toContain(
      "has not reported earnings",
    )
  })

  it("states why when no payment arrived", () => {
    expect(netPosition({ earningsMinor: 0, providerCostUsd: 5, currencies: [] }).reason).toContain(
      "No payments arrived",
    )
  })

  it("states why when no call carried a numeric provider cost", () => {
    expect(netPosition({ earningsMinor: 1000, providerCostUsd: null, currencies: ["USD"] }).reason).toContain(
      "reported a numeric provider cost",
    )
  })
})
