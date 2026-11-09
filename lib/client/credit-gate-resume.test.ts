import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearPaymentHandoff, clearPendingAction, hasPaymentHandoff, installCreditGateInterceptor,
  markPaymentHandoff, parseCreditBlockHeader, parseCreditShortfall, peekPendingAction,
  replayPendingAction, savePendingAction, subscribeToCreditGate, type CreditShortfall,
} from "./credit-gate"

const bodies = vi.hoisted(() => new Map<string, Blob>())
vi.mock("./credit-request-storage", () => ({
  saveCreditRequestBody: vi.fn(async (body: Blob) => { const id = crypto.randomUUID(); bodies.set(id, body); return id }),
  readCreditRequestBody: vi.fn(async (id: string) => bodies.get(id) ?? null),
  deleteCreditRequestBody: vi.fn(async (id: string) => { bodies.delete(id) }),
}))

const url = "/api/projects/p-1/build"
const request = { url, method: "POST" as const, body: "{}", contentType: "application/json", form: null }
const refusal = () => Response.json({ ok: false, error: { code: "INSUFFICIENT_CREDITS", message: "More credits needed.", meta: { required: 500, available: 0 } } }, { status: 402 })
function makeWindow(nativeFetch: typeof fetch) {
  const data = new Map<string, string>()
  const target = Object.assign(new EventTarget(), {
    location: new URL("http://localhost:3000"), fetch: nativeFetch,
    sessionStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value) },
      removeItem: (key: string) => { data.delete(key) },
    },
  })
  vi.stubGlobal("window", target)
  installCreditGateInterceptor()
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => target.fetch(input, init))
  return target
}
function pending(): CreditShortfall {
  return { code: "INSUFFICIENT_CREDITS", message: null, required: 500, available: 0, action: "your build", at: Date.now(), request }
}

beforeEach(() => bodies.clear())
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe("payment redirect persistence", () => {
  it("preserves a zero balance and a payment marker through repeated return checks", () => {
    makeWindow(vi.fn(async () => refusal()) as typeof fetch)
    expect(parseCreditShortfall({ ok: false, error: { code: "INSUFFICIENT_CREDITS", meta: { required: 500, available: 0 } } }, request)?.available).toBe(0)
    expect(savePendingAction(pending())).toBe(true)
    markPaymentHandoff()
    expect(hasPaymentHandoff()).toBe(true)
    expect(hasPaymentHandoff()).toBe(true)
    expect(peekPendingAction()?.required).toBe(500)
    clearPaymentHandoff()
    expect(hasPaymentHandoff()).toBe(false)
  })

  it("expires saved actions and never accepts a protocol-relative replay URL", () => {
    const target = makeWindow(vi.fn(async () => refusal()) as typeof fetch)
    savePendingAction({ ...pending(), at: Date.now() - 31 * 60_000 })
    expect(peekPendingAction()).toBe(null)
    target.sessionStorage.setItem("atai:pending-action", JSON.stringify({ ...pending(), request: { ...request, url: "//other.example/api/charge" } }))
    expect(peekPendingAction()).toBe(null)
  })
})

describe("durable body replay", () => {
  it("restores uploaded bytes, filenames, duplicate fields and the multipart boundary", async () => {
    let paid = false
    let restored: FormData | undefined
    const native = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!paid) return refusal()
      const req = input instanceof Request ? input : new Request(new URL(String(input), "http://localhost:3000"), init)
      restored = await req.formData()
      return Response.json({ ok: true, data: { started: true } })
    }) as unknown as typeof fetch
    const target = makeWindow(native)
    const signals: CreditShortfall[] = []
    const unsubscribe = subscribeToCreditGate((signal) => signals.push(signal))
    const form = new FormData()
    form.append("note", "first")
    form.append("note", "second")
    form.append("file", new Blob([new Uint8Array([0, 255, 127])], { type: "application/zip" }), "site.zip")
    const response = await target.fetch(url, { method: "POST", body: form })
    expect((await response.json()).error.code).toBe("INSUFFICIENT_CREDITS")
    const saved = peekPendingAction()
    expect(saved?.request?.bodyId).toBeTruthy()
    expect(saved?.request?.contentType).toContain("multipart/form-data; boundary=")
    expect(signals).toHaveLength(1)
    paid = true
    expect(await replayPendingAction(saved!)).toEqual({ started: true })
    expect(restored!.getAll("note")).toEqual(["first", "second"])
    const file = restored!.get("file") as File
    expect(file.name).toBe("site.zip")
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0, 255, 127])
    // Do not delete a saved body until the action has actually succeeded.
    expect(bodies.has(saved!.request!.bodyId!)).toBe(true)
    clearPendingAction()
    await Promise.resolve()
    expect(bodies.size).toBe(0)
    unsubscribe()
  })

  it("captures a Request before fetch consumes it and preserves idempotency and response format", async () => {
    const target = makeWindow(vi.fn(async () => refusal()) as typeof fetch)
    const input = new Request("http://localhost:3000/api/projects/p-1/plan-chat", {
      method: "POST", body: JSON.stringify({ message: "Keep the entire idea." }),
      headers: { "content-type": "application/json", accept: "application/x-ndjson", "idempotency-key": "turn-1" },
    })
    await target.fetch(input)
    const saved = peekPendingAction()!
    expect(saved.request?.headers).toEqual({ accept: "application/x-ndjson", "idempotency-key": "turn-1" })
    expect(await bodies.get(saved.request!.bodyId!)!.text()).toBe('{"message":"Keep the entire idea."}')
  })

  it("stores a finite streamed body without sending a locked original stream", async () => {
    let submitted = ""
    const target = makeWindow(vi.fn(async (input: RequestInfo | URL) => {
      submitted = await (input as Request).text()
      return refusal()
    }) as typeof fetch)
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("complete stream")); controller.close() } })
    await target.fetch(url, { method: "POST", body: stream, duplex: "half" } as RequestInit)
    expect(submitted).toBe("complete stream")
    const saved = peekPendingAction()!
    expect(await bodies.get(saved.request!.bodyId!)!.text()).toBe("complete stream")
  })

  it("does not drop large founder text at the old sessionStorage body limit", async () => {
    const target = makeWindow(vi.fn(async () => refusal()) as typeof fetch)
    const text = "the complete plan ".repeat(5000)
    await target.fetch(url, { method: "POST", body: text })
    const saved = peekPendingAction()!
    expect(await bodies.get(saved.request!.bodyId!)!.text()).toBe(text)
  })
})

