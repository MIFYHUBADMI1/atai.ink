import { describe, expect, it } from "vitest"
import {
  DEFAULT_TOUR_FILTERS,
  categoriesIn,
  filterTours,
  filtersAreActive,
  groupTourRows,
  tourSearchHaystack,
  type TourFilters,
} from "./filters"
import { MAIN_TOURS, PAGE_TOURS, TOUR_CATEGORY_ORDER } from "./registry"
import type { TourContext, } from "./registry"
import type { TourDefinition, TourProgress } from "./types"

const ALL = [...MAIN_TOURS, ...PAGE_TOURS]

// Only one feature gates whole tours today (marketStudio); the others only
// remove steps. A founder with it switched off must still be able to find those
// tours, just not take them.
const CONTEXT: TourContext = {
  projectCount: 1,
  features: {
    growth: true,
    marketStudio: false,
    studio: true,
    seoAudit: true,
    growthTasks: true,
    campaigns: true,
    lessons: true,
  },
}

function run(overrides: Partial<TourFilters> = {}, extra: Partial<Record<string, TourProgress>> = {}) {
  return filterTours({
    tours: ALL,
    context: CONTEXT,
    progress: extra,
    filters: { ...DEFAULT_TOUR_FILTERS, ...overrides },
  })
}

describe("tour catalogue search", () => {
  it("matches what a tour teaches, not only its title", () => {
    // "deploy" appears in step prose, not in the word "Hosting".
    const hit = tourSearchHaystack(ALL.find((t) => t.id === "hosting")!)
    expect(hit).toContain("deploy")
    const found = run({ query: "deploy" }).rows.map((row) => row.tour.id)
    expect(found).toContain("hosting")
    expect(found.length).toBeGreaterThan(0)
  })

  it("needs every word, in any order", () => {
    const a = run({ query: "credits finances" }).rows.map((r) => r.tour.id)
    const b = run({ query: "finances credits" }).rows.map((r) => r.tour.id)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })

  it("returns nothing for a query no tour covers", () => {
    expect(run({ query: "underwater basket weaving" }).rows).toEqual([])
  })

  it("separates tours the founder cannot reach instead of listing them as takeable", () => {
    const all = run()
    expect(all.rows.every((row) => row.available)).toBe(true)
    const hidden = run({ status: "hidden" })
    expect(hidden.rows.every((row) => !row.available)).toBe(true)
    expect(all.hiddenMatches).toBe(hidden.rows.length)
    expect(all.hiddenMatches).toBeGreaterThan(0)
  })

  it("keeps a switched-off tour unofferable but findable", () => {
    const gated = ALL.find((t) => t.requiresFeature && !CONTEXT.features[t.requiresFeature])!
    expect(gated).toBeTruthy()
    // It is not in the list you can take...
    expect(run().rows.some((row) => row.tour.id === gated.id)).toBe(false)
    // ...but searching for it still turns it up, marked out of reach.
    const word = tourSearchHaystack(gated).split(" ").find((w) => w.length > 8)
    expect(word).toBeTruthy()
    const off = run({ status: "hidden", query: word! }).rows.find((row) => row.tour.id === gated.id)
    expect(off?.available).toBe(false)
  })

  it("hides business-scoped tours for a founder with no business", () => {
    const noBusiness: TourContext = { ...CONTEXT, projectCount: 0 }
    const out = filterTours({ tours: ALL, context: noBusiness, progress: {}, filters: DEFAULT_TOUR_FILTERS })
    expect(out.rows.some((row) => row.tour.requiresProject)).toBe(false)
    expect(out.hiddenMatches).toBeGreaterThan(0)
  })

  it("filters by where the founder got to", () => {
    const progress: Record<string, TourProgress> = {
      welcome: { step: 3, status: "in-progress", updatedAt: 5 },
      finances: { step: 9, status: "completed", updatedAt: 7 },
    }
    expect(run({ status: "started" }, progress).rows.map((r) => r.tour.id)).toContain("welcome")
    expect(run({ status: "completed" }, progress).rows.map((r) => r.tour.id)).toContain("finances")
    expect(run({ status: "not-started" }, progress).rows.map((r) => r.tour.id)).not.toContain("welcome")
    expect(run({ status: "not-started" }, progress).rows.map((r) => r.tour.id)).not.toContain("finances")
  })

  it("sorts by length in both directions and by name", () => {
    const shortest = run({ sort: "shortest" }).rows.map((r) => r.tour.minutes)
    const longest = run({ sort: "longest" }).rows.map((r) => r.tour.minutes)
    expect([...shortest].sort((a, b) => a - b)).toEqual(shortest)
    expect([...longest].sort((a, b) => b - a)).toEqual(longest)

    const az = run({ sort: "a-z" }).rows.map((r) => r.tour.title)
    expect([...az].sort((a, b) => a.localeCompare(b))).toEqual(az)
  })

  it("keeps recommended order inside the product's own category order", () => {
    const groups = groupTourRows(run().rows)
    const mainGroups = groups.map((g) => g.group).filter((g) => g !== "One page at a time")
    expect(mainGroups).toEqual(TOUR_CATEGORY_ORDER.filter((c) => mainGroups.includes(c)))
  })

  it("puts single-page tours in their own group, last", () => {
    const groups = groupTourRows(run().rows)
    expect(groups.at(-1)!.group).toBe("One page at a time")
    // Page tours must not be filed under "Advanced features" just because the
    // definition carries that category.
    expect(groups.find((g) => g.group === "Advanced features")!.rows.every((r) => !r.tour.id.startsWith("page-"))).toBe(true)
  })

  it("offers as chips only the categories that actually have tours", () => {
    const chips = categoriesIn(ALL)
    expect(chips.length).toBeGreaterThan(1)
    expect(chips.every((c) => TOUR_CATEGORY_ORDER.includes(c))).toBe(true)
    expect(TOUR_CATEGORY_ORDER.filter((c) => !chips.includes(c))).toEqual([])
  })

  it("filters by category chips", () => {
    const out = run({ categories: ["Getting started"] })
    expect(out.rows.length).toBeGreaterThan(0)
    expect(out.rows.every((r) => r.tour.category === "Getting started")).toBe(true)
  })

  it("knows when the founder has changed anything", () => {
    expect(filtersAreActive(DEFAULT_TOUR_FILTERS)).toBe(false)
    expect(filtersAreActive({ ...DEFAULT_TOUR_FILTERS, query: "x" })).toBe(true)
    expect(filtersAreActive({ ...DEFAULT_TOUR_FILTERS, sort: "shortest" })).toBe(true)
    expect(filtersAreActive({ ...DEFAULT_TOUR_FILTERS, categories: ["Getting started"] })).toBe(true)
  })

  it("never invents a tour: every row is one that exists", () => {
    const ids = new Set(ALL.map((t) => t.id))
    for (const row of run().rows) expect(ids.has(row.tour.id)).toBe(true)
  })
})

// A tour the founder takes is teaching something real or it is not shipping.
describe("shipped catalogue stays searchable", () => {
  it("every tour has a blurb a search can match", () => {
    const offenders = ALL.filter((t: TourDefinition) => t.blurb.trim().length < 12).map((t) => t.id)
    expect(offenders).toEqual([])
  })
})
