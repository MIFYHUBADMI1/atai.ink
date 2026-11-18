import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { TOUR_ROUTES, TOUR_ROUTE_IDS, matchTourRoute, resolveTourRoute } from "./routes"
import { PAGE_TOUR_ROUTE_IDS, routeMayHavePageTour } from "./entry-points"
import { PAGE_TOURS } from "./tours/pages"

/**
 * A tour navigation is a promise about the product's URLs. These checks read
 * the real `app/` tree so a step can never be pointed at a page that was
 * renamed or removed, and confirm the URL is built the way Next resolves it.
 */

const APP = path.resolve(__dirname, "..", "..", "app")

function pageExistsForPath(routePath: string): boolean {
  const withoutQuery = routePath.split("?")[0]
  const segments = withoutQuery
    .replace(/^\//, "")
    .split("/")
    .map((segment) => (segment === "{project}" ? "[projectId]" : segment))
  return existsSync(path.join(APP, ...segments, "page.tsx"))
}

describe("tour routes are real pages", () => {
  it("has a page.tsx behind every registered path", () => {
    const missing = TOUR_ROUTE_IDS.filter((id) => !pageExistsForPath(TOUR_ROUTES[id].path))
    expect(missing, `No page for: ${missing.join(", ")}`).toEqual([])
  })

  it("declares a project scope exactly when the path carries a business id", () => {
    for (const id of TOUR_ROUTE_IDS) {
      const entry = TOUR_ROUTES[id]
      expect(entry.scope === "project", `${id} is project-scoped`).toBe(entry.path.includes("{project}"))
    }
  })
})

describe("tour route resolution", () => {
  it("encodes the business id so it cannot open a second path segment", () => {
    expect(resolveTourRoute("project", "../../admin")).toBe("/project/..%2F..%2Fadmin")
    expect(resolveTourRoute("projectCollaborate", "p 1")).toBe("/project/p%201/collaborate")
  })

  it("needs a business before it will build a project URL", () => {
    expect(() => resolveTourRoute("project", undefined)).toThrow(/needs a business id/)
  })

  it("matches the most specific page, not its parent", () => {
    expect(matchTourRoute("/project/p1/plan", "p1")).toBe("projectPlan")
    expect(matchTourRoute("/project/p1", "p1")).toBe("project")
    expect(matchTourRoute("/project/p1/market/seo", "p1")).toBe("projectMarketSeo")
  })

  it("ignores a business id that does not own the page being viewed", () => {
    // A stale id in the store must not resolve another business's screens.
    expect(matchTourRoute("/project/p2/plan", "p1")).toBeNull()
  })
})

describe("per-page tour entry points", () => {
  it("lists exactly the routes that own a page tour", () => {
    expect([...PAGE_TOUR_ROUTE_IDS].sort()).toEqual([...new Set(PAGE_TOURS.map((tour) => tour.startRoute))].sort())
  })

  it("arms the launcher on those pages and nowhere else", () => {
    expect(routeMayHavePageTour("/dashboard")).toBe(true)
    expect(routeMayHavePageTour("/project/p1/finances")).toBe(true)
    expect(routeMayHavePageTour("/project/p1/finances?x=1")).toBe(true)
    expect(routeMayHavePageTour("/tours")).toBe(false)
    expect(routeMayHavePageTour("/project/p1/env")).toBe(false)
    expect(routeMayHavePageTour("/dashboard/extra")).toBe(false)
  })
})

/** Keeps the scan honest: the app tree really is where these tests look. */
describe("app tree sanity", () => {
  it("finds page files under app/", () => {
    const roots = readdirSync(APP).filter((entry) => statSync(path.join(APP, entry)).isDirectory())
    expect(roots).toContain("project")
    expect(roots.length).toBeGreaterThan(5)
  })
})
