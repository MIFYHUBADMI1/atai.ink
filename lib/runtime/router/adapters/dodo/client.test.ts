import "server-only"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { ProviderExecutionError } from "@/lib/runtime/router/adapter"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const providerFetch = vi.fn()
vi.mock("../shared/http", () => ({
  providerFetch: (opts: unknown) => providerFetch(opts),
  boundedTimeoutMs: () => 30_000,
}))
vi.mock("../shared/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/errors")>()
  return {
    ...actual,
    categoryForStatus: () => "provider_error",
    isAlreadyNormalized: (e: unknown) => e instanceof ProviderExecutionError,
  }
})

import { executeCreateCheckout } from "./client"

// dodoHeaders() resolves the credential at call time; tests never read .env.
process.env.DODO_PAYMENTS_API_KEY = "test-dodo-key"

const connectTimeout = () => {
  const e = new ProviderExecutionError("provider_unavailable", "The provider is temporarily unavailable.")
  e.networkCauseCode = "UND_ERR_CONNECT_TIMEOUT"
  return e
}

const okCheckout = {
  status: 200,
  ok: true,
  statusText: "OK",
  // Live Dodo shape (verified 2026-10-26): session_id, no status field.
  text: JSON.stringify({ session_id: "cks_1", checkout_url: "https://checkout.test/1" }),
}

const checkoutBody = { product_cart: [{ product_id: "pdt_1", quantity: 1 }] }

beforeEach(() => providerFetch.mockReset())

describe("dodo client — connect-setup retry (never-delivered requests only)", () => {
  it("retries once when the TCP/TLS connect never completed", async () => {
    providerFetch
      .mockRejectedValueOnce(connectTimeout())
      .mockResolvedValueOnce(okCheckout)
    const res = await executeCreateCheckout({ body: checkoutBody })
    expect(res.checkoutId).toBe("cks_1")
    expect(res.status).toBe("pending")
    expect(providerFetch).toHaveBeenCalledTimes(2)
  })

  it("does NOT retry post-connect faults (delivery status unknown → §45 no double side effect)", async () => {
    providerFetch.mockRejectedValueOnce(new ProviderExecutionError("provider_unavailable", "down"))
    await expect(executeCreateCheckout({ body: checkoutBody })).rejects.toThrow(ProviderExecutionError)
    expect(providerFetch).toHaveBeenCalledTimes(1)
  })

  it("gives up after one bounded retry attempt", async () => {
    providerFetch.mockRejectedValueOnce(connectTimeout()).mockRejectedValueOnce(connectTimeout())
    await expect(executeCreateCheckout({ body: checkoutBody })).rejects.toThrow(ProviderExecutionError)
    expect(providerFetch).toHaveBeenCalledTimes(2)
  })
})
