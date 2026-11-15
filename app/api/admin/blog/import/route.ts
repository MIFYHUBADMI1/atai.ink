import { requireAdmin } from "@/lib/auth/session"
import { handleRouteError, ok } from "@/lib/api/respond"
import { importLegacyArticles } from "@/lib/blog/store"

export const dynamic = "force-dynamic"

/** One-time migration: copies the original blog/<slug>.md posts into the
 * database. Existing slugs are skipped, never overwritten. */
export async function POST() {
  try {
    const admin = await requireAdmin()
    const result = await importLegacyArticles(admin.id)
    return ok(result)
  } catch (error) {
    return handleRouteError("api.admin.blog.import", error)
  }
}