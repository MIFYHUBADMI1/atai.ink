import { describe, expect, it } from "vitest"
import {
  aiTimeoutUserMessage,
  describeErrorChain,
  isAbortTimeoutError,
  isDatabaseConnectivityError,
  isProviderUnreachableError,
  isTlsClockError,
  providerUnreachableUserMessage,
  tlsClockUserMessage,
} from "@/lib/api/upstream-error"

describe("upstream error classification", () => {
  it("detects TLS not-yet-valid as a clock/certificate problem", () => {
    expect(isTlsClockError(new Error("Cannot connect to API: certificate is not yet valid"))).toBe(true)
    expect(isTlsClockError(new Error("Failed after 3 attempts. Last error: AI_APICallError: certificate is not yet valid"))).toBe(
      true,
    )
    expect(isTlsClockError(new Error("rate limited"))).toBe(false)
  })

  it("detects Mongo timeouts as database connectivity", () => {
    expect(
      isDatabaseConnectivityError(new Error("connection <monitor> to 159.41.207.169:27017 timed out")),
    ).toBe(true)
    expect(isTlsClockError(new Error("connection <monitor> to 159.41.207.169:27017 timed out"))).toBe(false)
  })

  it("explains the clock fix without leaking internals", () => {
    expect(tlsClockUserMessage()).toMatch(/clock/i)
    expect(tlsClockUserMessage()).not.toMatch(/openrouter/i)
  })

  it("detects the plan-chat abort timeout without treating Mongo timeouts as AI", () => {
    expect(isAbortTimeoutError(new Error("The operation was aborted due to timeout"))).toBe(true)
    expect(isAbortTimeoutError(new Error("connection <monitor> to 159.41.207.169:27017 timed out"))).toBe(false)
    expect(aiTimeoutUserMessage()).toMatch(/co-founder/i)
  })

  it("detects a provider the socket never reached", () => {
    // Shape emitted by the AI SDK when undici cannot open the connection.
    const connectTimeout = Object.assign(
      new Error("Cannot connect to API: Connect Timeout Error (attempted addresses: 104.18.2.115:443, timeout: 10000ms)"),
      { cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }) },
    )
    expect(isProviderUnreachableError(connectTimeout)).toBe(true)
    expect(
      isProviderUnreachableError(
        new Error("Failed after 3 attempts. Last error: AI_APICallError: Cannot connect to API: Connect Timeout Error"),
      ),
    ).toBe(true)
    // OpenRouter relaying a dead model backend is still upstream, not user error.
    expect(isProviderUnreachableError(new Error("Provider returned error"))).toBe(true)
    expect(providerUnreachableUserMessage()).toMatch(/try again/i)
  })

  it("keeps certificate and database failures out of the unreachable bucket", () => {
    expect(isProviderUnreachableError(new Error("Cannot connect to API: certificate is not yet valid"))).toBe(false)
    const mongo = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:27017"), {
      name: "MongoNetworkError",
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    })
    expect(isDatabaseConnectivityError(mongo)).toBe(true)
    expect(isProviderUnreachableError(mongo)).toBe(false)
    expect(isProviderUnreachableError(new Error("Invalid model specification"))).toBe(false)
  })

  it("names the offending field inside a rejected 200 response", () => {
    const rejected200 = Object.assign(new Error("Failed to process successful response"), {
      statusCode: 200,
      cause: Object.assign(new TypeError("Expected string, received undefined"), {
        issues: [{ path: ["choices", 0, "message", "content"], message: "Invalid input: expected string" }],
      }),
    })
    const chain = describeErrorChain(rejected200)
    expect(chain[0]).toMatch(/Failed to process successful response status=200/)
    expect(chain.join("\n")).toMatch(/offending: choices\.0\.message\.content/)
  })
})
