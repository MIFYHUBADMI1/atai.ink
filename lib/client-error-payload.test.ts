import { describe, expect, it } from "vitest"

import { LIMITS, describeError, normalizeClientErrorReport } from "./client-error-payload"

describe("describeError", () => {
  it("reads message and digest from an Error", () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" })
    expect(describeError(error)).toMatchObject({ message: "boom", digest: "abc123" })
  })

  it("handles a string, a plain object and nothing at all", () => {
    expect(describeError("plain failure").message).toBe("plain failure")
    expect(describeError({ code: "X" }).message).toBe('{"code":"X"}')
    expect(describeError(undefined).message).toBe("Unknown error")
  })

  it("bounds a very long stack", () => {
    const error = new Error("x")
    error.stack = "y".repeat(LIMITS.stack + 100)
    expect(describeError(error).stack).toHaveLength(LIMITS.stack)
  })
})

describe("normalizeClientErrorReport", () => {
  it("rejects a non-object body", () => {
    expect(normalizeClientErrorReport(null)).toBeNull()
    expect(normalizeClientErrorReport("nope")).toBeNull()
    expect(normalizeClientErrorReport([1, 2])).toBeNull()
  })

  it("keeps a valid report and drops unknown keys", () => {
    const report = normalizeClientErrorReport({
      scope: "business",
      message: "it broke",
      digest: "d1",
      path: "/business/b1",
      email: "person@example.com",
      ip: "1.2.3.4",
    })

    expect(report).toEqual({ scope: "business", message: "it broke", digest: "d1", path: "/business/b1" })
  })

  it("falls back to `page` for an unknown scope and to a safe message", () => {
    const report = normalizeClientErrorReport({ scope: "future-boundary", message: 42 })
    expect(report?.scope).toBe("page")
    expect(report?.message).toBe("Unknown error")
  })

  it("truncates oversized fields", () => {
    const report = normalizeClientErrorReport({ message: "m".repeat(2_000), digest: "d".repeat(500) })
    expect(report?.message).toHaveLength(LIMITS.message)
    expect(report?.digest).toHaveLength(LIMITS.digest)
  })
})
