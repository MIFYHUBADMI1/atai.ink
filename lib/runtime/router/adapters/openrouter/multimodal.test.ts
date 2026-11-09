/**
 * Atai Runtime — OpenRouter multimodal mapper tests.
 *
 * Covers strict input validation, model resolution (caller > project default >
 * platform default > recommended), and provider-neutral result normalization
 * for the image, video, speech, transcription, and vision operations.
 * No test requires real OpenRouter connectivity.
 */

import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  toOpenRouterImageRequest,
  toImageResult,
  toOpenRouterVideoRequest,
  toVideoResult,
  toOpenRouterSpeechRequest,
  toSpeechResult,
  toOpenRouterTranscriptionRequest,
  toTranscriptionResult,
  toOpenRouterVisionRequest,
  toVisionResult,
  resolveImageModel,
  resolveVideoModel,
  resolveSpeechModel,
  resolveVisionModel,
  RECOMMENDED_IMAGE_MODEL,
  RECOMMENDED_VIDEO_MODEL,
  RECOMMENDED_SPEECH_MODEL,
  RECOMMENDED_SPEECH_VOICE,
} from "./multimodal"
import { RECOMMENDED_DEFAULT_MODEL, RECOMMENDED_VISION_MODEL } from "./mapper"
import { ProviderExecutionError } from "@/lib/runtime/router/adapter"

describe("media model resolution", () => {
  it("each media capability resolves its own default, never the chat model", () => {
    delete process.env.OPENROUTER_IMAGE_MODEL
    delete process.env.OPENROUTER_VIDEO_MODEL
    delete process.env.OPENROUTER_SPEECH_MODEL
    expect(resolveImageModel(undefined)).toBe(RECOMMENDED_IMAGE_MODEL)
    expect(resolveVideoModel(undefined)).toBe(RECOMMENDED_VIDEO_MODEL)
    expect(resolveSpeechModel(undefined)).toBe(RECOMMENDED_SPEECH_MODEL)
    for (const model of [RECOMMENDED_IMAGE_MODEL, RECOMMENDED_VIDEO_MODEL, RECOMMENDED_SPEECH_MODEL]) {
      expect(model).not.toBe(RECOMMENDED_DEFAULT_MODEL)
    }
    expect(resolveImageModel("caller/image")).toBe("caller/image")
    expect(resolveVideoModel("caller/video")).toBe("caller/video")
    expect(resolveSpeechModel("caller/tts")).toBe("caller/tts")
  })

  it("env overrides apply when the caller omits a model", () => {
    process.env.OPENROUTER_IMAGE_MODEL = "env/image"
    process.env.OPENROUTER_VIDEO_MODEL = "env/video"
    process.env.OPENROUTER_SPEECH_MODEL = "env/tts"
    expect(resolveImageModel(undefined)).toBe("env/image")
    expect(resolveVideoModel(undefined)).toBe("env/video")
    expect(resolveSpeechModel(undefined)).toBe("env/tts")
    expect(resolveImageModel("caller/image")).toBe("caller/image")
    delete process.env.OPENROUTER_IMAGE_MODEL
    delete process.env.OPENROUTER_VIDEO_MODEL
    delete process.env.OPENROUTER_SPEECH_MODEL
  })
})

describe("ai.image / generateImage", () => {
  it("builds the request with resolved model and passes image options", () => {
    const body = toOpenRouterImageRequest({
      model: "openai/gpt-image-2",
      prompt: "a cat",
      resolution: "2K",
      aspect_ratio: "16:9",
      n: 2,
      input_references: [{ type: "image_url", image_url: { url: "https://example.com/r.png" } }],
    })
    expect(body.model).toBe("openai/gpt-image-2")
    expect(body.prompt).toBe("a cat")
    expect(body.resolution).toBe("2K")
    expect(body.n).toBe(2)
    expect(body.input_references).toHaveLength(1)
  })

  it("rejects unknown fields and bad values", () => {
    expect(() => toOpenRouterImageRequest({ prompt: "x", hacker: true })).toThrow(ProviderExecutionError)
    expect(() => toOpenRouterImageRequest({ prompt: "" })).toThrow(ProviderExecutionError)
    expect(() => toOpenRouterImageRequest({ prompt: "x", n: 99 })).toThrow(ProviderExecutionError)
  })

  it("normalizes base64 images and reports the model that ran", () => {
    const result = toImageResult(
      { data: [{ b64_json: "abc", media_type: "image/png" }], usage: { prompt_tokens: 0, completion_tokens: 100, total_tokens: 100, cost: 0.04 } },
      "google/gemini-2.5-flash-image",
    )
    expect(result.provider).toBe("openrouter")
    expect(result.data).toMatchObject({
      images: [{ b64: "abc", mediaType: "image/png" }],
      model: "google/gemini-2.5-flash-image",
      count: 1,
    })
    expect(result.usage?.outputTokens).toBe(100)
    expect(result.usage?.providerCost).toBe(0.04)
    expect(() => toImageResult({ data: [] }, "google/gemini-2.5-flash-image")).toThrow(ProviderExecutionError)
  })
})

