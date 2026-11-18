"use client"

import Link from "next/link"
import useSWR from "swr"
import { Compass } from "lucide-react"
import { requestTour } from "./tour-root"
import { fetchTourStatus } from "@/lib/tour/engine/persist"
import { useTourStore } from "@/lib/tour/engine/store"
import { isTourAvailable, toursForRoute, visibleStepCount } from "@/lib/tour/registry"
import { matchTourRoute } from "@/lib/tour/routes"

/**
 * Loads only on routes that own a tour (see page-tour-launcher.tsx). Offers
 * that page's tour plus any full tour that starts here — nothing is listed
 * that this founder cannot reach, which is why the availability context is
 * read from the server rather than guessed at.
 */
export function Inner({ pathname }: { pathname: string }) {
  const status = useTourStore((s) => s.status)
  const { data } = useSWR("api/settings/tours", () => fetchTourStatus(), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupeInterval: 60_000,
  })

  // While a tour is running the tooltip is the guidance; do not stack a second.
  if (status !== "idle" || !data) return null

  const projectId = pathname.match(/^\/project\/([^/?#]+)/)?.[1]
  const routeId = matchTourRoute(pathname, projectId)
  if (!routeId) return null
  const tours = toursForRoute(routeId).filter((tour) => isTourAvailable(tour, data.context))
  if (tours.length === 0) return null

  return (
    <nav
      aria-label="Guidance for this page"
      className="border-b border-border bg-card/50 px-4 py-2.5 sm:px-6 lg:px-8"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2">
        <p className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <Compass className="size-3.5" aria-hidden />
          On this page
        </p>
        <ul className="flex flex-wrap items-center gap-2">
          {tours.map((tour) => {
            const progress = data.progress[tour.id]
            const resume = progress?.status === "in-progress" ? progress.step : undefined
            return (
              <li key={tour.id}>
                <button
                  type="button"
                  onClick={() => void requestTour(tour.id, { atStep: resume })}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium">{tour.title}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    ~{tour.minutes} min · {visibleStepCount(tour, data.context)} stops
                    {resume !== undefined ? ` · resume at ${resume + 1}` : ""}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <Link
          href="/tours"
          className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          All guided tours
        </Link>
      </div>
    </nav>
  )
}
