import type { TourTargetId } from "./targets"
import type { TourRouteId } from "./routes"

/**
 * Step kinds describe what the engine expects the *user* to do. The engine
 * never performs any of them — it highlights, explains, and then verifies the
 * real result. That is the difference between a tour that teaches and a tour
 * that pretends.
 */
export type TourStepKind = "info" | "navigate" | "click" | "input" | "action" | "completion"

/**
 * How a step knows it is done.
 * - `route`: the location actually changed to the expected page.
 * - `element`: a real registered element appeared/exists in the DOM.
 * - `manual`: the user confirmed it. Used wherever the platform cannot observe
 *   the outcome (an external ad channel, a payment made on another site). The
 *   copy must make clear Atai did not do the thing for them.
 */
export type TourVerify =
  | { type: "route"; route: TourRouteId }
  | { type: "element"; target: TourTargetId }
  | { type: "manual" }

/** Founder-owned switches that can hide a whole feature, and therefore a step. */
export type TourFeatureKey =
  | "growth"
  | "marketStudio"
  | "studio"
  | "seoAudit"
  | "growthTasks"
  | "campaigns"
  | "lessons"

export interface TourFeatureFlags {
  growth: boolean
  marketStudio: boolean
  studio: boolean
  seoAudit: boolean
  growthTasks: boolean
  campaigns: boolean
  lessons: boolean
}

export interface TourStep {
  id: string
  kind: TourStepKind
  /** Headline in the tooltip. */
  title: string
  /** What it is and what it does — two sentences at most. */
  text: string
  /** Why it matters to the founder's business, not to the UI. */
  why?: string
  /** The concrete next move for the user. Required for interactive steps. */
  instruction?: string
  /** Element to spotlight. Must be registered in lib/tour/targets.ts. */
  target?: TourTargetId
  /** Page to be on before the step can show. Engine navigates if needed. */
  route?: TourRouteId
  /** Proof the step is complete. Defaults to manual for interactive kinds. */
  verify?: TourVerify
  /** Step cannot be shown without a business; engine skips with a note. */
  requiresProject?: boolean
  /** Step is hidden unless the founder has this feature switched on. */
  requiresFeature?: TourFeatureKey
  /** Charges credits when the user follows the instruction. */
  costsCredits?: boolean
  /** How long the engine waits for the page/element before giving up. */
  waitMs?: number
}

export type TourCategory =
  | "Getting started"
  | "Building a business"
  | "Managing a business"
  | "Growing a business"
  | "Understanding finances"
  | "Advanced features"

export interface TourDefinition {
  id: string
  title: string
  /** One line in the Tour Center. */
  blurb: string
  category: TourCategory
  /** Honest estimate shown to the founder; keep it realistic, not flattering. */
  minutes: number
  /** Page the tour opens on. */
  startRoute: TourRouteId
  /** Needs at least one business to make any sense. */
  requiresProject?: boolean
  /** Hidden from the Tour Center entirely unless this switch is on. */
  requiresFeature?: TourFeatureKey
  /** Offered on the finishing card as "take this next". */
  offerNext?: string
  steps: TourStep[]
}

export type TourProgressStatus = "in-progress" | "completed" | "dismissed"

export interface TourProgress {
  step: number
  status: TourProgressStatus
  updatedAt: number
  paused?: boolean
  /** Ids of steps the founder skipped on the way through. */
  skipped?: string[]
}

export interface TourLaunchOptions {
  /** Resume at a specific index instead of the stored one. */
  atStep?: number
  /** Business to use for project-scoped steps. */
  projectId?: string
}
