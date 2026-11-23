import { ProjectFinancesView } from "@/components/finances/project-finances-view"
import { NotConnected } from "@/components/connected-business/not-connected"
import { PageHero } from "@/components/connected-business/page-ui"
import { businessPageContext } from "@/lib/connected-business/page-context"
import { getProjectFinances } from "@/lib/finances/project-finances"

export const dynamic = "force-dynamic"

/**
 * Money for a connected business.
 *
 * The same finances engine the build workspace uses, read through the anchor
 * project. A connected business that has not recorded anything yet honestly
 * shows "no financial data" rather than zeros presented as revenue.
 */
export default async function BusinessMoneyPage({
  params,
}: {
  params: Promise<{ businessId: string }>
}) {
  const { businessId } = await params
  const { business, anchor } = await businessPageContext(businessId, "money.read")

  if (!anchor) return <NotConnected businessId={business.id} what="money" />

  const finances = await getProjectFinances(anchor.projectId)

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        eyebrow="Money"
        title="What the numbers say"
        description={`Revenue, provider cost and net position for ${business.name}. Nothing here is estimated — an empty figure means no data has been recorded yet.`}
      />
      <ProjectFinancesView finances={finances} />
    </div>
  )
}
