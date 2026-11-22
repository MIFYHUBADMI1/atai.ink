import { describe, expect, it } from "vitest"
import { readingPreviewState } from "./reading-preview-state"

describe("readingPreviewState", () => {
  it("is loading, never empty, before the server answers", () => {
    expect(readingPreviewState(null, null)).toBe("loading")
  })

  it("is empty only once the server has said there is no copy", () => {
    expect(readingPreviewState({ reading: null }, null)).toBe("empty")
  })

  it("is ready when a copy arrived", () => {
    expect(readingPreviewState({ reading: { pagesRead: 3 } }, null)).toBe("ready")
  })

  it("is an error when the request failed and nothing was loaded", () => {
    expect(readingPreviewState(null, "network down")).toBe("error")
  })

  it("keeps showing the copy it has when only the refresh failed", () => {
    expect(readingPreviewState({ reading: { pagesRead: 3 } }, "network down")).toBe("ready")
  })
})