describe("ai.video / generateVideo", () => {
  it("submits with resolved model", () => {
    const body = toOpenRouterVideoRequest({ prompt: "a rocket launch", duration: 5 })
    expect(body.model).toBe(RECOMMENDED_VIDEO_MODEL)
    expect(body.duration).toBe(5)
  })

  it("normalizes the async job response", () => {
    const result = toVideoResult({ id: "job_123", status: "submitted", eta_seconds: 30 })
    expect(result.data).toMatchObject({ jobId: "job_123", status: "submitted" })
  })
})

describe("ai.speech / speak", () => {
  it("builds the speech request with the caller model and voice", () => {
    const body = toOpenRouterSpeechRequest({ model: "x-ai/grok-voice-tts-1.0", input: "Hello!", voice: "eve", response_format: "mp3" })
    expect(body.model).toBe("x-ai/grok-voice-tts-1.0")
    expect(body.voice).toBe("eve")
    expect(body.response_format).toBe("mp3")
  })

  it("unmodelled speech never resolves to the chat model and gets working defaults", () => {
    delete process.env.OPENROUTER_SPEECH_MODEL
    const body = toOpenRouterSpeechRequest({ input: "Hello from Atai!" })
    expect(body.model).toBe(RECOMMENDED_SPEECH_MODEL)
    expect(body.model).not.toBe(RECOMMENDED_DEFAULT_MODEL)
    expect(body.voice).toBe(RECOMMENDED_SPEECH_VOICE)
    expect(body.response_format).toBe("mp3")
  })

  it("does not inject the platform voice into a caller-chosen TTS model", () => {
    const body = toOpenRouterSpeechRequest({ model: "google/gemini-3.8-flash-lite-tts", input: "Hello!", response_format: "pcm" })
    expect(body.voice).toBeUndefined()
    expect(body.response_format).toBe("pcm")
  })

  it("normalizes raw audio bytes with the actual MIME type and metadata", () => {
    const bytes = new TextEncoder().encode("fake-mp3-bytes").buffer as ArrayBuffer
    const result = toSpeechResult(bytes, {
      model: RECOMMENDED_SPEECH_MODEL,
      contentType: "audio/mpeg",
      generationId: "gen-tts-test",
      voice: RECOMMENDED_SPEECH_VOICE,
      format: "mp3",
    })
    expect(result.data).toMatchObject({
      mimeType: "audio/mpeg",
      model: RECOMMENDED_SPEECH_MODEL,
      voice: RECOMMENDED_SPEECH_VOICE,
      format: "mp3",
      generationId: "gen-tts-test",
      bytes: bytes.byteLength,
    })
    expect((result.data as { audioBase64: string }).audioBase64.length).toBeGreaterThan(0)
  })

  it("keeps PCM MIME parameters instead of mislabelling bytes as MP3", () => {
    const bytes = new Uint8Array([0, 1, 2, 3]).buffer
    const result = toSpeechResult(bytes, {
      model: "google/gemini-3.8-flash-lite-tts",
      contentType: "audio/pcm;rate=24000;channels=1",
      format: "pcm",
    })
    expect(result.data).toMatchObject({ mimeType: "audio/pcm;rate=24000;channels=1" })
  })
})

