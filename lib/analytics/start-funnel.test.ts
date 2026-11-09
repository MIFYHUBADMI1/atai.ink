import { describe, expect, it } from "vitest"
import { methodForProjectMode, readErrorCode } from "./start-funnel"

describe("start funnel analytics helpers", () => {
  it("maps persisted project modes back to funnel methods", () => {
    expect(methodForProjectMode("scratch")).toBe("idea")
    expect(methodForProjectMode("website")).toBe("website")
    expect(methodForProjectMode("github")).toBe("github")
  })

  it("reads the API error code without leaking the error message", () => {
    const err = Object.assign(new Error("You don't have enough credits for this build."), {
      code: "INSUFFICIENT_CREDITS",
    })
    expect(readErrorCode(err)).toBe("INSUFFICIENT_CREDITS")
    expect(readErrorCode(new TypeError("network"))).toBe("unknown")
    expect(readErrorCode(null)).toBe("unknown")
  })
})
