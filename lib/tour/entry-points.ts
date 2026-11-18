import { TOUR_ROUTES, type TourRouteId } from "./routes"

/**
 * Which pages own a tour of their own.
 *
 * This exists so the rest of the product can ask "should I even load the tour
 * code for this URL?" without importing the tour definitions. The pathnames are
 * derived from `TOUR_ROUTES`, so an entry can never point at a page that does
 * not exist, and `lib/tour/entry-points.test.ts` fails if this list and
 * `PAGE_TOURS` ever disagree.
 */
export const PAGE_TOUR_ROUTE_IDS = [
  "dashboard",
  "projects",
  "newBusiness",
  "explore",
  "docs",
  "settingsFeatures",
  "settingsBilling",
  "projectCollaborate",
  "projectPlan",
  "projectMarket",
  "projectAds",
  "projectHosting",
  "projectFinances",
  "projectIntelligence",
  "projectRuntime",
  "projectCompetition",
] as const satisfies readonly TourRouteId[]

const PATHS: RegExp[] = PAGE_TOUR_ROUTE_IDS.map((id) => {
  const entry = TOUR_ROUTES[id]
  const base = entry.path.split("?")[0]
  const body = entry.scope === "project" ? base.replace("{project}", "[^/]+") : base
  return new RegExp(`^${body}/?$`)
})

export function routeMayHavePageTour(pathname: string): boolean {
  const clean = pathname.split("?")[0]
  return PATHS.some((pattern) => pattern.test(clean))
}
