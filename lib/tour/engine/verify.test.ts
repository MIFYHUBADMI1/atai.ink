import { describe, expect, it } from "vitest"
import { WAIT_DEFAULT_MS, locationMatches, splitHref, verifyTypeOf, verdictFor, waitBudget } from "./verify"

/**
 * Verification is the difference between a tour and a slideshow. These are the
 * exact conditions under which a step is allowed to say "done" — and, just as
 * importantly, the many under which it must not.
 */

describe("location matching", () => {
  it("normalises a trailing slash but keeps the path", () => {
    expect(splitHref("/projects/")).toEqual({ path: "/projects", query: "" })
    expect(splitHref("/")).toEqual({ path: "/", query: "" })
  })

  it("requires the tab parameter a step asked for", () => {
    expect(locationMatches("/project/p1/ads?tab=bench", "/project/p1/ads")).toBe(false)
    expect(locationMatches("/project/p1/ads?tab=bench", "/project/p1/ads?tab=bench")).toBe(true)
    expect(locationMatches("/project/p1/ads?tab=bench", "/project/p1/ads?tab=requests")).toBe(false)
    // Extra parameters the page adds by itself are still the same page.
    expect(locationMatches("/project/p1/ads?tab=bench", "/project/p1/ads?tab=bench&open=1")).toBe(true)
  })

  it("treats a bare path as satisfied by any query", () => {
    expect(locationMatches("/project/p1/plan", "/project/p1/plan?v=3")).toBe(true)
  })

  it("never matches on an empty expectation", () => {
    expect(locationMatches("", "/dashboard")).toBe(false)
  })
})

describe("what a step's proof is", () => {
  it("uses the declared proof when there is one", () => {
    expect(verifyTypeOf({ kind: "info", verify: { type: "element" } })).toBe("element")
    expect(verifyTypeOf({ kind: "action", verify: { type: "route" } })).toBe("route")
  })

  it("falls back to the founder's own confirmation for interactive steps", () => {
    // Nothing the engine can observe proves the founder typed, clicked or
    // published something, so it asks rather than assuming.
    for (const kind of ["click", "input", "action"]) {
      expect(verifyTypeOf({ kind })).toBe("manual")
    }
  })

  it("needs no proof to explain something", () => {
    expect(verifyTypeOf({ kind: "info" })).toBe("none")
    expect(verifyTypeOf({ kind: "completion" })).toBe("none")
  })
})

describe("verdicts", () => {
  it("waits for the real navigation", () => {
    const base = { verifyType: "route" as const, expectedHref: "/project/p1/market", currentHref: "/dashboard", targetFound: false, waitedOut: false, userConfirmed: false }
    expect(verdictFor(base)).toBe("waiting")
    expect(verdictFor({ ...base, currentHref: "/project/p1/market" })).toBe("satisfied")
  })

  it("is not satisfied by the wrong page", () => {
    expect(
      verdictFor({
        verifyType: "route",
        expectedHref: "/project/p1/market",
        currentHref: "/project/p1/market-thing",
        targetFound: true,
        waitedOut: false,
        userConfirmed: true,
      }),
    ).toBe("waiting")
  })

  it("needs the element to actually exist", () => {
    const base = { verifyType: "element" as const, currentHref: "/dashboard", targetFound: false, waitedOut: false, userConfirmed: false }
    expect(verdictFor(base)).toBe("waiting")
    expect(verdictFor({ ...base, targetFound: true })).toBe("satisfied")
  })

  it("never assumes an action happened because time passed", () => {
    const manual = { verifyType: "manual" as const, currentHref: "/dashboard", targetFound: true, waitedOut: false, userConfirmed: false }
    expect(verdictFor(manual)).toBe("manual")
    expect(verdictFor({ ...manual, userConfirmed: true })).toBe("satisfied")
  })

  it("says blocked rather than spinning when the element never arrives", () => {
    expect(
      verdictFor({
        verifyType: "element",
        currentHref: "/dashboard",
        targetFound: false,
        waitedOut: true,
        userConfirmed: false,
      }),
    ).toBe("blocked")
  })

  it("still lets a founder confirm a manual step whose target went missing", () => {
    // The copy asks them to do something on their own; a spotlight that gave up
    // must not trap them in the tour.
    expect(
      verdictFor({ verifyType: "manual", currentHref: "/dashboard", targetFound: false, waitedOut: true, userConfirmed: false }),
    ).toBe("manual")
  })
})

describe("waiting budgets", () => {
  it("has a default and clamps both ends so no step waits forever", () => {
    expect(waitBudget(undefined)).toBe(WAIT_DEFAULT_MS)
    expect(waitBudget({ waitMs: 1 })).toBe(500)
    expect(waitBudget({ waitMs: 10 * 60_000 })).toBe(20_000)
    expect(waitBudget({ waitMs: 2500 })).toBe(2500)
  })
})
