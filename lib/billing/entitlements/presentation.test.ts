import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  set: vi.fn(),
  storage: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("./service", () => ({ resolveEntitlements: h.set }))
vi.mock("@/lib/infrastructure/service", () => ({ getProjectStorageUsage: h.storage }))

import { buildEntitlementSet } from "./catalog"
import { buildProjectAccessView } from "./presentation"
import type { MirrorProject } from "@/lib/types/project"

const zero = { businesses: 0, productionApps: 0, subdomains: 0, customDomainsConsumed: 0 }

function project(overrides: Partial<MirrorProject> = {}): MirrorProject {
  return {
    id: "p1",
    userId: "u1",
    name: "Shop",
    idea: "A shop",
    mode: "scratch",
    state: "ready",
    createdAt: 1,
    updatedAt: 1,
    deployment: { id: "d1", status: "idle", updatedAt: 1 },
    deploymentHistory: [],
    ...overrides,
  } as MirrorProject
}

afterEach(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.clearAllMocks()
  h.set.mockResolvedValue(buildEntitlementSet("starter", zero))
  h.storage.mockResolvedValue({ usedBytes: 10, limitBytes: 100, withinLimit: true })
})

describe("project access view", () => {
  it("reports Starter custom domains as unavailable with the catalog reason", async () => {
    const view = await buildProjectAccessView("u1", project())
    expect(view.customDomain.allowed).toBe(false)
    expect(view.customDomain.limit).toBe(0)
    expect(view.customDomain.reason).toContain("custom domain")
  })

  it("keeps an existing custom domain manageable after a downgrade", async () => {
    const view = await buildProjectAccessView(
      "u1",
      project({
        deployment: { id: "d1", status: "success", customDomain: "shop.example.com", updatedAt: 1 },
      }),
    )
    expect(view.customDomain.allowed).toBe(true)
  })

  it("reports the live subdomain count and denies a second project", async () => {
    h.set.mockResolvedValue(buildEntitlementSet("starter", { ...zero, subdomains: 1 }))
    const view = await buildProjectAccessView("u1", project())
    expect(view.subdomain.allowed).toBe(false)
    expect(view.subdomain.current).toBe(1)
    expect(view.subdomain.limit).toBe(1)
  })

  it("keeps an already-published project republishable", async () => {
    h.set.mockResolvedValue(buildEntitlementSet("starter", { ...zero, subdomains: 1 }))
    const view = await buildProjectAccessView(
      "u1",
      project({ deployment: { id: "d1", status: "success", productionUrl: "shop.totalum-project.com", updatedAt: 1 } }),
    )
    expect(view.subdomain.allowed).toBe(true)
  })

  it("turns an over-quota storage observation into an explicit denial", async () => {
    h.storage.mockResolvedValue({ usedBytes: 101, limitBytes: 100, withinLimit: false })
    const view = await buildProjectAccessView("u1", project())
    expect(view.storage.allowed).toBe(false)
    expect(view.storage.code).toBe("STORAGE_LIMIT_REACHED")
  })

  it("fails open on plan capabilities when enforcement is OFF", async () => {
    vi.stubEnv("ENTITLEMENT_ENFORCEMENT_ENABLED", "false")
    h.set.mockResolvedValue(buildEntitlementSet("explorer", zero))

    const view = await buildProjectAccessView("u1", project())

    expect(view.customDomain.allowed).toBe(true)
    expect(view.subdomain.allowed).toBe(true)
    expect(view.database.allowed).toBe(true)
    expect(view.specialistTeam.allowed).toBe(true)
    expect(view.competition.allowed).toBe(true)
    expect(view.agent.allowed).toBe(true)
    expect(view.storage.allowed).toBe(true)
  })

  it("still reports the infrastructure quota when enforcement is OFF", async () => {
    vi.stubEnv("ENTITLEMENT_ENFORCEMENT_ENABLED", "false")
    h.storage.mockResolvedValue({ usedBytes: 101, limitBytes: 100, withinLimit: false })

    const view = await buildProjectAccessView("u1", project())

    expect(view.customDomain.allowed).toBe(true)
    expect(view.storage.allowed).toBe(false)
    expect(view.storage.code).toBe("STORAGE_LIMIT_REACHED")
  })

  it("exposes database, team, competition and unlaunched agent decisions", async () => {
    const view = await buildProjectAccessView("u1", project())
    expect(view.database.allowed).toBe(true)
    expect(view.specialistTeam.allowed).toBe(true)
    expect(view.competition.allowed).toBe(false)
    expect(view.agent.allowed).toBe(false)
  })
})
