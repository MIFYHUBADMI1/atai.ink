import "server-only"

import { revalidatePath } from "next/cache"

/** Refresh the founder-facing lesson surfaces after an admin create/update/
 * archive so a publish is visible without a redeploy. Per-project workspace
 * pages are dynamic (session reads), so only the global library needs it. */
export function revalidateLessonSurfaces(slug?: string) {
  const paths = new Set<string>(["/lessons"])
  if (slug) paths.add(`/lessons/${slug}`)
  for (const path of paths) {
    try {
      revalidatePath(path)
    } catch {
      // Best-effort: route handlers outside a request scope cannot revalidate.
    }
  }
}