describe("response safety", () => {
  it("ignores external and billing credit errors instead of replaying money endpoints", async () => {
    const target = makeWindow(vi.fn(async () => refusal()) as typeof fetch)
    const received: CreditShortfall[] = []
    const unsubscribe = subscribeToCreditGate((value) => received.push(value))
    await target.fetch("https://other.example/api/charge", { method: "POST", body: "{}" })
    await target.fetch("/api/billing/checkout", { method: "POST", body: "{}" })
    expect(received).toHaveLength(0)
    expect(peekPendingAction()).toBe(null)
    unsubscribe()
  })

  it("deduplicates project polling and builds the guarded background restart request", async () => {
    const block = { required: 500, available: 0, action: "the website analysis", at: Date.now(), resume: "analysis" }
    const header = encodeURIComponent(JSON.stringify(block))
    const target = makeWindow(vi.fn(async () => Response.json({ ok: true }, { headers: { "x-credit-block": header } })) as typeof fetch)
    const received: CreditShortfall[] = []
    const unsubscribe = subscribeToCreditGate((value) => received.push(value))
    await target.fetch("/api/projects/p-1")
    await target.fetch("/api/projects/p-1")
    expect(received).toHaveLength(1)
    expect(received[0].request?.url).toBe("/api/projects/p-1/retry")
    expect(parseCreditBlockHeader(encodeURIComponent(JSON.stringify({ ...block, resume: "build" })), Date.now(), "/api/projects/p-1")?.request?.url).toBe("/api/projects/p-1/launch")
    unsubscribe()
  })

  it("does not call an HTTP failure or a streamed error a successful resume", async () => {
    makeWindow(vi.fn(async () => new Response("server unavailable", { status: 503 })) as typeof fetch)
    await expect(replayPendingAction(pending())).rejects.toMatchObject({ status: 503 })
    vi.unstubAllGlobals()
    makeWindow(vi.fn(async () => new Response('{"delta":"Partial"}\n{"error":{"code":"AI_UNAVAILABLE","message":"Try again."}}\n', { headers: { "content-type": "application/x-ndjson" } })) as typeof fetch)
    await expect(replayPendingAction(pending())).rejects.toMatchObject({ code: "AI_UNAVAILABLE" })
  })

  it("does not call a stream that closed early complete", async () => {
    makeWindow(vi.fn(async () => new Response('{"delta":"Half a repl"}\n', { headers: { "content-type": "application/x-ndjson" } })) as typeof fetch)
    await expect(replayPendingAction(pending())).rejects.toThrow(/before completion/)
  })

  it("keeps the saved action when the replay is refused again", async () => {
    makeWindow(vi.fn(async () => refusal()) as typeof fetch)
    const saved = pending()
    expect(savePendingAction(saved)).toBe(true)
    await expect(replayPendingAction(saved)).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" })
    expect(peekPendingAction()?.at).toBe(saved.at)
  })

  it("consumes the streamed reply before reporting completion", async () => {
    makeWindow(vi.fn(async () => new Response('{"delta":"Hello"}\n{"done":true}\n', { headers: { "content-type": "application/x-ndjson" } })) as typeof fetch)
    expect(await replayPendingAction(pending())).toEqual([{ delta: "Hello" }, { done: true }])
  })
})
