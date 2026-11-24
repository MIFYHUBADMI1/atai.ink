import { describe, expect, it } from "vitest"

import {
  eventNameFor,
  inferDevice,
  isBotUserAgent,
  normaliseKind,
  normaliseLabel,
  normalisePath,
  referrerHost,
} from "./normalize"

/**
 * These rules decide what a number means, so they are pinned:
 * two visits to different records must count as one page, a monitor must not
 * count as a visitor, and a referring URL must never be stored whole.
 */
describe("normalisePath", () => {
  it("collapses id-shaped segments so a list is a list, not a thousand pages", () => {
    expect(normalisePath("/orders/12345")).toBe("/orders/:id")
    expect(normalisePath("/orders/12345")).toBe(normalisePath("/orders/98765"))
    expect(normalisePath("/u/9f1c2b3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d")).toBe("/u/:id")
    expect(normalisePath("/posts/507f1f77bcf86cd799439011")).toBe("/posts/:id")
  })

  it("drops the query and hash, and accepts a full URL", () => {
    expect(normalisePath("/pricing?utm_source=x#plans")).toBe("/pricing")
    expect(normalisePath("https://shop.example/checkout?step=2")).toBe("/checkout")
  })

  it("keeps a readable slug and normalises the leading slash", () => {
    expect(normalisePath("pricing/teams")).toBe("/pricing/teams")
    expect(normalisePath("/")).toBe("/")
  })

  it("returns nothing for nothing", () => {
    expect(normalisePath("")).toBeUndefined()
    expect(normalisePath(undefined)).toBeUndefined()
  })
})

describe("normaliseLabel", () => {
  it("collapses whitespace and caps the length", () => {
    expect(normaliseLabel("  Start   free\ttrial ")).toBe("Start free trial")
    expect(normaliseLabel("x".repeat(200))?.length).toBe(80)
  })
})

describe("isBotUserAgent", () => {
  it("recognises the traffic that would inflate every number", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true)
    expect(isBotUserAgent("curl/8.4.0")).toBe(true)
    expect(isBotUserAgent("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe(true)
    expect(isBotUserAgent("Slackbot-LinkExpanding 1.0")).toBe(true)
  })

  it("lets a real browser through", () => {
    expect(
      isBotUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      ),
    ).toBe(false)
    expect(isBotUserAgent(undefined)).toBe(false)
  })
})

describe("inferDevice", () => {
  it("separates phone, tablet and desktop without a fingerprint", () => {
    expect(inferDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari")).toBe("mobile")
    expect(inferDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari")).toBe("tablet")
    expect(inferDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36")).toBe("desktop")
    expect(inferDevice("")).toBeUndefined()
  })
})

describe("referrerHost", () => {
  it("keeps the host and throws away another site's path and query", () => {
    expect(referrerHost("https://www.google.com/search?q=private+thing")).toBe("www.google.com")
  })

  it("refuses anything that is not an http(s) referrer", () => {
    expect(referrerHost("javascript:alert(1)")).toBeUndefined()
    expect(referrerHost("")).toBeUndefined()
  })
})

describe("normaliseKind and eventNameFor", () => {
  it("treats an unknown kind as custom", () => {
    expect(normaliseKind("nonsense")).toBe("custom")
    expect(normaliseKind(undefined)).toBe("custom")
    expect(normaliseKind("PAGE_VIEW")).toBe("page_view")
  })

  it("names an interaction by its kind, and a custom event by its own name", () => {
    expect(eventNameFor("page_view", "Viewed pricing")).toBe("page_view")
    expect(eventNameFor("click", undefined)).toBe("click")
    expect(eventNameFor("custom", "checkout_started")).toBe("checkout_started")
    expect(eventNameFor("custom", "")).toBe("custom")
  })
})
