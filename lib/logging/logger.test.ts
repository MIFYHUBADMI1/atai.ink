import { describe, it, expect, vi, afterEach } from "vitest"
import { logger } from "./logger"

describe("logger secret redaction", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("redacts secret-named fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    logger.info("runtime.auth", "check", { authorization: "Bearer atai_production_shouldneverprint", apiKey: "x" })
    const line = String(spy.mock.calls[0]?.[0])
    expect(line).not.toContain("atai_production_shouldneverprint")
    expect(line).toContain("[redacted]")
  })

  it("redacts secret-shaped values even when the field name is innocuous", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    logger.info("runtime.adapter", "provider failed", {
      detail: "sk-or-v1-thisisnotarealopenrouterkeyvalue",
      requestId: "rtreq_safe",
    })
    const line = String(spy.mock.calls[0]?.[0])
    expect(line).not.toContain("sk-or-v1-thisisnotarealopenrouterkeyvalue")
    expect(line).toContain("[redacted]")
    expect(line).toContain("rtreq_safe")
  })
})

  it("redacts secret-shaped values nested inside objects", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    logger.info("runtime.adapter", "nested", {
      error: { detail: "sk-or-v1-nestedsecretvaluexx", inner: { authorization: "Bearer abc" } },
    })
    const line = String(spy.mock.calls[0]?.[0])
    expect(line).not.toContain("sk-or-v1-nestedsecretvaluexx")
    expect(line).not.toContain("Bearer abc")
    expect(line).toContain("[redacted]")
  })

describe("logger envelope", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("keeps the stage description when a field is also called message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    logger.error("totalum.http", "unexpected error", { path: "/projects/launch", message: "fetch failed" })
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]).replace(/^\[Atai\] /, "")) as Record<string, unknown>
    expect(payload.message).toBe("unexpected error")
    expect(payload.field_message).toBe("fetch failed")
    expect(payload.path).toBe("/projects/launch")
  })
})
