import { describe, expect, it } from "vitest"
import { resolvePipelineMode } from "./create-project"

describe("resolvePipelineMode", () => {
  it("keeps an existing business on the read rate, whatever the client asked for", () => {
    expect(resolvePipelineMode("existing_business", "heavy")).toBe("legacy")
    expect(resolvePipelineMode("existing_business", undefined)).toBe("legacy")
  })

  it("still defaults a new build to heavy, as the composer expects", () => {
    expect(resolvePipelineMode(undefined, undefined)).toBe("heavy")
    expect(resolvePipelineMode("from_scratch", "legacy")).toBe("legacy")
  })
})
