import { describe, it, expect } from "vitest"
import { InMemoryEntitlementCache } from "./cache"
import { buildEntitlementSet } from "./catalog"

const set = buildEntitlementSet("explorer", { businesses: 0, productionApps: 0, subdomains: 0, customDomainsConsumed: 0 })

describe("EntitlementCache (ADR-8)", () => {
  it("stores and returns a set within TTL", () => {
    const cache = new InMemoryEntitlementCache(60_000)
    cache.set("u:1", set)
    expect(cache.get("u:1")).toBe(set)
  })

  it("drops expired entries", () => {
    const cache = new InMemoryEntitlementCache(-1) // already expired
    cache.set("u:1", set)
    expect(cache.get("u:1")).toBeUndefined()
  })

  it("invalidates a single key and clears all", () => {
    const cache = new InMemoryEntitlementCache(60_000)
    cache.set("u:1", set)
    cache.set("u:2", set)
    cache.invalidate("u:1")
    expect(cache.get("u:1")).toBeUndefined()
    expect(cache.get("u:2")).toBe(set)
    cache.invalidateAll()
    expect(cache.get("u:2")).toBeUndefined()
  })
})
