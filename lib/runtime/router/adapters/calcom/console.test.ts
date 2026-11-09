import "server-only"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { AppError } from "@/lib/errors"
import { isConsoleMethod, validateConsolePath } from "./console"

vi.mock("server-only", () => ({}))

describe("calcom console path validation (owner-only transport)", () => {
  const original = process.env.CALCOM_BASE_URL

  beforeEach(() => {
    delete process.env.CALCOM_BASE_URL
  })
  afterEach(() => {
    if (original === undefined) delete process.env.CALCOM_BASE_URL
    else process.env.CALCOM_BASE_URL = original
  })

  it("accepts relative v2 paths and preserves the query string", () => {
    expect(validateConsolePath("/v2/me")).toBe("/v2/me")
    expect(validateConsolePath("/v2/bookings?limit=10&status=upcoming")).toBe("/v2/bookings?limit=10&status=upcoming")
  })

  it("rejects absolute URLs, other hosts, and credential material", () => {
    const reject = (path: string) => {
      expect(() => validateConsolePath(path), path).toThrowError(AppError)
    }
    reject("https://evil.example.com/v2/me")
    reject("//evil.example.com/v2/me")
    reject("/v2/../../evil")
    reject("/v1/bookings")
    reject("/v2/me user@evil.com")
    reject("/v2/me\\..\\evil")
    reject("http://api.cal.com/v2/me")
    reject("Bearer x@api.cal.com/v2/me")
  })

  it("stays on a configured base-URL override host", () => {
    process.env.CALCOM_BASE_URL = "https://cal.example.test"
    expect(validateConsolePath("/v2/me")).toBe("/v2/me")
    expect(() => validateConsolePath("//api.cal.com/v2/me")).toThrowError(AppError)
  })

  it("accepts only the documented console methods", () => {
    expect(isConsoleMethod("GET")).toBe(true)
    expect(isConsoleMethod("post")).toBe(false)
    expect(isConsoleMethod("OPTIONS")).toBe(false)
    expect(isConsoleMethod(undefined)).toBe(false)
  })
})
