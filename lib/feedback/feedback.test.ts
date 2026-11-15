import { describe, expect, it } from "vitest"
import {
  canTransitionStatus,
  categoryLabel,
  feedbackTextScore,
  fingerprintText,
  isFeedbackCategory,
  isFeedbackSeverity,
  isFeedbackStatus,
  isRewardableStatus,
  suggestSeverity,
} from "./config"
import { sanitizeText, sanitizeUrl } from "./diagnostics"
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, STATUS_LABEL } from "./types"

describe("feedback categories & statuses", () => {
  it("covers the eight required categories", () => {
    expect(FEEDBACK_CATEGORIES.map((c) => c.id)).toEqual([
      "broken", "error", "page_load", "performance", "incorrect", "security", "improvement", "other",
    ])
  })
  it("validates category/status/severity inputs", () => {
    expect(isFeedbackCategory("broken")).toBe(true)
    expect(isFeedbackCategory("nope")).toBe(false)
    expect(isFeedbackStatus("verified")).toBe(true)
    expect(isFeedbackStatus("done")).toBe(false)
    expect(isFeedbackSeverity("P0")).toBe(true)
    expect(isFeedbackSeverity("P9")).toBe(false)
    expect(categoryLabel("security")).toBe("Security concern")
    expect(STATUS_LABEL.resolved).toBe("Resolved")
  })
})

describe("status transitions", () => {
  it("allows the normal triage flow", () => {
    expect(canTransitionStatus("new", "reviewing")).toBe(true)
    expect(canTransitionStatus("reviewing", "verified")).toBe(true)
    expect(canTransitionStatus("verified", "in_progress")).toBe(true)
    expect(canTransitionStatus("in_progress", "resolved")).toBe(true)
  })
  it("blocks skipping verification for rewards", () => {
    expect(canTransitionStatus("new", "resolved")).toBe(false)
    expect(isRewardableStatus("new")).toBe(false)
    expect(isRewardableStatus("verified")).toBe(true)
    expect(isRewardableStatus("resolved")).toBe(true)
    expect(isRewardableStatus("rejected")).toBe(false)
  })
  it("allows reopening rejected reports", () => {
    expect(canTransitionStatus("rejected", "reviewing")).toBe(true)
    expect(canTransitionStatus("duplicate", "new")).toBe(true)
  })
})

describe("severity suggestion", () => {
  it("flags security as P0", () => {
    expect(suggestSeverity({ category: "security", description: "minor typo" })).toBe("P0")
  })
  it("flags outage/payment language as high", () => {
    expect(suggestSeverity({ category: "broken", description: "I can't log in, payment failed" })).toBe("P1")
  })
  it("suggests P4 for improvements", () => {
    expect(suggestSeverity({ category: "improvement", description: "would be nice to have dark mode" })).toBe("P4")
  })
})

describe("similarity & fingerprints", () => {
  it("scores identical text highly", () => {
    expect(feedbackTextScore("checkout button does nothing", "checkout button does nothing")).toBe(1)
    expect(feedbackTextScore("checkout button broken", "totally unrelated words here")).toBe(0)
  })
  it("produces stable fingerprints", () => {
    expect(fingerprintText("TypeError: x is undefined")).toBe(fingerprintText("TypeError: x is undefined"))
    expect(fingerprintText("a")).not.toBe(fingerprintText("b"))
  })
})

describe("diagnostic sanitisation", () => {
  it("redacts bearer tokens and key=value secrets", () => {
    const dirty = "failed with Bearer abc.def.ghi and api_key=sk-live-12345 token=xyz"
    const clean = sanitizeText(dirty)
    expect(clean).not.toContain("abc.def.ghi")
    expect(clean).not.toContain("sk-live-12345")
    expect(clean).toContain("[redacted]")
  })
  it("masks emails", () => {
    expect(sanitizeText("user bob@example.com failed")).not.toContain("bob@example.com")
    expect(sanitizeText("user bob@example.com failed")).toContain("[email]")
  })
  it("collapses whitespace and truncates", () => {
    const long = `  ${"word ".repeat(400)}  `
    const out = sanitizeText(long)
    expect(out.length).toBeLessThanOrEqual(501)
    expect(out).not.toMatch(/ {2,}/)
  })
  it("strips query strings that may carry tokens", () => {
    expect(sanitizeUrl("https://atai.ink/dashboard?token=secret&x=1")).toBe("https://atai.ink/dashboard")
    expect(sanitizeUrl("/project/abc?session=zzz")).toBe("/project/abc")
    expect(sanitizeUrl("not a url ???")).toBe("not a url")
  })
})
