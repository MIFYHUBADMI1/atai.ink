import { notFound } from "next/navigation"

import { BusinessWorkspace } from "@/components/connected-business/business-workspace"
import { businessPageContext } from "@/lib/connected-business/page-context"
import { businessSections } from "@/lib/connected-business/sections"

export const dynamic = "force-dynamic"

export default async function BusinessSettingsPage({
  params,
}: {
  params: Promise<{ businessId: string }>
}) {
  const { businessId } = await params
  const { actor, business } = await businessPageContext(businessId, "business.read")
  const sections = await businessSections({ businessId: business.id, actor }).catch(() => null)
  if (!sections) notFound()

  return (
    <BusinessWorkspace
      business={business}
      applications={sections.applications}
      archivedApplications={sections.archivedApplications}
      members={sections.members}
      initialTab="Settings"
      showTabBar={false}
      showHeader={false}
    />
  )
}
