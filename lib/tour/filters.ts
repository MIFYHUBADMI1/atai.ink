import { TOUR_CATEGORY_ORDER, isTourAvailable, type TourContext } from "./registry"
import type { TourCategory, TourDefinition, TourProgress } from "./types"

/**
 * Finding the right tour quickly is part of teaching with it: a founder who
 * wants "the one about deploying" should not scroll a wall of cards. The rules
 * live here as pure functions so they are testable without a browser, and the
 * Tour Center only renders what they return.
 */

export type TourStatusFilter = "all" | "started" | "completed" | "not-started" | "hidden"
export type TourSort = "recommended" | "shortest" | "longest" | "a-z"

export interface TourFilters {
  query: string
  status: TourStatusFilter
  categories: TourCategory[]
  sort: TourSort
}

export const DEFAULT_TOUR_FILTERS: TourFilters = { query: "", status: "all", categories: [], sort: "recommended" }

export const TOUR_STATUS_LABEL: Record<TourStatusFilter, string> = {
  all: "All",
  started: "Started",
  completed: "Finished",
  "not-started": "Not started",
  hidden: "Switched off",
}

export const TOUR_SORT_LABEL: Record<TourSort, string> = {
  recommended: "Recommended order",
  shortest: "Shortest first",
  longest: "Longest first",
  "a-z": "A–Z",
}

export interface TourRow {
  tour: TourDefinition
  /** False means the tour exists but this founder cannot reach it yet. */
  available: boolean
  progress?: TourProgress
  group: string
}

const PAGE_GROUP = "One page at a time"

export function filtersAreActive(filters: TourFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.status !== "all" ||
    filters.categories.length > 0 ||
    filters.sort !== DEFAULT_TOUR_FILTERS.sort
  )
}

/**
 * Everything a query is allowed to match. Step titles and body text are
 * included on purpose: a founder searches for the thing they want to do
 * ("deploy", "credits", "publish"), not for a tour id.
 */
export function tourSearchHaystack(tour: TourDefinition): string {
  const parts = [tour.title, tour.blurb, tour.category]
  for (const step of tour.steps) parts.push(step.title, step.text, step.instruction ?? "")
  return parts.join(" ").toLowerCase().replace(/\s+/g, " ")
}

function statusOf(row: { available: boolean; progress?: TourProgress }): TourStatusFilter {
  if (!row.available) return "hidden"
  if (row.progress?.status === "completed") return "completed"
  if (row.progress?.status === "in-progress") return "started"
  return "not-started"
}

function categoryRank(tour: TourDefinition): number {
  const index = TOUR_CATEGORY_ORDER.indexOf(tour.category)
  return index === -1 ? TOUR_CATEGORY_ORDER.length : index
}

/**
 * Filter and sort the catalogue. `all` deliberately means "what this founder can
 * actually take"; tours whose feature is switched off are counted separately so
 * the interface can say "3 more match, but they are switched off" instead of
 * looking broken.
 */
export function filterTours(input: {
  tours: TourDefinition[]
  context: TourContext
  progress: Record<string, TourProgress>
  filters: TourFilters
}): { rows: TourRow[]; hiddenMatches: number } {
  const words = input.filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean)

  const matched = input.tours.filter((tour) => {
    if (words.length === 0) return true
    const haystack = tourSearchHaystack(tour)
    return words.every((word) => haystack.includes(word))
  })

  const rows: TourRow[] = matched.map((tour) => ({
    tour,
    available: isTourAvailable(tour, input.context),
    progress: input.progress[tour.id],
    group: tour.id.startsWith("page-") ? PAGE_GROUP : tour.category,
  }))

  const status = input.filters.status
  const byStatus = status === "all" ? rows.filter((row) => row.available) : rows.filter((row) => statusOf(row) === status)
  const hiddenMatches =
    status === "all" ? rows.filter((row) => !row.available).length : 0

  const categories = input.filters.categories
  const byCategory = categories.length === 0 ? byStatus : byStatus.filter((row) => categories.includes(row.tour.category))

  const sorted = [...byCategory]
  switch (input.filters.sort) {
    case "shortest":
      sorted.sort((a, b) => a.tour.minutes - b.tour.minutes || a.tour.steps.length - b.tour.steps.length || a.tour.title.localeCompare(b.tour.title))
      break
    case "longest":
      sorted.sort((a, b) => b.tour.minutes - a.tour.minutes || b.tour.steps.length - a.tour.steps.length || a.tour.title.localeCompare(b.tour.title))
      break
    case "a-z":
      sorted.sort((a, b) => a.tour.title.localeCompare(b.tour.title))
      break
    default:
      sorted.sort((a, b) => categoryRank(a.tour) - categoryRank(b.tour))
  }

  return { rows: sorted, hiddenMatches }
}

/** Render order: categories as the product teaches them, pages last. */
export function groupTourRows(rows: TourRow[]): Array<{ group: string; rows: TourRow[] }> {
  const order: string[] = []
  const buckets = new Map<string, TourRow[]>()
  for (const row of rows) {
    if (!buckets.has(row.group)) {
      buckets.set(row.group, [])
      order.push(row.group)
    }
    buckets.get(row.group)!.push(row)
  }
  const main = order.filter((group) => group !== PAGE_GROUP)
  const ordered = [...main.sort((a, b) => TOUR_CATEGORY_ORDER.indexOf(a as TourCategory) - TOUR_CATEGORY_ORDER.indexOf(b as TourCategory))]
  if (buckets.has(PAGE_GROUP)) ordered.push(PAGE_GROUP)
  return ordered.map((group) => ({ group, rows: buckets.get(group)! }))
}

/** Which categories are worth offering as chips, given the whole catalogue. */
export function categoriesIn(tours: TourDefinition[]): TourCategory[] {
  const present = new Set(tours.map((t) => t.category))
  return TOUR_CATEGORY_ORDER.filter((category) => present.has(category))
}
