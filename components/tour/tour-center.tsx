"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Check, Clock, Play, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react"
import { requestTour } from "./tour-root"
import { useTourStore } from "@/lib/tour/engine/store"
import { MAIN_TOURS, PAGE_TOURS, isTourAvailable, visibleStepCount, type TourContext } from "@/lib/tour/registry"
import {
  DEFAULT_TOUR_FILTERS,
  TOUR_SORT_LABEL,
  TOUR_STATUS_LABEL,
  categoriesIn,
  filterTours,
  filtersAreActive,
  groupTourRows,
  type TourRow,
  type TourSort,
  type TourStatusFilter,
} from "@/lib/tour/filters"
import type { TourCategory, TourProgress } from "@/lib/tour/types"

/**
 * The Tour Center: every walkthrough Atai offers, grouped by what the founder
 * is trying to do, with what they have already started — plus a search box and
 * filters, because a founder looking for "the one about deploying" should not
 * have to read twenty-six cards to find it. It launches the real engine: it does
 * not preview it, and it never claims a tour did something to an account.
 */

interface Props {
  context: TourContext
  progress: Record<string, TourProgress>
}

const FEATURE_LABEL: Record<string, string> = {
  growth: "Growth overview",
  marketStudio: "Marketing studio",
  studio: "Content studio",
  seoAudit: "SEO checks",
  growthTasks: "Growth tasks",
  campaigns: "Campaign plans",
  lessons: "Business lessons",
}

const PAGE_GROUP = "One page at a time"

const CHIP_BASE =
  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const CHIP_ON = "border-primary bg-primary/10 text-foreground"
const CHIP_OFF = "border-border text-muted-foreground hover:bg-accent hover:text-foreground"

export function TourCenter({ context, progress: stored }: Props) {
  const [filters, setFilters] = useState(DEFAULT_TOUR_FILTERS)

  // The engine keeps its own copy while a tour runs, so a finished tour
  // re-labels itself without a page refresh. Newest entry wins.
  const live = useTourStore((s) => s.progress)
  const progress = useMemo(() => {
    const out: Record<string, TourProgress> = { ...stored }
    for (const [id, entry] of Object.entries(live)) {
      const existing = out[id]
      if (!existing || entry.updatedAt > existing.updatedAt) out[id] = entry
    }
    return out
  }, [stored, live])

  const allTours = useMemo(() => [...MAIN_TOURS, ...PAGE_TOURS], [])
  const { rows, hiddenMatches } = useMemo(
    () => filterTours({ tours: allTours, context, progress, filters }),
    [allTours, context, progress, filters],
  )
  const groups = useMemo(() => groupTourRows(rows), [rows])
  const categories = useMemo(() => categoriesIn(allTours), [allTours])
  const active = filtersAreActive(filters)

  const toggleCategory = (category: TourCategory) =>
    setFilters((f) => ({
      ...f,
      categories: f.categories.includes(category)
        ? f.categories.filter((c) => c !== category)
        : [...f.categories, category],
    }))

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Learn Atai</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Guided tours</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
        A tour walks you through the real product, page by page, and stops where a decision is yours. It never
        presses a button that costs credits, never publishes anything and never spends money — those you do
        yourself, with the price in front of you. Leave at any point; where you got to is kept on your account.
      </p>

      {context.projectCount === 0 ? (
        <section className="mt-8 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">You have not started a business yet</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Two tours work without one — Welcome to Atai and Create your first business. The rest appear here once
            there is a business to point at.
          </p>
          <Link
            href="/new"
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Start a business
            <ArrowRight className="size-4" />
          </Link>
        </section>
      ) : null}

      {/* Filters. Search matches what a tour teaches, not just its title. */}
      <section aria-labelledby="tour-filters-heading" className="mt-8 rounded-2xl border border-border bg-card p-4">
        <h2 id="tour-filters-heading" className="sr-only">
          Find a tour
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={filters.query}
              onChange={(event) => setFilters((f) => ({ ...f, query: event.target.value }))}
              placeholder="Search tours — try “deploy”, “credits” or “publish”"
              aria-label="Search guided tours"
              className="w-full min-w-0 rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <SlidersHorizontal className="size-4" aria-hidden />
            <span className="sr-only">Sort tours</span>
            <select
              value={filters.sort}
              onChange={(event) => setFilters((f) => ({ ...f, sort: event.target.value as TourSort }))}
              aria-label="Sort tours"
              className="rounded-xl border border-border bg-background px-2.5 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {(Object.keys(TOUR_SORT_LABEL) as TourSort[]).map((sort) => (
                <option key={sort} value={sort}>
                  {TOUR_SORT_LABEL[sort]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {(["all", "started", "not-started", "completed", "hidden"] as TourStatusFilter[]).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, status }))}
              aria-pressed={filters.status === status}
              className={`${CHIP_BASE} ${filters.status === status ? CHIP_ON : CHIP_OFF}`}
            >
              {TOUR_STATUS_LABEL[status]}
            </button>
          ))}
          <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => toggleCategory(category)}
              aria-pressed={filters.categories.includes(category)}
              className={`${CHIP_BASE} ${filters.categories.includes(category) ? CHIP_ON : CHIP_OFF}`}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {rows.length === 0
              ? "No tour matches this yet."
              : `${rows.length} ${rows.length === 1 ? "tour" : "tours"} shown`}
            {hiddenMatches > 0 && filters.status === "all" ? (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, status: "hidden" }))}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {hiddenMatches} more {hiddenMatches === 1 ? "matches" : "match"} a part of Atai that is switched off
                </button>
              </>
            ) : null}
          </p>
          {active ? (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_TOUR_FILTERS)}
              className={`${CHIP_BASE} ${CHIP_OFF}`}
            >
              <X className="mr-1 inline size-3" aria-hidden />
              Clear filters
            </button>
          ) : null}
        </div>
      </section>

      <div className="mt-8 flex flex-col gap-10" data-atai-tour="tour-center-list">
        {groups.map((group) => (
          <section key={group.group} aria-labelledby={`tour-cat-${slug(group.group)}`}>
            <h2
              id={`tour-cat-${slug(group.group)}`}
              className="font-mono text-xs uppercase tracking-widest text-muted-foreground"
            >
              {group.group}
            </h2>
            {group.group === PAGE_GROUP ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Short tours that stay on a single page — for when you are already there and just want it explained.
              </p>
            ) : null}
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {group.rows.map((row) => (
                <TourCard key={row.tour.id} row={row} context={context} />
              ))}
            </ul>
          </section>
        ))}

        {rows.length === 0 ? (
          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <h2 className="text-sm font-semibold">Nothing here matches “{filters.query || "these filters"}”</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Tours are grouped by what you are trying to do. Try a plainer word — the name of the page, or the thing
              you want to happen — or clear the filters and browse the list.
            </p>
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_TOUR_FILTERS)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear filters
            </button>
          </section>
        ) : null}

        {filters.status === "hidden" && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every tour is available on your account right now.</p>
        ) : null}

        {!active ? (
          <HiddenNote context={context} />
        ) : null}
      </div>
    </main>
  )
}

