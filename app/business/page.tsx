import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

/**
 * There is one portfolio, and it lives at `/projects`.
 *
 * The connected-business index used to be a second list of the same businesses,
 * which meant two entry points, two sort orders and two empty states. Keeping
 * this route as a redirect preserves every old link and bookmark.
 */
export default function BusinessesPage() {
  redirect("/projects")
}
