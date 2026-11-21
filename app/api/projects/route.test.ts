import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MirrorProject } from "@/lib/types/project"
import { isConnectedBusiness } from "@/lib/connected-business/guards"

/**
 * Project list route.
 *
 * The list is what the client gates the workspace on, so it must carry
 * `startingPoint`: without it a connected business looks like an app built
 * from scratch and its business sections stay locked.
 */

const { requireUser, listProjects } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listProjects: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser }))
vi.mock("@/lib/store/store", () => ({ store: { listProjects } }))
vi.mock("@/lib/media/project-thumbnail", () => ({ resolveProjectThumbnail: () => undefined }))

const { GET } = await import("./route")

function project(overrides: Partial<MirrorProject> = {}): MirrorProject {
  return {
    id: "p1",
    userId: "u1",
    name: "Bakery",
    state: "created",
    mode: "scratch",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  } as MirrorProject
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: "u1" })
})

describe("GET /api/projects", () => {
  it("returns startingPoint so a connected business is recognisable client-side", async () => {
    listProjects.mockResolvedValue([
      project({ id: "connected", startingPoint: "existing_business" }),
      project({ id: "built" }),
    ])

    const res = await GET()
    const body = (await res.json()) as { data: { projects: Array<{ id: string; startingPoint?: string }> } }

    const connected = body.data.projects.find((p) => p.id === "connected")
    expect(connected?.startingPoint).toBe("existing_business")
    expect(isConnectedBusiness(connected)).toBe(true)

    const built = body.data.projects.find((p) => p.id === "built")
    expect(built?.startingPoint).toBeUndefined()
    expect(isConnectedBusiness(built)).toBe(false)
  })
})