function HiddenNote({ context }: { context: TourContext }) {
  const gated = useMemo(
    () => [...MAIN_TOURS, ...PAGE_TOURS].filter((t) => !isTourAvailable(t, context)),
    [context],
  )
  if (gated.length === 0) return null
  return (
    <section className="rounded-2xl border border-border bg-card/60 p-5">
      <h2 className="text-sm font-semibold">
        {gated.length} {gated.length === 1 ? "tour is" : "tours are"} hidden on your account
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        They cover parts of Atai that are switched off, or that need a business first: {gated.map((t) => t.title).join(", ")}.
        Nothing is offered here that you could not actually reach.
      </p>
      <Link
        href="/settings/features"
        className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Feature switches
        <ArrowRight className="size-3.5" />
      </Link>
    </section>
  )
}

function TourCard({ row, context }: { row: TourRow; context: TourContext }) {
  const tour = row.tour
  const progress = row.progress
  // Count what this founder would actually be shown, so "9 stops" is true for
  // them rather than a number from someone else's account.
  const stops = visibleStepCount(tour, context)
  const inProgress = progress?.status === "in-progress"
  const done = progress?.status === "completed"
  const resumeAt = inProgress ? Math.min(progress?.step ?? 0, Math.max(0, stops - 1)) : 0

  return (
    <li className={`flex h-full flex-col rounded-2xl border border-border bg-card p-4 ${row.available ? "" : "opacity-70"}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold leading-6 text-foreground">{tour.title}</h3>
        {done ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
            <Check className="size-3" aria-hidden />
            Done
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 flex-1 text-sm leading-6 text-muted-foreground">{tour.blurb}</p>

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" aria-hidden />~{tour.minutes} min
        </span>
        <span>{stops} stops</span>
        {tour.requiresProject ? <span>needs a business</span> : null}
        {tour.requiresFeature ? <span>{FEATURE_LABEL[tour.requiresFeature] ?? "feature"}</span> : null}
      </p>

      {inProgress ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Stopped at stop {resumeAt + 1} of {stops}.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {row.available ? (
          <>
            <button
              type="button"
              onClick={() => void requestTour(tour.id, inProgress ? { atStep: resumeAt } : undefined)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Play className="size-4" aria-hidden />
              {done ? "Run it again" : inProgress ? "Resume" : "Start tour"}
            </button>
            {inProgress ? (
              <button
                type="button"
                onClick={() => void requestTour(tour.id, { atStep: 0 })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCcw className="size-4" aria-hidden />
                Start over
              </button>
            ) : null}
            {tour.requiresProject ? (
              <span className="text-xs text-muted-foreground">Opens on your most recent business.</span>
            ) : null}
          </>
        ) : (
          <span className="text-xs leading-5 text-muted-foreground">
            Not on your account yet —{" "}
            <Link href="/settings/features" className="underline underline-offset-4 hover:text-foreground">
              feature switches
            </Link>
            .
          </span>
        )}
      </div>
    </li>
  )
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}
