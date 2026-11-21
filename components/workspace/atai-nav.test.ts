import { describe, expect, it } from "vitest"
import { workspaceGrowNav, workspaceIntelligenceNav, workspaceProjectNav } from "./atai-nav"

/**
 * The nav is where the two journeys stay apart. Build artifacts (source,
 * editor, database, environment, hosting, export) describe an app Atai owns,
 * so they stay closed for a connected business; advice sections open for any
 * real business. These pins stop a future entry from quietly defaulting open.
 */
describe("workspace nav gating", () => {
  it("keeps build artifacts behind `built` and only runtime behind `business`", () => {
    const items = workspaceProjectNav("p1")

    expect(items.filter((i) => i.requires === "built").map((i) => i.label)).toEqual([
      "Edit app",
      "Source",
      "Database",
      "Environment",
      "Hosting",
      "Export snapshot",
    ])
    expect(items.filter((i) => i.requires === "business").map((i) => i.label)).toEqual(["Runtime"])
  })

  it("opens every grow and intelligence section for a connected business", () => {
    const gated = [...workspaceGrowNav("p1"), ...workspaceIntelligenceNav("p1")]

    expect(gated.length).toBeGreaterThan(0)
    expect(gated.every((i) => i.requires === "business")).toBe(true)
  })
})
