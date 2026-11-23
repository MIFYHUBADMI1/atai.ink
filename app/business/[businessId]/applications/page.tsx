import { notFound } from "next/navigation"

import { PageHero } from "@/components/connected-business/page-ui"
import { BusinessWorkspace } from "@/components/connected-business/business-workspace"
import { businessPageContext } from "@/lib/connected-business/page-context"
import { businessSections } from "@/lib/connected-business/sections"

export const dynamic = "force-dynamic"

export default async function BusinessApplicationsPage({
  params,
}: {
  params: Promise<{ businessId: string }>
}) {
  const { businessId } = await params
  const { actor, business } = await businessPageContext(businessId, "apps.read")
  const sections = await businessSections({ businessId: business.id, actor }).catch(() => null)
  if (!sections) notFound()

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        eyebrow="Applications"
        title="Every app this business runs"
        description="The apps Atai watches for this business, the addresses they live on, and whether each one has talked back. Atai never takes custody of the code or the hosting."
      />
      <BusinessWorkspace
        business={business}
        applications={sections.applications}
        archivedApplications={sections.archivedApplications}
        members={sections.members}
        initialTab="Applications"
        showTabBar={false}
        showHeader={false}
      />
    </div>
  )
}
