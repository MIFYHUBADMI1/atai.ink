/**
 * Every destination a guided tour may navigate to, as literal path templates.
 *
 * Tour steps reference these ids instead of free-text URLs, so a tour can
 * never send the browser somewhere that does not exist (and can never be
 * handed a `javascript:` URL by content authored elsewhere). Adding a route
 * here is also checked against the real `app/` tree by
 * `lib/tour/routes.test.ts`.
 */

export type TourRouteScope = "workspace" | "project"

interface TourRouteEntry {
  label: string
  scope: TourRouteScope
  /** Absolute path template; project routes contain `{project}`. */
  path: string
}

export const TOUR_ROUTES = {
  // Workspace and account
  dashboard: { label: "Dashboard", scope: "workspace", path: "/dashboard" },
  projects: { label: "Your businesses", scope: "workspace", path: "/projects" },
  portfolioFinances: { label: "Portfolio finances", scope: "workspace", path: "/finances" },
  adsIndex: { label: "Ads & growth overview", scope: "workspace", path: "/ads" },
  notifications: { label: "Notifications", scope: "workspace", path: "/notifications" },
  explore: { label: "Explore", scope: "workspace", path: "/explore" },
  newBusiness: { label: "Start a business", scope: "workspace", path: "/new" },
  newIdea: { label: "Start from an idea", scope: "workspace", path: "/new/idea" },
  newWebsite: { label: "Start from a website", scope: "workspace", path: "/new/website" },
  newGithub: { label: "Start from a GitHub repository", scope: "workspace", path: "/new/github" },
  newExistingBusiness: { label: "Bring your existing business", scope: "workspace", path: "/new/existing" },
  lessons: { label: "Business lessons", scope: "workspace", path: "/lessons" },
  resources: { label: "Resources", scope: "workspace", path: "/resources" },
  docs: { label: "Help & guides", scope: "workspace", path: "/docs" },
  tourCenter: { label: "Guided tours", scope: "workspace", path: "/tours" },
  settings: { label: "Settings", scope: "workspace", path: "/settings" },
  settingsProfile: { label: "Profile", scope: "workspace", path: "/settings/profile" },
  settingsSecurity: { label: "Security", scope: "workspace", path: "/settings/security" },
  settingsBilling: { label: "Billing", scope: "workspace", path: "/settings/billing" },
  settingsFeatures: { label: "Feature switches", scope: "workspace", path: "/settings/features" },
  settingsAi: { label: "Co-founder settings", scope: "workspace", path: "/settings/ai" },

  // One business
  project: { label: "Business workspace", scope: "project", path: "/project/{project}" },
  projectBusiness: { label: "Business profile & assessment", scope: "project", path: "/project/{project}/business" },
  projectPlan: { label: "Business plan", scope: "project", path: "/project/{project}/plan" },
  projectCollaborate: { label: "Co-founder chat", scope: "project", path: "/project/{project}/collaborate" },
  projectProgress: { label: "Team progress", scope: "project", path: "/project/{project}/progress" },
  projectTasks: { label: "Business tasks", scope: "project", path: "/project/{project}/tasks" },
  projectEdit: { label: "App editor", scope: "project", path: "/project/{project}/edit" },
  projectHosting: { label: "Hosting", scope: "project", path: "/project/{project}/hosting" },
  projectSource: { label: "Application source", scope: "project", path: "/project/{project}/source" },
  projectDatabase: { label: "App database", scope: "project", path: "/project/{project}/database" },
  projectEnv: { label: "Environment secrets", scope: "project", path: "/project/{project}/env" },
  projectMarket: { label: "Market & grow", scope: "project", path: "/project/{project}/market" },
  projectMarketSeo: { label: "SEO visibility", scope: "project", path: "/project/{project}/market/seo" },
  projectStudio: { label: "Marketing studio", scope: "project", path: "/project/{project}/studio" },
  projectTasksStudioTab: { label: "Studio library", scope: "project", path: "/project/{project}/studio?tab=library" },
  projectAds: { label: "Ads & growth", scope: "project", path: "/project/{project}/ads" },
  projectAdsStrategy: { label: "Advertising strategy", scope: "project", path: "/project/{project}/ads?tab=strategy" },
  projectAdsBench: { label: "Ad drafts", scope: "project", path: "/project/{project}/ads?tab=bench" },
  projectAdsRequests: { label: "Placement requests", scope: "project", path: "/project/{project}/ads?tab=requests" },
  projectCampaigns: { label: "Campaign plans", scope: "project", path: "/project/{project}/campaigns" },
  projectCompetition: { label: "Competition", scope: "project", path: "/project/{project}/competition" },
  projectFinances: { label: "Business finances", scope: "project", path: "/project/{project}/finances" },
  projectIntelligence: { label: "Application intelligence", scope: "project", path: "/project/{project}/intelligence" },
  projectResources: { label: "Business resources", scope: "project", path: "/project/{project}/resources" },
  projectLessons: { label: "Lessons for this business", scope: "project", path: "/project/{project}/lessons" },
  projectRuntime: { label: "Runtime", scope: "project", path: "/project/{project}/runtime" },
  projectRuntimeUsage: { label: "Runtime usage", scope: "project", path: "/project/{project}/runtime/usage" },
  projectRuntimeKeys: { label: "Runtime keys", scope: "project", path: "/project/{project}/runtime/keys" },
  projectRuntimeHealth: { label: "Application health", scope: "project", path: "/project/{project}/runtime/health" },
} as const satisfies Record<string, TourRouteEntry>

export type TourRouteId = keyof typeof TOUR_ROUTES

export const TOUR_ROUTE_IDS = Object.keys(TOUR_ROUTES) as TourRouteId[]

export function isTourRouteId(value: unknown): value is TourRouteId {
  return typeof value === "string" && Object.hasOwn(TOUR_ROUTES, value)
}

export function tourRouteScope(id: TourRouteId): TourRouteScope {
  return TOUR_ROUTES[id].scope
}

export function tourRouteLabel(id: TourRouteId): string {
  return TOUR_ROUTES[id].label
}

/**
 * Build the real path. Ids are re-encoded so a project id can never smuggle a
 * second path segment or a query string into a tour navigation.
 */
export function resolveTourRoute(id: TourRouteId, projectId?: string): string {
  const entry = TOUR_ROUTES[id]
  if (entry.scope === "workspace") return entry.path
  const id2 = typeof projectId === "string" ? projectId.trim() : ""
  if (!id2) throw new Error(`Tour route "${id}" needs a business id.`)
  return entry.path.replace("{project}", encodeURIComponent(id2))
}

/** Which tour route a live pathname matches, if any. Longest prefix wins so
 * `/project/x/plan` is not mistaken for `/project/x`. */
export function matchTourRoute(pathname: string, projectId?: string): TourRouteId | null {
  const scored: Array<{ id: TourRouteId; base: string }> = []
  for (const id of TOUR_ROUTE_IDS) {
    const entry = TOUR_ROUTES[id]
    if (entry.scope === "project") {
      if (!projectId) continue
      const base = entry.path.replace("{project}", encodeURIComponent(projectId))
      scored.push({ id, base: base.split("?")[0] })
    } else {
      scored.push({ id, base: entry.path.split("?")[0] })
    }
  }
  scored.sort((a, b) => b.base.length - a.base.length)
  const clean = pathname.split("?")[0].replace(/\/$/, "") || "/"
  for (const { id, base } of scored) {
    const b = base.replace(/\/$/, "") || "/"
    if (clean === b || clean.startsWith(`${b}/`)) return id
  }
  return null
}
