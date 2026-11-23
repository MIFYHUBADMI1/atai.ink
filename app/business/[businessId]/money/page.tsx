import { ProjectFinancesView } from "@/components/finances/project-finances-view"
import { NotConnected } from "@/components/connected-business/not-connected"
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
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Money</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">What the numbers say</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Revenue, provider cost and net position for {business.name}. Nothing here is estimated — an empty figure means
          no data has been recorded yet.
        </p>
      </header>
      <ProjectFinancesView finances={finances} />
    </div>
  )
}
