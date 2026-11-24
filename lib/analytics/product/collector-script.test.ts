import { readFileSync } from "node:fs"
import { join } from "node:path"
import vm from "node:vm"
import { describe, expect, it } from "vitest"

/**
 * The collector is the only part of product analytics that runs in a stranger's
 * browser, so it is tested the way it runs: as a plain script in a sandbox with
 * no DOM library, no network and no build step.
 *
 * These tests pin the promises the snippet makes to the app it is installed in:
 * a page view carries the route and the referring host, a click carries the
 * label a person would use, a client-side route change is a new page, Do Not
 * Track means silence, and nothing is ever sent that could identify a person.
 */

const SOURCE = readFileSync(join(process.cwd(), "public/atai-analytics.js"), "utf8")
const KEY = "atai_production_pk_test_key"

interface Sent {
  url: string
  body: {
    key: string
    events: Array<Record<string, unknown>>
  }
}

function storage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  }
}

function element(tagName: string, label?: string, role?: string) {
  return {
    tagName,
    textContent: label ?? "",
    parentElement: null,
    getAttribute: (name: string) => {
      if (name === "aria-label") return label ?? null
      if (name === "role") return role ?? null
      return null
    },
  }
}

function run(options: { doNotTrack?: string; pathname?: string } = {}) {
  const sent: Sent[] = []
  const listeners: Record<string, Array<(event: unknown) => void>> = {}
  const timers: Array<() => void> = []

  const scriptTag = {
    src: "https://atai.ink/atai-analytics.js",
    getAttribute: (name: string) => (name === "data-atai-key" ? KEY : null),
  }

  const document = {
    currentScript: scriptTag,
    referrer: "https://www.google.com/search?q=shoes",
    visibilityState: "visible",
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      ;(listeners[type] ||= []).push(fn)
    },
    getElementsByTagName: () => [scriptTag],
  }

  const location = {
    pathname: options.pathname ?? "/pricing",
    href: `https://shop.example${options.pathname ?? "/pricing"}`,
  }

  const history = { pushState: () => undefined, replaceState: () => undefined }

  const sandbox: Record<string, unknown> = {
    document,
    location,
    history,
    navigator: {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      ...(options.doNotTrack ? { doNotTrack: options.doNotTrack } : {}),
    },
    window: { addEventListener: () => undefined, crypto: undefined },
    localStorage: storage(),
    sessionStorage: storage(),
    fetch: (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) as Sent["body"] })
      return Promise.resolve({ ok: true })
    },
    Blob: class {
      parts: unknown[]
      constructor(parts: unknown[]) {
        this.parts = parts
      }
    },
    URL,
    JSON,
    Math,
    Date,
    Uint8Array,
    Promise,
    setTimeout: (fn: () => void) => {
      timers.push(fn)
      return timers.length
    },
    clearTimeout: () => undefined,
  }
  sandbox.globalThis = sandbox

  vm.runInNewContext(SOURCE, sandbox, { filename: "atai-analytics.js" })

  const flushTimers = () => {
    while (timers.length) {
      const next = timers.shift()
      next?.()
    }
  }

  const fire = (type: string, event: unknown) => {
    for (const fn of listeners[type] ?? []) fn(event)
  }

  return { sent, fire, flushTimers, listeners, location, history, document }
}

describe("atai-analytics.js", () => {
  it("reports a page view with the route and the referring host", () => {
    const { sent, flushTimers } = run()
    flushTimers()

    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe("https://atai.ink/api/analytics/collect")
    expect(sent[0].body.key).toBe(KEY)

    const [view] = sent[0].body.events
    expect(view.kind).toBe("page_view")
    expect(view.path).toBe("/pricing")
    expect(view.referrer).toBe("https://www.google.com/search?q=shoes")
    expect(view.device).toBe("desktop")
    expect(typeof view.visitorId).toBe("string")
    expect(typeof view.sessionId).toBe("string")
  })

  it("reports a click with the label a person would use, never input values", () => {
    const { sent, fire, flushTimers } = run()
    fire("click", { target: element("BUTTON", "  Start free   trial ") })
    flushTimers()

    const events = sent.flatMap((batch) => batch.body.events)
    const click = events.find((event) => event.kind === "click")
    expect(click).toBeDefined()
    expect(click?.element).toEqual({ role: "button", label: "Start free trial" })
    expect(click?.path).toBe("/pricing")
  })

  it("treats a client-side route change as a new page, and records the leave", () => {
    const { sent, flushTimers, history, location } = run()
    flushTimers()

    location.pathname = "/checkout"
    history.pushState({}, "", "/checkout")
    flushTimers()

    const events = sent.flatMap((batch) => batch.body.events)

    // A hop that takes under half a second is a redirect, not a visit worth
    // reporting as "left this page" — so no leave is fabricated.
    expect(events.some((event) => event.kind === "page_leave")).toBe(false)

    const arrived = events.filter((event) => event.kind === "page_view")
    expect(arrived.map((event) => event.path)).toEqual(["/pricing", "/checkout"])
    // One visit, one session id: a route change is not a new person.
    expect(new Set(events.map((event) => event.sessionId)).size).toBe(1)
  })

  it("reports the leave with the time spent when the tab is hidden", () => {
    const { sent, fire, flushTimers, document } = run()
    document.visibilityState = "hidden"
    fire("visibilitychange", {})
    flushTimers()

    const events = sent.flatMap((batch) => batch.body.events)
    const left = events.find((event) => event.kind === "page_leave")
    expect(left?.path).toBe("/pricing")
    expect(typeof left?.durationMs).toBe("number")
  })

  it("stays silent when the visitor sends Do Not Track", () => {
    const { sent, listeners, flushTimers } = run({ doNotTrack: "1" })
    flushTimers()

    expect(sent).toHaveLength(0)
    expect(Object.keys(listeners)).toHaveLength(0)
  })

  it("never sends an IP, a user agent, a cookie or a page body", () => {
    const { sent, flushTimers } = run()
    flushTimers()

    const serialised = JSON.stringify(sent[0].body)
    expect(serialised).not.toMatch(/userAgent|Mozilla|ip|cookie/i)
    expect(serialised).not.toMatch(/<html|document\./)
  })
})
