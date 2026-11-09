import { describe, expect, it } from "vitest"
import {
  captureRequest,
  describeAction,
  extractShortfallFacts,
  isInsufficientCreditsCode,
  parseCreditBlockHeader,
  parseCreditShortfall,
  peekPendingAction,
  savePendingAction,
  hasPaymentHandoff,
  type CreditShortfall,
} from "./credit-gate"

const buildRequest = { url: "/api/projects/p-1/build", method: "POST" as const, body: '{"tier":"complex"}', contentType: "application/json", form: null }

function shortfall(overrides: Partial<CreditShortfall> = {}): CreditShortfall {
  return {
    code: "INSUFFICIENT_CREDITS",
    message: "You don't have enough credits for this build.",
    required: 100_000,
    available: 420,
    action: "your build",
    at: Date.now(),
    request: buildRequest,
    ...overrides,
  }
}

describe("isInsufficientCreditsCode", () => {
  it("recognises both vocabularies the server uses", () => {
    expect(isInsufficientCreditsCode("INSUFFICIENT_CREDITS")).toBe(true)
    expect(isInsufficientCreditsCode("runtime_insufficient_entitlement")).toBe(true)
    expect(isInsufficientCreditsCode("PAYMENT_UNAVAILABLE")).toBe(false)
    expect(isInsufficientCreditsCode(undefined)).toBe(false)
  })
})

describe("extractShortfallFacts", () => {
  it("reads the numbers out of the wording routes actually ship", () => {
    const cases: Array<[string, number | null, number | null]> = [
      ["You don't have enough credits for this build. Required: 100,000, Available: 420.", 100_000, 420],
      ["You need 75,000 credits for this edit (medium tier). Available: 1,200.", 75_000, 1_200],
      ["Deploying requires 500 credits. Available: 120.", 500, 120],
      ["You need 100 credits to research competitors.", 100, null],
      ["Insufficient credits. You have 40 but need 5,000.", 5_000, null],
      ["You need 2 credits for this message.", 2, null],
      ["You don't have enough credits for this message.", null, null],
    ]
    for (const [message, required, available] of cases) {
      expect(extractShortfallFacts(message), message).toEqual({ required, available })
    }
  })
})

describe("parseCreditShortfall", () => {
  it("takes the structured numbers a route sent", () => {
    const parsed = parseCreditShortfall(
      { ok: false, error: { code: "INSUFFICIENT_CREDITS", message: "nope", meta: { required: 500, available: 12 } } },
      buildRequest,
    )
    expect(parsed?.required).toBe(500)
    expect(parsed?.available).toBe(12)
    expect(parsed?.action).toBe("your build")
  })

  it("falls back to the prose when a route has no structured numbers yet", () => {
    const parsed = parseCreditShortfall(
      {
        ok: false,
        error: { code: "INSUFFICIENT_CREDITS", message: "You need 100 credits to research competitors." },
      },
      { url: "/api/projects/p-1/resources/competitors", method: "POST", body: "{}", contentType: "application/json", form: null },
    )
    expect(parsed?.required).toBe(100)
    expect(parsed?.action).toBe("the resource report")
  })

  it("ignores anything that is not a credit refusal", () => {
    expect(parseCreditShortfall({ ok: true, data: {} }, buildRequest)).toBe(null)
    expect(parseCreditShortfall({ ok: false, error: { code: "AI_UNAVAILABLE" } }, buildRequest)).toBe(null)
    expect(parseCreditShortfall("<html>502</html>", buildRequest)).toBe(null)
    expect(parseCreditShortfall(null, buildRequest)).toBe(null)
  })
})

describe("describeAction", () => {
  it("names the work the founder was doing", () => {
    expect(describeAction("/api/projects/p-1/build")).toBe("your build")
    expect(describeAction("/api/projects/p-1/agent")).toBe("your edit request")
    expect(describeAction("/api/projects/p-1/deploy")).toBe("launching your site")
    expect(describeAction("/api/projects/p-1/plan-chat")).toBe("your co-founder's reply")
    expect(describeAction("/api/projects/p-1/generate-visual")).toBe("the visual mockup")
    expect(describeAction("/api/projects/p-1/studio/refine")).toBe("the content studio")
    expect(describeAction("/api/runtime/v1")).toBe("an AI call")
  })

  it("stays generic for endpoints it does not know", () => {
    expect(describeAction("/api/projects/p-1/settings")).toBe("this")
  })
})

describe("captureRequest", () => {
  it("snapshots the bodies a route can be handed again", () => {
    expect(captureRequest("/api/projects/p-1/build", { method: "POST", body: '{"a":1}' })).toEqual({
      url: "/api/projects/p-1/build",
      method: "POST",
      body: '{"a":1}',
      contentType: null,
      form: null,
    })
    expect(
      captureRequest("/api/projects/p-1/deploy", {
        method: "POST",
        body: new URLSearchParams({ tier: "complex" }),
      }),
    ).toMatchObject({ body: "tier=complex", contentType: "application/x-www-form-urlencoded;charset=UTF-8" })
    const form = new FormData()
    form.append("note", "ship it")
    form.append("count", "3")
    expect(captureRequest("/api/projects/p-1/agent", { method: "POST", body: form })).toEqual({
      url: "/api/projects/p-1/agent",
      method: "POST",
      body: null,
      contentType: null,
      form: [
        ["note", "ship it"],
        ["count", "3"],
      ],
    })
    expect(captureRequest("/api/projects/p-1/build", { method: "POST" })).toMatchObject({ body: null, form: null })
  })

  it("refuses to promise a replay it cannot deliver", () => {
    expect(captureRequest("/api/projects/p-1/build", { method: "GET" })).toBe(null)
    expect(captureRequest("https://other.example.com/api/build")).toBe(null)
    expect(captureRequest("/api/billing/checkout", { method: "POST", body: "{}" })).toBe(null)
    expect(captureRequest("/api/projects/p-1/build", { method: "POST", body: "x".repeat(20_001) })).toBe(null)
    const upload = new FormData()
    upload.append("file", new Blob(["hi"]), "site.zip")
    expect(captureRequest("/api/projects/p-1/fork", { method: "POST", body: upload })).toBe(null)
  })
})

describe("parseCreditBlockHeader", () => {
  it("turns a flagged poll into a shortfall with nothing to resume", () => {
    const at = Date.now()
    const header = encodeURIComponent(JSON.stringify({ required: 500, available: 12, action: "the website analysis", at }))
    expect(parseCreditBlockHeader(header)).toMatchObject({
      required: 500,
      action: "the website analysis",
      request: null,
      pipeline: true,
    })
  })
})

describe("storage guards", () => {
  // There is no DOM in this suite: the browser-only helpers must no-op quietly
  // instead of throwing during server render.
  it("do not throw without a window", () => {
    expect(() => savePendingAction(shortfall())).not.toThrow()
    expect(peekPendingAction()).toBe(null)
    expect(hasPaymentHandoff()).toBe(false)
  })
})
