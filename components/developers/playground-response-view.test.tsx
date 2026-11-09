import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ResponseView } from "./playground-response-view"

const render = (json: string, ok?: boolean) => renderToStaticMarkup(createElement(ResponseView, { json, ok }))

const BASE64 = "A".repeat(160)

describe("ResponseView — formatted runtime responses", () => {
  it("leads with the assistant answer for chat-shaped results", () => {
    const html = render(
      JSON.stringify({
        id: "gen-1",
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        content: "Hello from Atai!",
        finishReason: "stop",
        usage: { promptTokens: 12, completionTokens: 9, totalTokens: 21 },
      }),
    )
    expect(html).toContain("Hello from Atai!")
    expect(html).toContain("nvidia/nemotron-3-ultra-550b-a55b:free")
    expect(html).toContain("stop")
    expect(html).toContain("totalTokens 21")
    // The consumed keys render once as chips, not again as a duplicate field row.
    expect(html.match(/promptTokens/g)?.length).toBe(1)
  })

  it("renders every record of a homogeneous array as its own card", () => {
    const html = render(
      JSON.stringify({
        results: [
          { name: "Kampala", placeId: "abc", latitude: 0.3136, longitude: 32.5828 },
          { name: "Entebbe", placeId: "def", latitude: 0.0532, longitude: 32.4615 },
        ],
      }),
    )
    // Stacked cards, not a grid table: wide tables clipped fields on narrow
    // screens and the user rejected them for data results.
    expect(html).not.toContain("<table")
    expect(html).toContain("Kampala")
    expect(html).toContain("Entebbe")
    expect(html).toContain("item 1 / 2")
    expect(html).toContain("item 2 / 2")
    expect(html).toContain("32.5828")
  })

  it("renders scalar arrays as chips instead of cards", () => {
    const html = render(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]], model: "embed-x" }))
    expect(html).not.toContain("item 1 /")
    expect(html).toContain("embed-x")
  })

  it("keeps deep objects collapsed and labels their size", () => {
    const html = render(JSON.stringify({ a: { b: { c: { d: 1 } } } }))
    expect(html).toContain("1 field")
    expect(html).not.toContain(">d<")
  })

  it("links urls in a new tab with a hardened rel", () => {
    const html = render(JSON.stringify({ checkoutUrl: "https://checkout.dodo.xyz/pay/abc" }))
    expect(html).toContain('href="https://checkout.dodo.xyz/pay/abc"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it("summarizes inline data payloads rather than dumping base64", () => {
    const blob = `data:application/pdf;base64,${"A".repeat(4000)}`
    const html = render(JSON.stringify({ attachment: blob }))
    expect(html).toContain("inline payload ·")
    expect(html).not.toContain("AAAA")
  })

  it("falls back to a message when the body is not JSON", () => {
    expect(render("<html>not json</html>")).toContain("not valid JSON")
  })

  it("shows a plain-text failure as an error card", () => {
    const html = render("Failed to fetch", false)
    expect(html).toContain('role="alert"')
    expect(html).toContain("Failed to fetch")
    expect(html).not.toContain("not valid JSON")
  })

  it("handles an empty object without crashing", () => {
    expect(render("{}")).toContain("{}")
  })
})

describe("ResponseView — media and diagnostics cards", () => {
  it("plays an MP3 speech result and shows its metadata", () => {
    const html = render(
      JSON.stringify({
        audioBase64: BASE64,
        mimeType: "audio/mpeg",
        model: "mistralai/voxtral-mini-tts-2603",
        voice: "en_paul_neutral",
        format: "mp3",
        bytes: 120,
        generationId: "gen-tts-1",
      }),
    )
    expect(html).toContain("<audio")
    expect(html).toContain("data:audio/mpeg;base64,")
    expect(html).toContain("mistralai/voxtral-mini-tts-2603")
    expect(html).toContain("voice en_paul_neutral")
    expect(html).toContain("gen-tts-1")
    expect(html).toContain("Download")
  })

  it("wraps PCM speech in a playable WAV container", () => {
    const html = render(
      JSON.stringify({
        audioBase64: BASE64,
        mimeType: "audio/pcm;rate=24000;channels=1",
        model: "google/gemini-3.8-flash-lite-tts",
        format: "pcm",
      }),
    )
    expect(html).toContain("data:audio/wav;base64,")
    expect(html).toContain("PCM → WAV")
    expect(html).toContain("<audio")
  })

  it("explains that stripped audio cannot be replayed from the saved log", () => {
    const html = render(
      JSON.stringify({
        audioBase64: "[15 KB omitted from the saved log]",
        mimeType: "audio/mpeg",
        model: "mistralai/voxtral-mini-tts-2603",
      }),
    )
    expect(html).not.toContain("<audio")
    expect(html).toContain("not in this saved entry")
    expect(html).toContain("mistralai/voxtral-mini-tts-2603")
  })

  it("previews generated images with a download per image", () => {
    const html = render(
      JSON.stringify({
        images: [
          { b64: BASE64, mediaType: "image/png" },
          { b64: BASE64, mediaType: "image/webp" },
        ],
        model: "google/gemini-2.5-flash-image",
        count: 2,
      }),
    )
    expect(html).toContain("2 generated images")
    expect(html).toContain("<img")
    expect(html).toContain("data:image/png;base64,")
    expect(html).toContain("data:image/webp;base64,")
    expect(html).toContain("atai-image-1.png")
    expect(html).toContain("atai-image-2.webp")
  })

  it("leads a transcript with the text", () => {
    const html = render(
      JSON.stringify({ text: "Meet the dashboard that explains itself.", model: "openai/whisper-large-v3-turbo" }),
    )
    expect(html).toContain("Transcript")
    expect(html).toContain("Meet the dashboard that explains itself.")
    expect(html).toContain("openai/whisper-large-v3-turbo")
  })

  it("summarizes embeddings instead of dumping the vector array", () => {
    const html = render(
      JSON.stringify({ embeddings: [[0.1, -0.2, 0.3, 0.4]], dimensions: 4, model: "embed-x" }),
    )
    expect(html).toContain("Embeddings")
    expect(html).toContain("Vector 1 preview")
    expect(html).toContain("0.1000")
    expect(html).not.toContain("0.1000, -0.2")
  })

  it("explains an async video job and how to poll it", () => {
    const html = render(JSON.stringify({ jobId: "job_1", status: "submitted" }))
    expect(html).toContain("Video job")
    expect(html).toContain("job_1")
    expect(html).toContain("submitted")
    expect(html).toContain("Poll")
  })

  it("turns a failed request into an actionable error card", () => {
    const html = render(
      JSON.stringify({
        code: "runtime_model_unavailable",
        message: "The selected model is not available on this provider.",
      }),
      false,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain("Request failed")
    expect(html).toContain("runtime_model_unavailable")
    expect(html).toContain("Next step")
    expect(html).toContain("Pick a model")
  })

  it("recognises runtime errors without an explicit ok flag", () => {
    const html = render(JSON.stringify({ code: "runtime_provider_timeout", message: "The AI provider timed out." }))
    expect(html).toContain("Request failed")
    expect(html).toContain("runtime_provider_timeout")
  })
})
