import { afterEach, describe, expect, it, vi } from "vitest"
import { businessWorkspaceMode, isBusinessWorkspaceEnabled } from "./flags"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("CONNECTED_WORKSPACE_V2", () => {
  it("is off when unset", () => {
    vi.stubEnv("CONNECTED_WORKSPACE_V2", "")
    expect(businessWorkspaceMode()).toBe("off")
    expect(isBusinessWorkspaceEnabled("u1")).toBe(false)
  })

  it("fails closed on an unrecognised value", () => {
    vi.stubEnv("CONNECTED_WORKSPACE_V2", "yes-please")
    expect(businessWorkspaceMode()).toBe("off")
    expect(isBusinessWorkspaceEnabled("u1")).toBe(false)
  })

  it("opens only for the cohort in internal mode", () => {
    vi.stubEnv("CONNECTED_WORKSPACE_V2", "internal")
    vi.stubEnv("CONNECTED_WORKSPACE_COHORT", "u1, u2")
    expect(isBusinessWorkspaceEnabled("u2")).toBe(true)
    expect(isBusinessWorkspaceEnabled("u3")).toBe(false)
  })

  it("opens for everyone in all mode", () => {
    vi.stubEnv("CONNECTED_WORKSPACE_V2", "all")
    vi.stubEnv("CONNECTED_WORKSPACE_COHORT", "")
    expect(isBusinessWorkspaceEnabled("anyone")).toBe(true)
  })
})
