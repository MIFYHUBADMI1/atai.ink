import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The collector is a public endpoint on a stranger's domain, so these tests are
 * about what it refuses as much as what it records:
 *
 *   - only a PUBLISHABLE key may write here (a secret key lifted from a server
 *     environment must not become a browser credential);
 *   - the project comes from the key, never from the body;
 *   - a crawler is answered and stored as nothing;
 *   - the browser gets CORS, because the app is on another origin;
 *   - the paths are grouped (`/orders/123` and `/orders/456` are one page).
 */

const mocks = vi.hoisted(() => ({
  findActiveApiKeyBySecret: vi.fn(),
  recordEvents: vi.fn(),
  checkRateLimit: vi.fn(),
}))

vi.mock("@/lib/runtime/keys/service", () => ({
  findActiveApiKeyBySecret: mocks.findActiveApiKeyBySecret,
}))
vi.mock("@/lib/runtime/router/adapters/analytics/store", () => ({ recordEvents: mocks.recordEvents }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }))

import { OPTIONS, POST } from "./route"

const PUBLISHABLE = "atai_production_pk_abc"
const SECRET = "atai_production_secret"

function publishableKey() {
  return {
    id: "rkey_1",
    userId: "user_1",
    projectId: "proj_1",
    environment: "production" as const,
    kind: "publishable" as const,
    scopes: ["analytics"],
    status: "active" as const,
    keyHash: "hash",
    keyPrefix: "atai_production_pk_abc…",
    createdAt: 0,
  }
}

function collect(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://atai.ink/api/analytics/collect", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh) Chrome/126.0 Safari/537.36",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/analytics/collect", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findActiveApiKeyBySecret.mockResolvedValue(publishableKey())
    mocks.recordEvents.mockImplementation(async (events: unknown[]) => events.length)
    mocks.checkRateLimit.mockResolvedValue(undefined)
  })

  it("answers CORS preflight so a browser on another origin may post", () => {
    const response = OPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(response.headers.get("access-control-allow-methods")).toContain("POST")
  })

  it("records events into the project behind the key, with grouped paths", async () => {
    const response = await POST(
      collect({
        key: PUBLISHABLE,
        events: [
          { name: "page_view", kind: "page_view", path: "/orders/12345", sessionId: "s1", visitorId: "v1" },
          { name: "click", kind: "click", path: "/orders/12345", element: { role: "button", label: "  Pay now " } },
        ],
      }),
    )

    const body = (await response.json()) as { ok: boolean; data: { accepted: number } }
    expect(response.status).toBe(200)
    expect(body.data.accepted).toBe(2)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")

    const [events] = mocks.recordEvents.mock.calls[0] as [Array<Record<string, unknown>>]
    expect(events).toHaveLength(2)
    expect(events[0].projectId).toBe("proj_1")
    expect(events[0].environment).toBe("production")
    expect(events[0].path).toBe("/orders/:id")
    expect(events[1].element).toEqual({ role: "button", label: "Pay now" })
  })

  it("accepts the key as a bearer token, because sendBeacon cannot set headers", async () => {
    const response = await POST(
      new Request("https://atai.ink/api/analytics/collect", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          authorization: `Bearer ${PUBLISHABLE}`,
          "user-agent": "Mozilla/5.0 Chrome/126.0",
        },
        body: JSON.stringify({ events: [{ name: "page_view", kind: "page_view", path: "/" }] }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.findActiveApiKeyBySecret).toHaveBeenCalledWith(PUBLISHABLE)
  })

  it("refuses a secret key — a server credential is not a browser credential", async () => {
    mocks.findActiveApiKeyBySecret.mockResolvedValue({ ...publishableKey(), kind: undefined })

    const response = await POST(collect({ key: SECRET, events: [{ name: "page_view" }] }))

    expect(response.status).toBe(401)
    expect(mocks.recordEvents).not.toHaveBeenCalled()
  })

  it("refuses a request with no key at all", async () => {
    const response = await POST(collect({ events: [{ name: "page_view" }] }))
    expect(response.status).toBe(401)
    expect(mocks.recordEvents).not.toHaveBeenCalled()
  })

  it("drops a crawler without recording or failing", async () => {
    const response = await POST(
      collect(
        { key: PUBLISHABLE, events: [{ name: "page_view" }] },
        { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      ),
    )

    const body = (await response.json()) as { ok: boolean; data: { accepted: number } }
    expect(response.status).toBe(200)
    expect(body.data.accepted).toBe(0)
    expect(mocks.recordEvents).not.toHaveBeenCalled()
  })

  it("reports a rate limit as 429 with CORS, not as a broken page", async () => {
    mocks.checkRateLimit.mockRejectedValue(new Error("RATE_LIMITED"))

    const response = await POST(collect({ key: PUBLISHABLE, events: [{ name: "page_view" }] }))

    expect(response.status).toBe(429)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(mocks.recordEvents).not.toHaveBeenCalled()
  })

  it("rejects a malformed batch with 422 and records nothing", async () => {
    const response = await POST(collect({ key: PUBLISHABLE, events: [{ notAnEvent: true }] }))
    expect(response.status).toBe(422)
    expect(mocks.recordEvents).not.toHaveBeenCalled()
  })
})
