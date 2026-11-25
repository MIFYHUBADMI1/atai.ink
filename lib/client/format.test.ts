import { describe, expect, it } from "vitest"

import { formatNumber, formatTimestamp } from "./format"

/**
 * These pin the locale and timezone. The failure they prevent is not cosmetic:
 * an unpinned `toLocaleString()` renders differently on the server and in a
 * `de-DE`/far-east browser, which is a hydration mismatch on every business
 * page that shows a date or a credit count.
 */
describe("formatNumber", () => {
  it("uses en-US grouping regardless of the runtime locale", () => {
    expect(formatNumber(1_234_567)).toBe("1,234,567")
    expect(formatNumber(1_000)).toBe("1,000")
    expect(formatNumber(0)).toBe("0")
  })

  it("renders a dash for missing or non-finite values", () => {
    expect(formatNumber(null)).toBe("—")
    expect(formatNumber(undefined)).toBe("—")
    expect(formatNumber(Number.NaN)).toBe("—")
  })
})

describe("formatTimestamp", () => {
  it("formats in UTC, not the browser's timezone", () => {
    // 1970-01-01T00:00:00Z is 1970-01-01 in UTC and 1969-12-31 west of it.
    expect(formatTimestamp(0)).toContain("Jan 1, 1970")
    expect(formatTimestamp(Date.UTC(2026, 10, 25, 11, 46))).toContain("Nov 25, 2026")
  })

  it("returns an empty string for missing or invalid input", () => {
    expect(formatTimestamp(null)).toBe("")
    expect(formatTimestamp(undefined)).toBe("")
    expect(formatTimestamp("not-a-date")).toBe("")
  })
})
