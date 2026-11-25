import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock("./tool-registry", () => ({
  isKnownToolName: (name: unknown) =>
    typeof name === "string" && ["get_plan", "request_build", "stop_build"].includes(name),
}))

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  updateOne: vi.fn(),
}))

vi.mock("@/lib/db/collections", () => ({
  usersCol: vi.fn(() => Promise.resolve({ findOne: mocks.findOne, updateOne: mocks.updateOne })),
}))

import { AppError } from "@/lib/errors"
import {
  DEFAULT_COFOUNDER_HISTORY_DEPTH,
  resolveCofounderSettings,
  writeCofounderSettings,
} from "./profile"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateOne.mockResolvedValue({ matchedCount: 1 })
})

describe("resolveCofounderSettings — defaults and sanitization", () => {
  it("applies the documented defaults", () => {
    const settings = resolveCofounderSettings()
    expect(settings.profile).toMatchObject({
      name: "Co-founder",
      archetype: "strategic",
      detail: 3,
      directness: 3,
      instructions: "",
    })
    expect(settings.context).toMatchObject({
      historyDepth: DEFAULT_COFOUNDER_HISTORY_DEPTH,
      includePlanBrief: true,
      includeAnalytics: true,
      includeRecentProjects: true,
      includeBusinessAssessment: true,
      notes: "",
    })
    expect(settings.tools).toEqual({ disabledTools: [], allowConsequential: true })
  })

  it("replaces an unknown archetype and an unsupported history depth", () => {
    const settings = resolveCofounderSettings({
      profile: { archetype: "wizard" },
      context: { historyDepth: 7 },
    })
    expect(settings.profile.archetype).toBe("strategic")
    expect(settings.context.historyDepth).toBe(DEFAULT_COFOUNDER_HISTORY_DEPTH)
  })

  it("strips control characters from free text", () => {
    const settings = resolveCofounderSettings({
      profile: { instructions: "hello\u0000 world" },
      context: { notes: "note\u0007s" },
    })
    expect(settings.profile.instructions).toBe("hello world")
    expect(settings.context.notes).toBe("notes")
  })

  it("keeps only tools the registry knows, without duplicates", () => {
    const settings = resolveCofounderSettings({
      tools: { disabledTools: ["get_plan", "not_a_tool", "get_plan"] },
    })
    expect(settings.tools.disabledTools).toEqual(["get_plan"])
  })
})

describe("writeCofounderSettings — merging and validation", () => {
  it("merges one section without clearing the others", async () => {
    mocks.findOne.mockResolvedValue({
      cofounderProfile: { name: "Ada", archetype: "operator", detail: 4, directness: 2 },
      cofounderTools: { disabledTools: ["get_plan"], allowConsequential: false },
    })

    await writeCofounderSettings("user_1", { context: { includeAnalytics: false } })

    const set = mocks.updateOne.mock.calls[0][1].$set
    expect(set.cofounderProfile.name).toBe("Ada")
    expect(set.cofounderProfile.archetype).toBe("operator")
    expect(set.cofounderTools.disabledTools).toEqual(["get_plan"])
    expect(set.cofounderTools.allowConsequential).toBe(false)
    expect(set.cofounderContext.includeAnalytics).toBe(false)
  })

  it("rejects an unknown archetype", async () => {
    mocks.findOne.mockResolvedValue({})
    await expect(
      writeCofounderSettings("user_1", { profile: { archetype: "wizard" } }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
    expect(mocks.updateOne).not.toHaveBeenCalled()
  })

  it("rejects an unsupported history depth", async () => {
    mocks.findOne.mockResolvedValue({})
    await expect(
      writeCofounderSettings("user_1", { context: { historyDepth: 7 } }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("refuses an unknown user", async () => {
    mocks.findOne.mockResolvedValue(null)
    const error = await writeCofounderSettings("missing", {}).catch((e) => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe("UNAUTHORIZED")
  })
})