describe("ai.transcribe / transcribe", () => {
  it("pins the transcription model server-side", () => {
    const body = toOpenRouterTranscriptionRequest({ input_audio: { data: "AAAA", format: "wav" }, language: "en" })
    expect(body.model).toBe("openai/whisper-large-v3-turbo")
    expect(body.input_audio).toEqual({ data: "AAAA", format: "wav" })
  })

  it("rejects a different requested model (unchangeable)", () => {
    expect(() =>
      toOpenRouterTranscriptionRequest({
        input_audio: { data: "AAAA", format: "wav" },
        model: "openai/whisper-large-v3",
      }),
    ).toThrow(ProviderExecutionError)
  })

  it("normalizes text; empty text → provider error", () => {
    const result = toTranscriptionResult({ text: "hello world", usage: { total_tokens: 5 } })
    expect(result.data).toEqual({ text: "hello world" })
    expect(() => toTranscriptionResult({ text: "" })).toThrow(ProviderExecutionError)
  })
})

describe("ai.vision / visionInput", () => {
  it("accepts multimodal content parts (image_url + text)", () => {
    const body = toOpenRouterVisionRequest({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
          ],
        },
      ],
      max_tokens: 300,
    }, "openai/gpt-5.2")
    expect(body.model).toBe("openai/gpt-5.2")
    expect(Array.isArray(body.messages[0].content)).toBe(true)
    expect(body.max_tokens).toBe(300)
  })

  it("rejects unknown content-part types", () => {
    expect(() =>
      toOpenRouterVisionRequest({
        messages: [{ role: "user", content: [{ type: "exec", code: "rm -rf /" }] }],
      }),
    ).toThrow(ProviderExecutionError)
  })

  it("normalizes the chat-shaped response", () => {
    const result = toVisionResult({
      id: "gen-1",
      model: "openai/gpt-5.2",
      choices: [{ finish_reason: "stop", message: { content: "A cat sits on a mat." } }],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    })
    expect(result.data).toMatchObject({ content: "A cat sits on a mat.", model: "openai/gpt-5.2" })
    expect(result.usage?.totalTokens).toBe(18)
    expect(() => toVisionResult({ choices: [] })).toThrow(ProviderExecutionError)
  })

  it("reports the finish reason so a truncated answer is diagnosable", () => {
    const result = toVisionResult({
      model: "openai/gpt-5.2",
      choices: [{ finish_reason: "length", message: { content: "A cat sits" } }],
    })
    expect(result.data).toMatchObject({ content: "A cat sits", finishReason: "length" })
  })

  it("reasoning-only 200 is the answer (content can be null on reasoning models)", () => {
    const result = toVisionResult({
      choices: [
        {
          finish_reason: "stop",
          message: { content: null, reasoning: "The pixels are red, so the answer is Red." },
        },
      ],
    })
    expect(result.data).toMatchObject({ content: "The pixels are red, so the answer is Red." })
  })

  it("no text anywhere → error detail names finish_reason and the max_tokens fix", () => {
    let caught: unknown
    try {
      toVisionResult({ choices: [{ finish_reason: "length", message: { content: null } }] })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ProviderExecutionError)
    const detail = (caught as ProviderExecutionError).detail ?? ""
    expect(detail).toContain("finish_reason: length")
    expect(detail).toContain("max_tokens")
  })

  it("never falls back to the text-only chat model", () => {
    delete process.env.OPENROUTER_VISION_MODEL
    expect(resolveVisionModel(undefined, undefined)).toBe(RECOMMENDED_VISION_MODEL)
    expect(resolveVisionModel(undefined, undefined)).not.toBe(RECOMMENDED_DEFAULT_MODEL)
    process.env.OPENROUTER_VISION_MODEL = "acme/vision"
    expect(resolveVisionModel(undefined, undefined)).toBe("acme/vision")
    expect(resolveVisionModel("caller/model", "project/model")).toBe("caller/model")
    expect(resolveVisionModel(undefined, "project/model")).toBe("project/model")
    delete process.env.OPENROUTER_VISION_MODEL
  })

  it("unmodelled vision requests still resolve to an image-capable model", () => {
    delete process.env.OPENROUTER_VISION_MODEL
    const body = toOpenRouterVisionRequest(
      { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      resolveVisionModel(undefined, undefined),
    )
    expect(body.model).toBe(RECOMMENDED_VISION_MODEL)
    expect(body.model).not.toBe(RECOMMENDED_DEFAULT_MODEL)
  })

  it("accepts a base64 data URI as the image source", () => {
    const body = toOpenRouterVisionRequest(
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
            ],
          },
        ],
      },
      "openai/gpt-5.2",
    )
    const parts = body.messages[0].content as Array<{ type: string; image_url?: { url: string } }>
    expect(parts[0].image_url?.url).toBe("data:image/png;base64,iVBORw0KGgo=")
  })
})
