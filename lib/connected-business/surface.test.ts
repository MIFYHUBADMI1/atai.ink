import { describe, expect, it } from "vitest"
import { businessBase, leaksBuildSurface, projectBase, workspaceModeOf } from "./surface"

const BUSINESS_PAGES = [
  "overview",
  "applications",
  "growth",
  "growth/studio",
  "growth/seo",
  "plan",
  "money",
  "settings",
] as const

describe("two surfaces, one rule", () => {
  it("routes every business page under /business/<id>", () => {
    const base = businessBase("biz_1")
    for (const page of BUSINESS_PAGES) {
      const href = base.href(page)
      expect(href.startsWith("/business/biz_1")).toBe(true)
      expect(href.startsWith("/project/")).toBe(false)
    }
  })

  it("resolves collaborate to the business plan, never a project", () => {
    expect(businessBase("biz_1").href("collaborate")).toBe("/business/biz_1/plan")
  })

  it("refuses a build-only segment on the operate surface", () => {
    const base = businessBase("biz_1")
    for (const target of ["source", "database", "deploy", "runtime", "collaborate", "hosting"]) {
      expect(base.segment(target)).toBe("/business/biz_1/growth")
    }
    expect(base.segment("market")).toBe("/business/biz_1/market")
  })

  it("keeps the build surface on project routes", () => {
    const base = projectBase("p1")
    expect(base.href("growth")).toBe("/project/p1/market")
    expect(base.href("collaborate")).toBe("/project/p1/collaborate")
    expect(base.href("money")).toBe("/project/p1/finances")
    expect(base.segment("studio")).toBe("/project/p1/studio")
  })

  it("classifies a project by its business link or starting point", () => {
    expect(workspaceModeOf({ startingPoint: "existing_business" })).toBe("operate")
    expect(workspaceModeOf({ businessId: "biz_1" })).toBe("operate")
    expect(workspaceModeOf({ startingPoint: "from_scratch" })).toBe("build")
    expect(workspaceModeOf({})).toBe("build")
  })

  it("detects a leaked build target", () => {
    expect(leaksBuildSurface("/project/p1/source")).toBe(true)
    expect(leaksBuildSurface("/business/biz_1/growth")).toBe(false)
  })
})
