import { notFound } from "next/navigation"

import { PageHero } from "@/components/connected-business/page-ui"
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
    <div className="flex flex-col gap-6">
      <PageHero
        eyebrow="Settings"
        title="Who works on this business"
        description="Members and their roles, and the one place a business is archived. Ownership cannot be handed over from here."
      />
      <BusinessWorkspace
        business={business}
        applications={sections.applications}
        archivedApplications={sections.archivedApplications}
        members={sections.members}
        initialTab="Settings"
        showTabBar={false}
        showHeader={false}
      />
    </div>
  )
}
