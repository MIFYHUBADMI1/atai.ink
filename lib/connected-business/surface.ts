import type { MirrorProject } from "@/lib/types/project"

/**
 * The one rule that keeps the two workspaces apart.
 *
 * A connected business is a business, not an app Atai built. Its screens live
 * under `/business/<id>` and must never link into `/project/<id>`; a build
 * project lives under `/project/<id>` and must never render an operate surface.
 * Both surfaces share the same engines, and the *only* thing that differs is
 * the base a link is built from — which is why this module is pure and tested.
 *
 * @module lib/connected-business/surface
 */

export type WorkspaceMode = "build" | "operate"

/** Every screen the business workspace owns. `collaborate` is not one of
 *  them: an operate business plans with the co-founder at `/plan`, and
 *  `href("collaborate")` resolves there instead of throwing. */
export type BusinessPage =
  | "overview"
  | "applications"
  | "growth"
  | "growth/studio"
  | "growth/seo"
  | "plan"
  | "money"
  | "settings"

export interface WorkspaceBase {
  mode: WorkspaceMode
  /** `/project/<id>` or `/business/<id>`. Never anything else. */
  base: string
  href(page: BusinessPage | "collaborate"): string
  /**
   * Resolve a free-form AI navigation target (e.g. `"market"`). Build-only
   * targets are refused on the operate surface rather than linked, because a
   * recommendation must never point at a screen the founder cannot open.
   */
  segment(target: string): string
}

/**
 * Segments that exist only inside the build workspace. `plan` is not here:
 * both surfaces have a plan, they are simply different plans.
 */
const BUILD_ONLY_SEGMENTS = new Set([
  "source",
  "database",
  "env",
  "environment",
  "hosting",
  "edit",
  "deploy",
  "runtime",
  "intelligence",
  "collaborate",
  "spec",
  "build",
  "logs",
  "conversation",
  "preview",
])

const BUILD_PAGES: Record<BusinessPage, string> = {
  overview: "",
  applications: "",
  growth: "market",
  "growth/studio": "studio",
  "growth/seo": "market/seo",
  plan: "plan",
  money: "finances",
  settings: "",
}

const BUSINESS_PAGES: Record<BusinessPage, string> = {
  overview: "",
  applications: "applications",
  growth: "growth",
  "growth/studio": "growth/studio",
  "growth/seo": "growth/seo",
  plan: "plan",
  money: "money",
  settings: "settings",
}

/**
 * Which workspace a project belongs to. A project that carries a business id is
 * an operate anchor even before `startingPoint` is stamped, so the two signals
 * agree in both directions.
 */
export function workspaceModeOf(
  project: Pick<MirrorProject, "startingPoint" | "businessId">,
): WorkspaceMode {
  if (project.businessId) return "operate"
  if (project.startingPoint === "existing_business") return "operate"
  return "build"
}

export function projectBase(projectId: string): WorkspaceBase {
  const root = `/project/${projectId}`
  return {
    mode: "build",
    base: root,
    href(page) {
      if (page === "collaborate") return `${root}/collaborate`
      const segment = BUILD_PAGES[page]
      return segment ? `${root}/${segment}` : root
    },
    segment(target) {
      const trimmed = target.replace(/^\/+/, "")
      return trimmed ? `${root}/${trimmed}` : root
    },
  }
}

export function businessBase(businessId: string): WorkspaceBase {
  const root = `/business/${businessId}`
  return {
    mode: "operate",
    base: root,
    href(page) {
      // There is no separate collaboration page on this surface: the growth
      // planner IS the conversation, so "collaborate" resolves to /plan.
      if (page === "collaborate") return `${root}/plan`
      const segment = BUSINESS_PAGES[page]
      return segment ? `${root}/${segment}` : root
    },
    segment(target) {
      const trimmed = target.replace(/^\/+/, "")
      const first = trimmed.split("/")[0] ?? ""
      if (!trimmed || BUILD_ONLY_SEGMENTS.has(first)) return `${root}/growth`
      return `${root}/${trimmed}`
    },
  }
}

/** True for any sub-route of a project — i.e. the build workspace. */
export function isBuildWorkspacePath(path: string): boolean {
  return /^\/project\/[^/]+\/[^/?#]+/.test(path)
}

/** True when an operate surface would be leaking a build target. */
export function leaksBuildSurface(path: string): boolean {
  return path.startsWith("/project/") || isBuildWorkspacePath(path)
}
