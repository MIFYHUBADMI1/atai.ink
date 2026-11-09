import { describe, expect, it } from "vitest"
import { projectIdFromName, validateProjectId } from "./project-id"

describe("project IDs", () => {
  it("turns a project title into an unbranded subdomain suggestion", () => {
    expect(projectIdFromName("Insight Flow")).toBe("insight-flow")
  })

  it("accepts DNS-safe project IDs", () => {
    expect(validateProjectId("insight-flow-2")).toBeNull()
  })

  it.each(["ab", "InsightFlow", "-insight", "insight-", "insight_flow"])(
    "rejects %s",
    (value) => expect(validateProjectId(value)).not.toBeNull(),
  )
})
