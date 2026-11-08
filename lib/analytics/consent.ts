import "server-only"
import { store } from "@/lib/store/store"
import type { MirrorProject, ProjectAnalyticsConsent } from "@/lib/types/project"

/**
 * Per-project founder consent for co-founder product-analytics insights.
 *
 * The permission is stored on the project (MirrorProject.analyticsConsent) and
 * defaults to OFF: an absent flag, or enabled:false, means the co-founder may
 * NOT read the project's analytics. Only the owner can flip it, through the
 * consent API route — never through a model-authored tool input.
 *
 * This module is the single read/write path so the API route and the
 * `get_product_analytics` tool enforce the SAME rule.
 */

/** Resolve consent for an already-fetched project. Absent ⇒ disabled. */
export function readAnalyticsConsent(project: Pick<MirrorProject, "analyticsConsent">): ProjectAnalyticsConsent {
  const consent = project.analyticsConsent
  if (!consent || consent.enabled !== true) {
    return { enabled: false, updatedAt: consent?.updatedAt ?? 0 }
  }
  return { enabled: true, updatedAt: consent.updatedAt }
}

export function analyticsConsentEnabled(project: Pick<MirrorProject, "analyticsConsent">): boolean {
  return project.analyticsConsent?.enabled === true
}

/**
 * Persist the owner's consent choice. Ownership is enforced here (the caller
 * passes the session user id); a non-owner or missing project returns null and
 * nothing is written. Returns the stored consent record.
 */
export async function setAnalyticsConsent(
  projectId: string,
  userId: string,
  enabled: boolean,
): Promise<ProjectAnalyticsConsent | null> {
  const project = await store.getProject(projectId)
  if (!project || project.userId !== userId) return null
  const consent: ProjectAnalyticsConsent = { enabled, updatedAt: Date.now() }
  await store.updateProject(projectId, { analyticsConsent: consent })
  return consent
}