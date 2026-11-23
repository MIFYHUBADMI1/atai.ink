import Link from "next/link"

import { PenLine } from "lucide-react"

import { MarketStudio } from "@/components/marketing/market-studio"
import { PageHero, SectionCard } from "@/components/connected-business/page-ui"
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
    <div className="flex flex-col gap-6">
      <PageHero
        eyebrow="Studio"
        title="Create & publish"
        description="Draft posts, pages and emails in your own voice, grounded in the copy Atai read from your site. Nothing is published or sent automatically."
        actions={
          <Link
            href={`/business/${business.id}/growth`}
            className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            ← Back to Growth
          </Link>
        }
      />

      {isStudioWorkspaceEnabled(user.id) ? (
        <MarketStudio projectId={anchor.projectId} projectName={business.name} enabled />
      ) : (
        <SectionCard icon={PenLine} title="Not enabled yet">
          <p className="text-sm leading-6 text-muted-foreground">
            The Studio is not enabled for this account yet. Ask support to turn it on — nothing else in Growth changes
            while it is off.
          </p>
        </SectionCard>
      )}
    </div>
  )
}
