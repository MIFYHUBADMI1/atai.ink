import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/session"

/** Every Content Studio page resolves the session on the server before it
 * renders. The APIs enforce admin rights independently, so this only keeps
 * non-admin visitors out of the console shell. */
export const dynamic = "force-dynamic"

export default async function BlogAdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) redirect("/dashboard")
  return <>{children}</>
}
