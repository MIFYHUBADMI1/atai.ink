import { afterEach, describe, expect, it, vi } from "vitest"
import type { RuntimeProviderAdapter } from "./adapter"
import {
  clearProviderAdapters,
  listProviders,
  registerProviderAdapter,
  resolveProviderAdapter,
} from "./provider-registry"

vi.mock("server-only", () => ({}))

function fakeAdapter(provider: string, capability = "maps"): RuntimeProviderAdapter {
  return {
    provider,
    supports: (c, op) => c === capability && op === "geocode",
    execute: async () => ({ provider, data: {} }),
  }
}

afterEach(() => clearProviderAdapters())

describe("provider-registry — registration idempotence", () => {
  it("ignores a repeated registration of the SAME adapter instance", () => {
    const adapter = fakeAdapter("mapbox")
    registerProviderAdapter(adapter)
    registerProviderAdapter(adapter)
    registerProviderAdapter(adapter)
    expect(listProviders()).toEqual(["mapbox"])
  })

  it("keeps provider metadata free of duplicate names across instances", () => {
    registerProviderAdapter(fakeAdapter("dodo"))
    registerProviderAdapter(fakeAdapter("dodo"))
    expect(listProviders()).toEqual(["dodo"])
  })

  it("preserves first-registered-wins resolution order", () => {
    const first = fakeAdapter("mapbox")
    const second = fakeAdapter("here")
    registerProviderAdapter(first)
    registerProviderAdapter(second)
    expect(resolveProviderAdapter("maps", "geocode")?.provider).toBe("mapbox")
  })

  it("allows an instance to be registered again after a clear", () => {
    const adapter = fakeAdapter("mapbox")
    registerProviderAdapter(adapter)
    clearProviderAdapters()
    registerProviderAdapter(adapter)
    expect(resolveProviderAdapter("maps", "geocode")).toBe(adapter)
  })
})
