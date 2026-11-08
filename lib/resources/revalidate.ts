import "server-only"

import { revalidatePath } from "next/cache"

/** Refresh every public surface that renders the resource library. Called after
 * admin create/update/archive so a publish is visible without a redeploy. */
export function revalidateResourceSurfaces(resource?: { category: string; slug: string }) {
  const paths = new Set([
    "/resources",
    "/docs",
    "/sitemap.xml",
    "/seo/sitemap.xml",
    "/resources/sitemap.xml",
    "/llms.txt",
    "/llms-full.txt",
  ])
  if (resource) {
    paths.add(`/resources/${resource.category}`)
    paths.add(`/resources/${resource.category}/${resource.slug}`)
  }
  for (const path of paths) {
    try {
      revalidatePath(path)
    } catch {
      // Best-effort: route handlers outside a request scope cannot revalidate.
    }
  }
}
