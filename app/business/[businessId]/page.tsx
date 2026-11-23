import Link from "next/link"

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

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Connected business</p>
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight sm:text-3xl">{business.name}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          This workspace manages and grows the business you already run. Your code, database and hosting stay where
          they are — Atai never asks for them.
        </p>
      </section>

      <BusinessProfile
        projectId={anchor.projectId}
        initialView={view}
        base={businessBase(business.id)}
        apiBase={`/api/businesses/${business.id}`}
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
    <div className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Not connected yet</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Connect the site this business runs on</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Once the address is connected and proved, Atai can read it, tell you what to fix first, and help you market
          and grow — without touching your codebase.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/new/existing" className={buttonVariants()}>
          Connect an existing business
        </Link>
        <Link href={`/business/${businessId}/applications`} className={buttonVariants({ variant: "outline" })}>
          See applications
        </Link>
      </div>
    </div>
  )
}
