import { beforeEach, describe, expect, it, vi } from "vitest"

const { state } = vi.hoisted(() => ({ state: { hostname: null as string | null } }))

vi.mock("./anchor", () => ({
  verifiedHostnameForBusiness: async () => state.hostname,
}))

import type { MirrorProject } from "@/lib/types/project"
import { auditableSiteUrl } from "./site-url"

function project(overrides: Partial<MirrorProject> = {}): MirrorProject {
  return { id: "p1", name: "Acme", ...overrides } as MirrorProject
}

beforeEach(() => {
  state.hostname = null
})

describe("auditableSiteUrl", () => {
  it("uses a successful deployment's URL for a build project", async () => {
    const site = await auditableSiteUrl(
      project({ deployment: { status: "success", productionUrl: "https://acme.atai.app" } as MirrorProject["deployment"] }),
    )

    expect(site).toEqual({ url: "https://acme.atai.app", source: "deployment" })
  })

  it("refuses an undeployed build project", async () => {
    const site = await auditableSiteUrl(project({ deployment: { status: "idle" } as MirrorProject["deployment"] }))

    expect(site).toBeNull()
  })

  it("refuses a failed deployment even when a URL is recorded", async () => {
    const site = await auditableSiteUrl(
      project({ deployment: { status: "failed", productionUrl: "https://acme.atai.app" } as MirrorProject["deployment"] }),
    )

    expect(site).toBeNull()
  })

  it("uses the proved hostname for a connected business", async () => {
    state.hostname = "acme.com"

    const site = await auditableSiteUrl(project({ businessId: "biz_1" }))

    expect(site).toEqual({ url: "https://acme.com", source: "business-domain" })
  })

  it("refuses a connected business with no proved address", async () => {
    const site = await auditableSiteUrl(project({ businessId: "biz_1" }))

    expect(site).toBeNull()
  })

  it("prefers the deployment URL when both exist", async () => {
    state.hostname = "acme.com"

    const site = await auditableSiteUrl(
      project({
        businessId: "biz_1",
        deployment: { status: "success", productionUrl: "https://app.acme.com" } as MirrorProject["deployment"],
      }),
    )

    expect(site).toEqual({ url: "https://app.acme.com", source: "deployment" })
  })
})
