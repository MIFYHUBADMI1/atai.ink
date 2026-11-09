/**
 * Atai Runtime — OpenRouter speech client tests.
 *
 * /audio/speech is the one endpoint that answers with raw bytes, so it needs
 * its own boundary: trust Content-Type, never base64 a JSON error into audio,
 * and preserve the metadata the playground needs to play the clip.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { executeOpenRouterSpeech } from "./client"
import { ProviderExecutionError } from "@/lib/runtime/router/adapter"

const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x64])

function headers(map: Record<string, string>) {
  return new Headers(map)
}

describe("executeOpenRouterSpeech", () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key"
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_BASE_URL
  })

  it("returns audio bytes plus content type and generation id", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(AUDIO, {
        status: 200,
        headers: headers({
          "content-type": "audio/mpeg",
          "x-generation-id": "gen-tts-123",
        }),
      }),
    )

    const result = await executeOpenRouterSpeech({ model: "m", input: "hi" })
    expect(new Uint8Array(result.bytes)).toEqual(AUDIO)
    expect(result.contentType).toBe("audio/mpeg")
    expect(result.generationId).toBe("gen-tts-123")
  })

  it("keeps PCM MIME parameters intact", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(AUDIO, {
        status: 200,
        headers: headers({ "content-type": "audio/pcm;rate=24000;channels=1" }),
      }),
    )

    const result = await executeOpenRouterSpeech({ model: "m", input: "hi" })
    expect(result.contentType).toBe("audio/pcm;rate=24000;channels=1")
  })

  it("classifies a 400 nonexistent model as model_unavailable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 400, message: "Model openai/gpt-4o-mini-tts-2025-12-15 does not exist" } }),
        { status: 400, headers: headers({ "content-type": "application/json" }) },
      ),
    )

    let caught: unknown
    try {
      await executeOpenRouterSpeech({ model: "openai/gpt-4o-mini-tts-2025-12-15", input: "hi" })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ProviderExecutionError)
    expect((caught as ProviderExecutionError).category).toBe("model_unavailable")
  })

  it("never treats a JSON 200 as audio", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 500, message: "synthesis failed" } }), {
        status: 200,
        headers: headers({ "content-type": "application/json" }),
      }),
    )

    let caught: unknown
    try {
      await executeOpenRouterSpeech({ model: "m", input: "hi" })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ProviderExecutionError)
    expect((caught as ProviderExecutionError).category).toBe("provider_error")
    expect((caught as ProviderExecutionError).detail).toContain("not audio")
    expect((caught as ProviderExecutionError).detail).toContain("synthesis failed")
  })

  it("maps 402 to provider_not_entitled (platform account problem)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }), {
        status: 402,
        headers: headers({ "content-type": "application/json" }),
      }),
    )

    let caught: unknown
    try {
      await executeOpenRouterSpeech({ model: "m", input: "hi" })
    } catch (e) {
      caught = e
    }
    expect((caught as ProviderExecutionError).category).toBe("provider_not_entitled")
  })

  it("rejects a zero-byte audio response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(), {
        status: 200,
        headers: headers({ "content-type": "audio/mpeg" }),
      }),
    )

    await expect(executeOpenRouterSpeech({ model: "m", input: "hi" })).rejects.toMatchObject({
      category: "provider_error",
    })
  })
})
