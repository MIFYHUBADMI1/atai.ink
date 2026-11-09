import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { salvageTruncatedJson } from "./json-parser"

describe("salvageTruncatedJson", () => {
  it("recovers complete array elements from a response cut mid-object", () => {
    const truncated = '{"missingFeatures": [{"description": "Admin Dashboard", "severity": "critical"}, {"description": "User Man'
    const salvaged = salvageTruncatedJson(truncated) as any
    expect(salvaged).not.toBeNull()
    expect(salvaged.missingFeatures).toEqual([{ description: "Admin Dashboard", severity: "critical" }])
  })

  it("recovers complete entries when cut mid-string", () => {
    const truncated = '{"securityConcerns": [{"description": "No auth"}], "uxGaps": [{"description": "Missing loading s'
    const salvaged = salvageTruncatedJson(truncated) as any
    expect(salvaged).not.toBeNull()
    expect(salvaged.securityConcerns).toHaveLength(1)
    expect(salvaged.uxGaps ?? []).toHaveLength(0)
  })

  it("ignores braces and brackets inside strings", () => {
    const truncated = '{"notes": ["a } b", "[c", '
    const salvaged = salvageTruncatedJson(truncated) as any
    expect(salvaged).not.toBeNull()
    expect(salvaged.notes).toEqual(["a } b", "[c"])
  })

  it("returns null when nothing usable precedes the cut", () => {
    expect(salvageTruncatedJson('{"missingFeatures": [{"descri')).toBeNull()
  })

  it("returns null for text that is already complete JSON (caller's own parse wins)", () => {
    expect(salvageTruncatedJson('{"a": 1}')).toBeNull()
  })

  it("returns null when there is no object at all", () => {
    expect(salvageTruncatedJson("no json here")).toBeNull()
  })
})
