import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MirrorProject } from "@/lib/types/project"

const listProjects = vi.fn()

vi.mock("@/lib/store/store", () => ({
  store: { listProjects: (...args: unknown[]) => listProjects(...args) },
}))

import { userHasBuiltBusiness, userHasRealBusiness } from "./business-access"

function project(overrides: Partial<MirrorProject> = {}): MirrorProject {
  return { id: "p1", userId: "u1", name: "P", mode: "scratch", state: "created", ...overrides } as MirrorProject
}

beforeEach(() => {
  listProjects.mockReset()
})

describe("userHasBuiltBusiness", () => {
  it("ignores a connected business — nothing was built in Atai", async () => {
    listProjects.mockResolvedValue([project({ startingPoint: "existing_business", state: "created" })])
    expect(await userHasBuiltBusiness("u1")).toBe(false)
  })

  it("is true once a project is built or live", async () => {
    listProjects.mockResolvedValue([project({ state: "deployed" })])
    expect(await userHasBuiltBusiness("u1")).toBe(true)
  })
})

describe("userHasRealBusiness", () => {
  it("counts a connected business as a real business", async () => {
    listProjects.mockResolvedValue([project({ startingPoint: "existing_business", state: "created" })])
    expect(await userHasRealBusiness("u1")).toBe(true)
  })

  it("counts a built business", async () => {
    listProjects.mockResolvedValue([project({ state: "build_complete" })])
    expect(await userHasRealBusiness("u1")).toBe(true)
  })

  it("is false with no projects at all", async () => {
    listProjects.mockResolvedValue([])
    expect(await userHasRealBusiness("u1")).toBe(false)
  })
})
