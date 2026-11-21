import { store } from "@/lib/store/store"
import { projectIsBuilt } from "@/lib/dashboard/built-states"
import { isConnectedBusiness } from "@/lib/connected-business/guards"

export { BUILT_BUSINESS_STATES, projectIsBuilt } from "@/lib/dashboard/built-states"

/**
 * Account-level gate: a user has an unlocked business if any owned project has
 * reached a built/live state. Resolved server-side only — never trust a
 * client claim. Used to lock the workspace business sections (/finances,
 * project source/runtime/database/env/hosting/intelligence/grow pages, export)
 * until the founder actually has a built application.
 */
export async function userHasBuiltBusiness(userId: string): Promise<boolean> {
  const projects = await store.listProjects(userId, 50)
  return projects.some((project) => projectIsBuilt(project.state))
}

/**
 * The business-advice gate. A connected business is a real business even
 * though Atai never built it, so advice sections (market, competition, ads,
 * campaigns, tasks, resources, lessons, finances, intelligence) and the
 * runtime/integration surface must open for it too. Build-artifact sections
 * keep using `userHasBuiltBusiness` and are separately closed for connected
 * businesses — they describe an app Atai owns, which this is not.
 */
export async function userHasRealBusiness(userId: string): Promise<boolean> {
  const projects = await store.listProjects(userId, 50)
  return projects.some((project) => projectIsBuilt(project.state) || isConnectedBusiness(project))
}
