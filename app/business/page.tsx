import { notFound, redirect } from "next/navigation"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { BusinessIndex } from "@/components/connected-business/business-index"
import { getCurrentUser } from "@/lib/auth/session"
import { isBusinessWorkspaceEnabled } from "@/lib/business/flags"
import { userActor } from "@/lib/business/permissions"
import { listBusinessesForUser } from "@/lib/business/service"

export const dynamic = "force-dynamic"

export default async function BusinessesPage() {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent("/business")}`)
  if (!(await isBusinessWorkspaceEnabled(user.id))) notFound()

  const businesses = await listBusinessesForUser({ actor: userActor(user.id) })

  return (
    <DashboardShell title="Businesses">
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:py-8 lg:px-8">
        <BusinessIndex initialBusinesses={businesses} />
      </div>
    </DashboardShell>
  )
}
