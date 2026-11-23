import Link from "next/link"
import { BadgeCheck, Globe, ScanText, ShieldQuestion } from "lucide-react"

import { Chip, EmptyPanel, PageHero } from "@/components/connected-business/page-ui"
import { BusinessProfile } from "@/components/existing-business/business-profile"
import { buttonVariants } from "@/components/ui/button"
import { businessBase } from "@/lib/connected-business/surface"
import { businessPageContext } from "@/lib/connected-business/page-context"
import { listProjectDomains } from "@/lib/domain/service"
import { buildIntakeView } from "@/lib/existing-business/view"
import { store } from "@/lib/store/store"

export const dynamic = "force-dynamic"

/**
 * The connected business's home.
 *
 * It is the existing onboarding stepper — assessment, domain proof, connection
 * — rendered inside the business workspace. The verification logic is not
 * reimplemented here: `BusinessProfile` owns it and the same API routes run it.
 * What changes is the base its links point at, so the founder stays on the
 * business surface.
 */
export default async function BusinessOverviewPage({
  params,
}: {
  params: Promise<{ businessId: string }>
}) {
  const { businessId } = await params
  const { business, anchor } = await businessPageContext(businessId, "business.read")

  if (!anchor) return <NoAnchorYet businessId={business.id} />

  const project = await store.getProject(anchor.projectId)
  if (!project) return <NoAnchorYet businessId={business.id} />

  const domains = await listProjectDomains(anchor.projectId)
  const view = buildIntakeView(project, domains)
  const pagesRead = project.intake?.website?.reading?.pages.length ?? 0

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        eyebrow="Connected business"
        title={business.name}
        description="This workspace manages and grows the business you already run. Your code, database and hosting stay where they are — Atai never asks for them."
        meta={
          <>
            {view.website.url ? (
              <Chip tone="primary">
                <Globe className="size-3" aria-hidden />
                <span className="break-all">{view.website.url.replace(/^https?:\/\//, "")}</span>
              </Chip>
            ) : null}
            {view.domain.verified ? (
              <Chip tone="success">
                <BadgeCheck className="size-3" aria-hidden />
                Domain proved
              </Chip>
            ) : (
              <Chip tone="warning">
                <ShieldQuestion className="size-3" aria-hidden />
                Domain not proved
              </Chip>
            )}
            {pagesRead > 0 ? (
              <Chip>
                <ScanText className="size-3" aria-hidden />
                {pagesRead} page{pagesRead === 1 ? "" : "s"} read
              </Chip>
            ) : null}
          </>
        }
      />

      <BusinessProfile
        projectId={anchor.projectId}
        initialView={view}
        base={businessBase(business.id)}
        apiBase={`/api/businesses/${business.id}`}
        headingLevel="h2"
      />
    </div>
  )
}

/**
 * A business with no anchor project has nothing to read yet. It is not an
 * error: it is a business that was added by name, before a site was connected.
 */
function NoAnchorYet({ businessId }: { businessId: string }) {
  return (
    <EmptyPanel
      icon={Globe}
      title="Connect the site this business runs on"
      description="Once the address is connected and proved, Atai can read it, tell you what to fix first, and help you market and grow — without touching your codebase."
      action={
        <>
          <Link href="/new/existing" className={buttonVariants()}>
            Connect an existing business
          </Link>
          <Link href={`/business/${businessId}/applications`} className={buttonVariants({ variant: "outline" })}>
            See applications
          </Link>
        </>
      }
    />
  )
}
