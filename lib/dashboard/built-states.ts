import type { ProjectState } from "@/lib/types/project"

/**
 * States in which a business has a successfully built application (built or
 * live). Client-safe (no server imports) so both the sidebar and server pages
 * share one definition. deployment_failed is excluded on purpose: the app is
 * built but not live, and the account gate keys off any built business — the
 * founder reaches that project's tools through the workspace, not these
 * gated growth sections.
 */
export const BUILT_BUSINESS_STATES: ReadonlySet<ProjectState> = new Set([
  "build_complete",
  "ready",
  "deploying",
  "deployed",
])

export function projectIsBuilt(state: ProjectState): boolean {
  return BUILT_BUSINESS_STATES.has(state)
}
