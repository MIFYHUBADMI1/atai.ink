/**
 * Pure verification rules. The engine never advances a step because the
 * founder clicked somewhere; it advances when one of these conditions is
 * genuinely observed. That distinction is the whole difference between a tour
 * that teaches a workflow and a slideshow that claims one happened.
 */

/** Normalised location so a query-string destination is not satisfied by the
 * bare page underneath it. */
export function splitHref(href: string): { path: string; query: string } {
  const clean = href.split("#")[0] ?? ""
  const [path = "", query = ""] = clean.split("?")
  return { path: path.replace(/\/$/, "") || "/", query }
}

export function locationMatches(expectedHref: string, currentHref: string): boolean {
  if (!expectedHref) return false
  const expected = splitHref(expectedHref)
  const actual = splitHref(currentHref)
  if (expected.path !== actual.path) return false
  if (!expected.query) return true
  // Tab-style destinations must carry the parameters they asked for.
  const want = new URLSearchParams(expected.query)
  const have = new URLSearchParams(actual.query)
  for (const [key, value] of want) {
    if (have.get(key) !== value) return false
  }
  return true
}

export type StepVerdict = "satisfied" | "waiting" | "manual" | "blocked"

/**
 * Decide whether a step is done, given what has been observed.
 * - `navigation`: the app really arrived at the expected location.
 * - `element`: the promised element exists in the DOM (it may have appeared
 *   only after the founder did the work).
 * - `manual`: nothing observable; the founder confirms it themselves.
 * - `blocked`: the element never appeared within the waiting budget.
 */
export function verdictFor(input: {
  verifyType: "route" | "element" | "manual" | "none"
  expectedHref?: string
  currentHref: string
  targetFound: boolean
  waitedOut: boolean
  userConfirmed: boolean
}): StepVerdict {
  if (input.waitedOut && input.verifyType !== "manual") return "blocked"
  switch (input.verifyType) {
    case "route":
      return input.expectedHref && locationMatches(input.expectedHref, input.currentHref) ? "satisfied" : "waiting"
    case "element":
      return input.targetFound ? "satisfied" : "waiting"
    case "manual":
      return input.userConfirmed ? "satisfied" : "manual"
    default:
      return "satisfied"
  }
}

export function verifyTypeOf(step: { verify?: { type: string }; kind: string }): "route" | "element" | "manual" | "none" {
  if (step.verify) return step.verify.type as "route" | "element" | "manual"
  // Interactive steps without a declared proof are confirmed by the founder —
  // never assumed.
  if (step.kind === "click" || step.kind === "input" || step.kind === "action") return "manual"
  return "none"
}

/** How long to wait for a page or element before telling the founder the
 * truth instead of spinning. */
export const WAIT_DEFAULT_MS = 6000
export const WAIT_POLL_HINT_MS = 1500

export function waitBudget(step: { waitMs?: number } | undefined): number {
  const raw = step?.waitMs ?? WAIT_DEFAULT_MS
  return Math.min(Math.max(raw, 500), 20000)
}
