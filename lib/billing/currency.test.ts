import { afterEach, describe, expect, it, vi } from "vitest"
import { detectCountryFromRequest } from "./currency"

/**
 * The geo lookup interpolates the first `x-forwarded-for` hop into an external
 * URL. That header is caller-controlled, so only syntactically valid IPs may
 * reach the request path.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("detectCountryFromRequest", () => {
  it("never interpolates a malformed forwarded value into the lookup URL", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const country = await detectCountryFromRequest(new Request("http://localhost", {
      headers: { "x-forwarded-for": "evil.example.com/steal?x=" },
    }))

    expect(country).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("looks up a syntactically valid forwarded IP", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ countryCode: "de" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const country = await detectCountryFromRequest(new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    }))

    expect(fetchMock).toHaveBeenCalledWith(
      "http://ip-api.com/json/203.0.113.9?fields=countryCode",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(country).toBe("DE")
  })

  it("prefers the edge country header over the lookup", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const country = await detectCountryFromRequest(new Request("http://localhost", {
      headers: { "cf-ipcountry": "gb", "x-forwarded-for": "203.0.113.9" },
    }))

    expect(country).toBe("GB")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
