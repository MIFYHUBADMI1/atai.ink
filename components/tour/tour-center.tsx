"use client"

import { useMemo } from "react"
import Link from "next/link"
import { ArrowRight, Check, Clock, Play, RotateCcw } from "lucide-react"
import { requestTour } from "./tour-root"
import { useTourStore } from "@/lib/tour/engine/store"
import {
  MAIN_TOURS,
  PAGE_TOURS,
  availableToursByCategory,
  isTourAvailable,
  visibleStepCount,
  type TourContext,
} from "@/lib/tour/registry"
import type { TourDefinition, TourProgress } from "@/lib/tour/types"

/**
 * The Tour Center: every walkthrough Atai offers, grouped by what the founder
 * is trying to do, with what they have already started. It launches the real
 * engine — it does not preview it, and it never claims a tour did something to
 * an account.
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

export function TourCenter({ context, progress: stored }: Props) {
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

  const groups = useMemo(() => availableToursByCategory(context), [context])
  const pageTours = useMemo(() => PAGE_TOURS.filter((t) => isTourAvailable(t, context)), [context])
  const gated = useMemo(
    () => [...MAIN_TOURS, ...PAGE_TOURS].filter((t) => !isTourAvailable(t, context)),
    [context],
  )
  const started = useMemo(
    () => [...MAIN_TOURS, ...PAGE_TOURS].filter((t) => progress[t.id]?.status === "in-progress").length,
    [progress],
  )

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

      {started > 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {started} {started === 1 ? "tour is" : "tours are"} waiting for you to finish them.
        </p>
      ) : null}

      <div className="mt-8 flex flex-col gap-10" data-atai-tour="tour-center-list">
        {groups.map((group) => (
          <section key={group.category} aria-labelledby={`tour-cat-${slug(group.category)}`}>
            <h2
              id={`tour-cat-${slug(group.category)}`}
              className="font-mono text-xs uppercase tracking-widest text-muted-foreground"
            >
              {group.category}
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {group.tours.map((tour) => (
                <TourCard key={tour.id} tour={tour} context={context} progress={progress[tour.id]} />
              ))}
            </ul>
          </section>
        ))}

        {pageTours.length > 0 ? (
          <section aria-labelledby="tour-cat-page">
            <h2 id="tour-cat-page" className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              One page at a time
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Short tours that stay on a single page — for when you are already there and just want it explained.
            </p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {pageTours.map((tour) => (
                <TourCard key={tour.id} tour={tour} context={context} progress={progress[tour.id]} />
              ))}
            </ul>
          </section>
        ) : null}

        {gated.length > 0 ? (
          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <h2 className="text-sm font-semibold">
              {gated.length} {gated.length === 1 ? "tour is" : "tours are"} hidden on your account
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              They cover parts of Atai that are switched off, or that need a business first:{" "}
              {gated.map((t) => t.title).join(", ")}. Nothing is offered here that you could not actually reach.
            </p>
            <Link
              href="/settings/features"
              className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Feature switches
              <ArrowRight className="size-3.5" />
            </Link>
          </section>
        ) : null}
      </div>
    </main>
  )
}

function TourCard({
  tour,
  context,
  progress,
}: {
  tour: TourDefinition
  context: TourContext
  progress?: TourProgress
}) {
  // Count what this founder would actually be shown, so "9 stops" is true for
  // them rather than a number from someone else's account.
  const stops = visibleStepCount(tour, context)
  const inProgress = progress?.status === "in-progress"
  const done = progress?.status === "completed"
  const resumeAt = inProgress ? Math.min(progress?.step ?? 0, Math.max(0, stops - 1)) : 0

  return (
    <li className="flex h-full flex-col rounded-2xl border border-border bg-card p-4">
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
      </div>
    </li>
  )
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}
