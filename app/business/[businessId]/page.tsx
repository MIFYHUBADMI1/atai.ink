import { notFound, redirect } from "next/navigation"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { BusinessWorkspace } from "@/components/connected-business/business-workspace"
import { getCurrentUser } from "@/lib/auth/session"
import { listApplications } from "@/lib/business/applications"
import { isBusinessWorkspaceEnabled } from "@/lib/business/flags"
import { listMembers } from "@/lib/business/members"
import { userActor } from "@/lib/business/permissions"
import { getBusiness } from "@/lib/business/service"
import { AppError } from "@/lib/errors"

export const dynamic = "force-dynamic"

export default async function BusinessWorkspacePage({ params }: { params: Promise<{ businessId: string }> }) {
  const user = await getCurrentUser()
  const { businessId } = await params
  if (!user) redirect(`/login?next=${encodeURIComponent(`/business/${businessId}`)}`)
  if (!isBusinessWorkspaceEnabled(user.id)) notFound()

  const actor = userActor(user.id)

  try {
    const [business, applications, members] = await Promise.all([
      getBusiness({ businessId, actor }),
      listApplications({ businessId, actor }),
      listMembers({ businessId, actor }),
    ])

    return (
      <DashboardShell title={business.name}>
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:py-8 lg:px-8">
          <BusinessWorkspace business={business} applications={applications} members={members} />
        </div>
      </DashboardShell>
    )
  } catch (error) {
    if (error instanceof AppError && (error.code === "BUSINESS_NOT_FOUND" || error.code === "NOT_FOUND")) {
      notFound()
    }
    throw error
  }
}
