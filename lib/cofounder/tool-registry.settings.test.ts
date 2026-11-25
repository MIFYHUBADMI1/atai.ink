import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  allowedBySettings,
  confirmationTools,
  getTool,
  immediateTools,
  isKnownToolName,
  listToolCatalog,
} from "./tool-registry"

describe("tool registry — founder narrowing", () => {
  it("removes a disabled tool from both surfaces", () => {
    const settings = { disabledTools: ["get_plan", "create_project"] }
    const build = [...immediateTools("build", settings), ...confirmationTools("build", settings)].map((t) => t.name)
    expect(build).not.toContain("get_plan")
    expect(build).not.toContain("create_project")
  })

  it("leaves only READ tools when the founder sets the read-only ceiling", () => {
    const settings = { allowConsequential: false }
    const build = [...immediateTools("build", settings), ...confirmationTools("build", settings)]
    expect(build.length).toBeGreaterThan(0)
    for (const tool of build) expect(tool.risk).toBe("READ")
    expect(build.map((t) => t.name)).not.toContain("stop_build")
    expect(build.map((t) => t.name)).not.toContain("create_project")
  })

  it("cannot add a tool that is not in the registry", () => {
    const settings = { disabledTools: [] as string[] }
    const names = [...immediateTools("build", settings), ...confirmationTools("build", settings)].map((t) => t.name)
    expect(names).not.toContain("manage_runtime_keys")
    expect(getTool("manage_runtime_keys")).toBeUndefined()
  })

  it("recognises only registered tool names", () => {
    expect(isKnownToolName("get_plan")).toBe(true)
    expect(isKnownToolName("not_a_tool")).toBe(false)
    expect(isKnownToolName(42)).toBe(false)
  })

  it("exposes a read-only catalog with surfaces", () => {
    const catalog = listToolCatalog()
    const createProject = catalog.find((t) => t.name === "create_project")
    expect(createProject?.surfaces).toEqual(["build"])
    const plan = catalog.find((t) => t.name === "get_plan")
    expect(plan?.surfaces).toEqual(["build"])
    const assessment = catalog.find((t) => t.name === "get_business_assessment")
    expect(assessment?.surfaces).toEqual(["build", "operate"])
  })

  it("applies both filters together", () => {
    const tool = getTool("get_plan")!
    expect(allowedBySettings(tool, {})).toBe(true)
    expect(allowedBySettings(tool, { disabledTools: ["get_plan"] })).toBe(false)
    expect(allowedBySettings(tool, { allowConsequential: false })).toBe(true)
    const write = getTool("stop_build")!
    expect(allowedBySettings(write, { allowConsequential: false })).toBe(false)
  })
})
