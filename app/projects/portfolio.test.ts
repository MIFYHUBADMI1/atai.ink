import { describe, expect, it } from "vitest"

import {
  countTabs,
  filterPortfolio,
  isConnectedBusinessItem,
  itemHref,
  itemLabel,
  itemMode,
  matchesTab,
  type ConnectedBusinessItem,
  type EnrichedProject,
  type PortfolioItem,
} from "./portfolio"

function project(overrides: Partial<EnrichedProject> = {}): EnrichedProject {
  return {
    id: "proj_1",
    name: "Bakery site",
    mode: "website",
    state: "building",
    sourceUrl: "https://bakery.example",
    updatedAt: 1_000,
    visibility: "private",
    ...overrides,
  }
}

function business(overrides: Partial<ConnectedBusinessItem> = {}): ConnectedBusinessItem {
  return {
    kind: "business",
    id: "biz_1",
    name: "Northwind",
    status: "active",
    updatedAt: 2_000,
    ...overrides,
  }
}

describe("portfolio items", () => {
  it("sends a connected business to its own workspace", () => {
    expect(itemHref(business())).toBe("/business/biz_1")
  })

  it("keeps a project on its project route, and a ready plan on the review route", () => {
    expect(itemHref(project())).toBe("/project/proj_1")
    expect(itemHref(project({ state: "plan_ready" }))).toBe("/project/proj_1/collaborate")
  })

  it("labels and icons a connected business as one, without inventing a build mode", () => {
    expect(itemLabel(business())).toBe("Connected business")
    expect(itemMode(business())).toBe("connected")
    expect(itemLabel(project())).toBe("Reference build")
  })

  it("distinguishes the two kinds", () => {
    expect(isConnectedBusinessItem(business())).toBe(true)
    expect(isConnectedBusinessItem(project())).toBe(false)
  })
})

describe("portfolio tabs", () => {
  it("files a draft business under in progress and an active one under live", () => {
    expect(matchesTab(business({ status: "draft" }), "in-progress")).toBe(true)
    expect(matchesTab(business({ status: "active" }), "live")).toBe(true)
    expect(matchesTab(business({ status: "active" }), "in-progress")).toBe(false)
  })

  it("files a suspended business under needs attention", () => {
    expect(matchesTab(business({ status: "suspended" }), "needs-attention")).toBe(true)
  })

  it("makes the archived tab mean something for connected businesses", () => {
    expect(matchesTab(business({ status: "archived" }), "archived")).toBe(true)
    expect(matchesTab(project({ state: "ready" }), "archived")).toBe(false)
  })

  it("counts both kinds in the totals", () => {
    const counts = countTabs([project(), business({ status: "draft" }), business({ id: "biz_2" })])
    expect(counts).toEqual({ all: 3, "in-progress": 2, live: 1, "needs-attention": 0, archived: 0 })
  })
})

describe("portfolio filtering", () => {
  const items: PortfolioItem[] = [project(), business()]

  it("searches connected businesses by name", () => {
    expect(filterPortfolio(items, { tab: "all", search: "north", sort: "updatedAt" })).toHaveLength(1)
  })

  it("searches projects by their source address too", () => {
    expect(filterPortfolio(items, { tab: "all", search: "bakery.example", sort: "updatedAt" })).toHaveLength(1)
  })

  it("sorts both kinds together by what changed last", () => {
    expect(filterPortfolio(items, { tab: "all", search: "", sort: "updatedAt" })[0].id).toBe("biz_1")
  })

  it("falls back to recency for money sorts a connected business cannot answer", () => {
    const ordered = filterPortfolio(items, { tab: "all", search: "", sort: "revenue" })
    expect(ordered).toHaveLength(2)
    expect(ordered[0].id).toBe("biz_1")
  })
})
