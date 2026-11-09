import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { requestRawCompletion, streamRawCompletion } from "@/lib/analysis/raw-chat"

function respondWith(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })),
  )
}

const call = () => requestRawCompletion({ system: "s", prompt: "p", maxOutputTokens: 100 })

describe("raw completion salvage", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key"
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENROUTER_API_KEY
  })

  it("stays off when no key is configured", async () => {
    delete process.env.OPENROUTER_API_KEY
    respondWith({ choices: [{ message: { content: "hi" } }] })
    expect(await call()).toBeNull()
  })

  it("reads a normal string completion", async () => {
    respondWith({ choices: [{ finish_reason: "stop", message: { content: "  the answer  " } }] })
    expect(await call()).toEqual({ text: "the answer", truncated: false })
  })

  it("reads content parts, which the strict SDK schema also allows", async () => {
    respondWith({
      choices: [{ finish_reason: "stop", message: { content: [{ type: "text", text: "part one " }, { type: "text", text: "part two" }] } }],
    })
    expect((await call())?.text).toBe("part one part two")
  })

  it("falls back to the reasoning field when content is empty", async () => {
    respondWith({ choices: [{ finish_reason: "stop", message: { content: null, reasoning_content: "thoughts only" } }] })
    expect((await call())?.text).toBe("thoughts only")
  })

  it("flags an answer the provider cut at the token limit", async () => {
    respondWith({ choices: [{ finish_reason: "length", message: { content: "half a sentence" } }] })
    expect(await call()).toEqual({ text: "half a sentence", truncated: true })
  })

  it("salvages text from a body that arrives truncated", async () => {
    respondWith('{"choices":[{"message":{"content":"first line\\nsecond line\\nand the thi')
    expect(await call()).toEqual({ text: "first line\nsecond line\nand the thi", truncated: true })
  })

  it("refuses to invent content when the provider errored", async () => {
    respondWith({ error: { message: "Provider returned error" } })
    expect(await call()).toBeNull()
    respondWith({ choices: [] })
    expect(await call()).toBeNull()
    respondWith({ choices: [{ message: { content: "" } }] })
    expect(await call()).toBeNull()
  })

  it("returns nothing on a non-200 rather than throwing", async () => {
    respondWith({ error: { message: "nope" } }, 503)
    expect(await call()).toBeNull()
  })
})

function respondWithSSE(frames: unknown[], status = 200) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        const payload = typeof frame === "string" ? frame : JSON.stringify(frame)
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
      }
      controller.close()
    },
  })
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })))
}

async function stream(frames: unknown[], captured: string[]) {
  respondWithSSE(frames)
  return streamRawCompletion({
    system: "s",
    prompt: "p",
    maxOutputTokens: 100,
    onDelta: (text) => captured.push(text),
  })
}

describe("raw completion streaming", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key"
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENROUTER_API_KEY
  })

  it("hands the founder prose frame by frame and keeps the whole reply", async () => {
    const seen: string[] = []
    const result = await stream(
      [
        { choices: [{ delta: { content: "Your pricing " } }] },
        { choices: [{ delta: { content: "needs tiers." } }] },
        "[DONE]",
      ],
      seen,
    )
    expect(seen).toEqual(["Your pricing ", "needs tiers."])
    expect(result).toEqual({ text: "Your pricing needs tiers.", truncated: false, failed: false })
  })

  it("marks a reply the provider stopped at the limit", async () => {
    const seen: string[] = []
    const result = await stream(
      [{ choices: [{ delta: { content: "half a sentence" } }] }, { choices: [{ delta: {}, finish_reason: "length" }] }],
      seen,
    )
    expect(result.text).toBe("half a sentence")
    expect(result.truncated).toBe(true)
  })

  it("reads reasoning deltas when the model leaves content empty", async () => {
    const seen: string[] = []
    const result = await stream([{ choices: [{ delta: { reasoning_content: "thoughts only" } }] }], seen)
    expect(result.text).toBe("thoughts only")
    expect(seen).toEqual(["thoughts only"])
  })

  it("reports failure instead of inventing a reply", async () => {
    const seen: string[] = []
    expect(await stream([{ error: { message: "Provider returned error" } }], seen)).toEqual({
      text: "",
      truncated: false,
      failed: true,
    })
    expect(seen).toEqual([])
  })

  it("stays off without a configured key", async () => {
    delete process.env.OPENROUTER_API_KEY
    const seen: string[] = []
    expect(await stream([{ choices: [{ delta: { content: "hi" } }] }], seen)).toEqual({
      text: "",
      truncated: false,
      failed: true,
    })
  })
})
