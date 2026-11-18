/**
 * Registry of every interface element a guided tour may point at.
 *
 * A step may only reference an id declared here, and the ids must exist as
 * `data-atai-tour="<id>"` in real markup — `lib/tour/targets.test.ts` fails
 * the build if a target a tour actually points at disappears from the product.
 * That keeps tour copy from describing controls that no longer exist.
 *
 * `risk` is a hard constraint, not documentation: a step of kind `click`,
 * `input`, `action` or `completion` may only target `risk: "none"`. Anything
 * that spends credits, charges money, publishes, or deletes is explained as
 * information and operated by the user themselves.
 */

export type TourRisk = "none" | "credits" | "money" | "publishes" | "destructive" | "settings-write"

/** The DOM attribute a real element uses to declare itself tour-addressable. */
export const TOUR_TARGET_ATTR = "data-atai-tour"

export interface TourTarget {
  /** Short label read aloud by the engine when the spotlight moves here. */
  label: string
  /** Which shell renders it — the spotlight clamps differently per shell. */
  shell: "workspace" | "project" | "settings" | "content"
  risk: TourRisk
  /** Only present for one business, so it never resolves without a project. */
  projectScoped?: boolean
}

export const TOUR_TARGETS = {
  // ── Workspace shell ───────────────────────────────────────────────────────
  "nav-dashboard": { label: "Dashboard", shell: "workspace", risk: "none" },
  "nav-businesses": { label: "Your businesses", shell: "workspace", risk: "none" },
  "projects-new": { label: "New business", shell: "workspace", risk: "none" },
  "nav-help": { label: "Help & support", shell: "workspace", risk: "none" },
  "nav-tours": { label: "Guided tours", shell: "workspace", risk: "none" },
  "dashboard-overview": { label: "Your command centre", shell: "workspace", risk: "none" },
  "dashboard-journey": { label: "Business journey", shell: "workspace", risk: "none" },
  "dashboard-actions": { label: "Next actions", shell: "workspace", risk: "none" },
  "projects-list": { label: "Your businesses", shell: "workspace", risk: "none" },
  "projects-empty": { label: "Start your first business", shell: "workspace", risk: "none" },

  // ── Business creation ─────────────────────────────────────────────────────
  "new-composer": { label: "Describe your business", shell: "content", risk: "none" },
  "new-method-idea": { label: "Start from an idea", shell: "content", risk: "none" },
  "new-method-website": { label: "Start from a website", shell: "content", risk: "none" },
  "new-method-github": { label: "Start from a GitHub repository", shell: "content", risk: "none" },
  "new-existing-business": { label: "Bring an existing business", shell: "content", risk: "none" },
  "existing-business-intro": { label: "Existing business intake", shell: "content", risk: "none" },
  "existing-business-wizard": { label: "Existing business details", shell: "content", risk: "none" },

  // ── Business workspace ────────────────────────────────────────────────────
  "project-overview": { label: "Business workspace", shell: "project", risk: "none", projectScoped: true },
  "existing-business-profile-link": { label: "Business profile shortcut", shell: "project", risk: "none", projectScoped: true },
  "existing-business-status": { label: "Business reading progress", shell: "project", risk: "none", projectScoped: true },
  "existing-business-assessment": { label: "Initial business assessment", shell: "project", risk: "none", projectScoped: true },
  "existing-business-domains": { label: "Domain ownership verification", shell: "project", risk: "settings-write", projectScoped: true },
  "project-journey": { label: "Where this business is at", shell: "project", risk: "none", projectScoped: true },
  "project-next-action": {
    label: "Build or launch this business",
    shell: "project",
    risk: "credits",
    projectScoped: true,
  },
  "plan-report": { label: "Your business plan", shell: "project", risk: "none", projectScoped: true },
  "cofounder-chat": { label: "Conversation with your co-founder", shell: "project", risk: "none", projectScoped: true },
  "cofounder-input": { label: "Message your co-founder", shell: "project", risk: "none", projectScoped: true },
  "team-progress": { label: "What the AI team is doing", shell: "project", risk: "none", projectScoped: true },
  "app-editor": { label: "Edit your app", shell: "project", risk: "none", projectScoped: true },
  "app-publish": { label: "Publish menu", shell: "project", risk: "publishes", projectScoped: true },
  "app-domain": { label: "Your domain", shell: "project", risk: "settings-write", projectScoped: true },
  "app-deployments": { label: "Deployment history", shell: "project", risk: "none", projectScoped: true },
  "source-browser": { label: "Application source", shell: "project", risk: "none", projectScoped: true },
  "tasks-board": { label: "Tasks and decisions", shell: "project", risk: "none", projectScoped: true },
  "database-manager": {
    label: "Your app's database",
    shell: "project",
    risk: "credits",
    projectScoped: true,
  },
  "env-manager": { label: "Secrets and environment", shell: "project", risk: "destructive", projectScoped: true },

  // ── Growth ────────────────────────────────────────────────────────────────
  "market-overview": { label: "Market & grow", shell: "project", risk: "none", projectScoped: true },
  "market-launch-kit": {
    label: "Launch kit",
    shell: "project",
    risk: "credits",
    projectScoped: true,
  },
  "market-studio": { label: "Marketing studio", shell: "project", risk: "none", projectScoped: true },
  "studio-library": { label: "Content library", shell: "project", risk: "none", projectScoped: true },
  "market-seo": { label: "SEO visibility", shell: "project", risk: "credits", projectScoped: true },
  "ads-overview": { label: "Ads & growth", shell: "project", risk: "none", projectScoped: true },
  "ads-bench": { label: "Ad drafts bench", shell: "project", risk: "credits", projectScoped: true },
  "ads-requests": { label: "Paid placement requests", shell: "project", risk: "money", projectScoped: true },
  "campaigns-board": { label: "Campaign plans", shell: "project", risk: "settings-write", projectScoped: true },
  "competition-dashboard": {
    label: "Competition research",
    shell: "project",
    risk: "credits",
    projectScoped: true,
  },
  "resources-hub": { label: "Business resources", shell: "project", risk: "none", projectScoped: true },
  "resources-research": { label: "Resource sections", shell: "project", risk: "none", projectScoped: true },
  "lessons-library": { label: "Business lessons", shell: "content", risk: "none" },

  // ── Money and measurement ─────────────────────────────────────────────────
  "finances-overview": { label: "Business finances", shell: "project", risk: "none", projectScoped: true },
  "portfolio-finances": { label: "Portfolio finances", shell: "workspace", risk: "none" },
  "intelligence-overview": { label: "Application intelligence", shell: "project", risk: "none", projectScoped: true },
  "intelligence-consent": {
    label: "Analytics consent",
    shell: "project",
    risk: "settings-write",
    projectScoped: true,
  },
  "runtime-overview": { label: "Runtime", shell: "project", risk: "none", projectScoped: true },
  "runtime-usage": { label: "Runtime usage", shell: "project", risk: "none", projectScoped: true },
  "runtime-keys": { label: "API keys", shell: "project", risk: "destructive", projectScoped: true },
  "runtime-health": { label: "Application health", shell: "project", risk: "none", projectScoped: true },

  // ── Account, settings, help ───────────────────────────────────────────────
  "settings-credits": { label: "Credits and plan", shell: "settings", risk: "none" },
  "settings-billing-checkout": { label: "Buy credits", shell: "settings", risk: "money" },
  "settings-features": { label: "Feature switches", shell: "settings", risk: "settings-write" },
  "docs-hub": { label: "Guides and help", shell: "content", risk: "none" },
  "support-report": { label: "Report a problem", shell: "content", risk: "none" },
  "explore-gallery": { label: "Explore what others built", shell: "content", risk: "none" },
  "explore-fork": { label: "Copy a project into your account", shell: "content", risk: "none" },
  "tour-center-list": { label: "Guided tours", shell: "content", risk: "none" },
} as const satisfies Record<string, TourTarget>

export type TourTargetId = keyof typeof TOUR_TARGETS

export const TOUR_TARGET_IDS = Object.keys(TOUR_TARGETS) as TourTargetId[]

export function isTourTargetId(value: unknown): value is TourTargetId {
  return typeof value === "string" && Object.hasOwn(TOUR_TARGETS, value)
}

export function targetRisk(id: TourTargetId): TourRisk {
  return TOUR_TARGETS[id].risk
}

export function isGuidableTarget(id: TourTargetId): boolean {
  return targetRisk(id) === "none"
}
