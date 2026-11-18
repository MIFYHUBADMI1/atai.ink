import "server-only"
import { projectsCol, usersCol } from "@/lib/db/collections"
import {
  isCampaignsEnabledForUser,
  isGrowthOverviewEnabledForUser,
  isGrowthTasksEnabledForUser,
  isLessonsEnabledForUser,
  isMarketStudioEnabled,
  isSeoAuditEnabledForUser,
  isStudioEnabledForUser,
} from "@/lib/marketing/feature-flags"
import { sanitizeProgress } from "./progress"
import type { TourContext } from "./registry"
import type { TourProgress } from "./types"

/**
 * The founder's real guidance context, computed server-side from the same flag
 * resolvers the pages use. A tour must never point at a surface the founder
 * cannot reach, so this — not the client — is the authority on what is on.
 */
export async function tourContextForUser(userId: string): Promise<TourContext> {
  const col = await usersCol()
  const doc = await col.findOne({ id: userId }, { projection: { featurePreferences: 1 } })
  const prefs = doc?.featurePreferences

  const projects = await projectsCol()
  const projectCount = await projects.countDocuments({ userId })

  return {
    projectCount,
    features: {
      growth: isGrowthOverviewEnabledForUser(userId),
      marketStudio: isMarketStudioEnabled(),
      studio: isStudioEnabledForUser(userId),
      seoAudit: isSeoAuditEnabledForUser(userId, prefs),
      growthTasks: isGrowthTasksEnabledForUser(userId, prefs),
      campaigns: isCampaignsEnabledForUser(userId, prefs),
      lessons: isLessonsEnabledForUser(userId, prefs),
    },
  }
}

/** The founder's stored tour progress, keyed by tour id. Never coerced. */
export async function tourProgressForUser(userId: string): Promise<Record<string, TourProgress>> {
  const col = await usersCol()
  const doc = await col.findOne({ id: userId }, { projection: { tourProgress: 1 } })
  return sanitizeProgress(doc?.tourProgress ?? {})
}
