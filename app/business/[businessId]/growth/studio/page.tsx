import Link from "next/link"

import { MarketStudio } from "@/components/marketing/market-studio"
import { businessPageContext } from "@/lib/connected-business/page-context"
import { NotConnected } from "@/components/connected-business/not-connected"
import { isStudioWorkspaceEnabled } from "@/lib/marketing/feature-flags"

export const dynamic = "force-dynamic"

export default async function BusinessStudioPage({
  params,
}: {
  params: Promise<{ businessId: string }>
}) {
  const { businessId } = await params
  const { user, business, anchor } = await businessPageContext(businessId, "growth.publish")

  if (!anchor) return <NotConnected businessId={business.id} what="the Studio" />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Studio</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Create &amp; publish</h1>
        </div>
        <Link
          href={`/business/${business.id}/growth`}
          className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Growth
        </Link>
      </div>

      {isStudioWorkspaceEnabled(user.id) ? (
        <MarketStudio projectId={anchor.projectId} projectName={business.name} enabled />
      ) : (
        <p className="rounded-2xl border border-border/80 bg-card p-5 text-sm text-muted-foreground">
          The Studio is not enabled for this account yet.
        </p>
      )}
    </div>
  )
}
