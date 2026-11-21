import { businessStartingPointOf } from "@/lib/types/business-intake"
import type { MirrorProject } from "@/lib/types/project"

/**
 * Client-safe predicates that separate the two onboarding paths.
 *
 * Path 1 builds or initializes an application inside Atai (idea, website
 * mirror, URL, GitHub import). Path 2 connects an application that already
 * runs outside Atai. Nothing on Path 2 may enter Path 1's build pipeline.
 */

export function isConnectedBusiness(
  project: Pick<MirrorProject, "startingPoint"> | null | undefined,
): boolean {
  return businessStartingPointOf(project) === "existing_business"
}

/** Returned by every build/plan/deploy entry point that is asked to act on a
 * connected business. One message, so the API and the UI cannot disagree. */
export const CONNECTED_BUSINESS_BUILD_BLOCKED =
  "This business is connected to Atai, not built in Atai. There is no application here to build or deploy — Atai works with the application you already run."
