/**
 * Atai Runtime — OpenRouter error-boundary tests.
 *
 * Focus: provider routing rejections. When OpenRouter cannot find an endpoint
 * for the requested modality, re-sending the same input can never succeed, so
 * it must be a caller-side 422-class failure with an actionable message — not
 * the opaque 502 "The AI provider returned an error." that made every unmodelled
 * vision call look like a platform outage.
 */

import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { readErrorEnvelope, routingCapabilityFailure } from "./errors"
import { ProviderExecutionError, providerFailureToRuntimeError } from "@/lib/runtime/router/adapter"

/** Bodies captured live from the provider during the vision investigation. */
const IMAGE_INPUT_REJECTION = {
  error: {
    code: 404,
    message: "No endpoints found that support image input",
    metadata: { failed_routing_step: "Filter by Image Support" },
  },
}

const IMAGE_URL_REJECTION = {
  error: {
    code: 404,
    message: "No endpoints found that support image URLs",
    metadata: {},
  },
}

describe("readErrorEnvelope", () => {
  it("reads the documented { error: { code, message, metadata } } shape", () => {
    expect(readErrorEnvelope(JSON.stringify(IMAGE_INPUT_REJECTION))).toEqual(IMAGE_INPUT_REJECTION.error)
  })

  it("never throws on a non-JSON or empty body", () => {
    expect(readErrorEnvelope("<html>502 Bad Gateway</html>")).toBeUndefined()
    expect(readErrorEnvelope("")).toBeUndefined()
    expect(readErrorEnvelope("{}")).toBeUndefined()
  })
})

describe("routingCapabilityFailure", () => {
  it("reclassifies a modality routing rejection as a caller-side failure", () => {
    const failure = routingCapabilityFailure(IMAGE_INPUT_REJECTION.error)
    expect(failure).toBeInstanceOf(ProviderExecutionError)
    expect(failure?.category).toBe("unsupported_operation")
    expect(failure?.message).toContain("cannot serve this request")
    expect(failure?.detail).toBe("No endpoints found that support image input")
  })

  it("detects the URL-variant wording too", () => {
    expect(routingCapabilityFailure(IMAGE_URL_REJECTION.error)?.category).toBe("unsupported_operation")
  })

  it("is case-insensitive and matches anywhere in the message", () => {
    expect(
      routingCapabilityFailure({ message: "Upstream note: NO ENDPOINTS FOUND for this request" })?.category,
    ).toBe("unsupported_operation")
  })

  it("passes unrelated provider errors through untouched", () => {
    expect(routingCapabilityFailure({ code: 500, message: "Internal server error" })).toBeNull()
    expect(routingCapabilityFailure({ code: 429, message: "Rate limit exceeded" })).toBeNull()
    expect(routingCapabilityFailure(undefined)).toBeNull()
    expect(routingCapabilityFailure({ message: 404 as unknown as string })).toBeNull()
  })

  it("client-facing text stays provider-neutral and credential-free", () => {
    const secret = "sk-or-v1-abcdefghijklmnopqrstuvwxyz"
    const failure = routingCapabilityFailure({
      message: `No endpoints found that support image input (auth: ${secret})`,
    })
    expect(failure?.message).not.toContain(secret)
    expect(failure?.message).not.toMatch(/OPENROUTER_|Bearer|sk-or/)
    // The provider wording is kept for the server-side log only, bounded.
    expect(failure?.detail).toContain("No endpoints found")
    expect((failure?.detail ?? "").length).toBeLessThanOrEqual(300)
  })

  it("a routing rejection reaches the caller as an actionable 422", () => {
    const failure = routingCapabilityFailure(IMAGE_INPUT_REJECTION.error)
    expect(failure).toBeInstanceOf(ProviderExecutionError)
    const mapped = providerFailureToRuntimeError(failure as ProviderExecutionError)
    expect(mapped.status).toBe(422)
    expect(mapped.code).toBe("runtime_invalid_request")
    // The neutral adapter message is what the developer reads; without this
    // forwarding the 422 would fall back to a generic "body is invalid".
    expect(mapped.message).toContain("cannot serve this request")
  })

  describe("model selection failures (live speech incident)", () => {
    // Exact body OpenRouter returned for the playground's old TTS sample.
    const MODEL_NOT_FOUND = { message: "Model openai/gpt-4o-mini-tts-2025-12-15 does not exist" }

    it("classifies a nonexistent model as model_unavailable, not an outage", () => {
      const failure = routingCapabilityFailure(MODEL_NOT_FOUND)
      expect(failure?.category).toBe("model_unavailable")
      expect(failure?.message).toContain("not available")
      expect(failure?.detail).toBe(MODEL_NOT_FOUND.message)
      const mapped = providerFailureToRuntimeError(failure as ProviderExecutionError)
      expect(mapped.code).toBe("runtime_model_unavailable")
      expect(mapped.status).toBe(400)
    })

    it("recognises the other model-rejection wordings", () => {
      expect(routingCapabilityFailure({ message: "The model acme/ghost was not found" })?.category).toBe("model_unavailable")
      expect(routingCapabilityFailure({ message: "invalid model: acme/ghost" })?.category).toBe("model_unavailable")
      expect(routingCapabilityFailure({ message: "Unknown model requested" })?.category).toBe("model_unavailable")
    })

    it("asks for a voice when the TTS provider requires one", () => {
      const failure = routingCapabilityFailure({ message: "Explicit voice is required for this TTS provider" })
      expect(failure?.category).toBe("unsupported_operation")
      expect(failure?.message).toContain("voice")
      expect(providerFailureToRuntimeError(failure as ProviderExecutionError).status).toBe(422)
    })

    it("explains unsupported audio formats instead of blaming the provider", () => {
      const failure = routingCapabilityFailure({
        message: "response_format 'mp3' is not supported by this model",
      })
      expect(failure?.category).toBe("unsupported_operation")
      expect(failure?.message).toContain("audio format")
      expect(providerFailureToRuntimeError(failure as ProviderExecutionError).status).toBe(422)
    })
  })
})
