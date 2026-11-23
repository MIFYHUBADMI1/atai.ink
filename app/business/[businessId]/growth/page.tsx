import Link from "next/link"

import { NotConnected } from "@/components/connected-business/not-connected"
import { SiteReadingCard } from "@/components/connected-business/site-reading-card"
import { buttonVariants } from "@/components/ui/button"
import { verifiedHostnameForBusiness } from "@/lib/connected-business/anchor"
import { businessPageContext } from "@/lib/connected-business/page-context"
import { businessNextMoves, businessPriorities } from "@/lib/connected-business/growth"
import { isStudioWorkspaceEnabled } from "@/lib/marketing/feature-flags"

export const dynamic = "force-dynamic"

function hostnameOf(url?: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Growth for a connected business.
 *
 * It reuses the read the founder already paid for and the objective engine that
 * already maps objectives to screens. It does not show the deployment-based
 * growth overview: that engine describes a site Atai hosts, and telling a
 * founder whose site is live that it was "never deployed" would be a lie.
 */
export default async function BusinessGrowthPage({
  params,
}: {
  params: Promise<{ businessId: string }>
}) {
  const { businessId } = await params
  const { user, business, project } = await businessPageContext(businessId, "growth.read")

  if (!project) return <NotConnected businessId={business.id} what="growth" />

  const reading = project.intake?.website?.reading ?? null
  // A proved address is the one the business may be read at; the typed address
  // is only a fallback for a business whose domain step is still open.
  const verifiedHost = await verifiedHostnameForBusiness(business.id)
  const hostname = verifiedHost ?? hostnameOf(project.intake?.website?.url ?? project.sourceUrl ?? null)
  const verified = Boolean(verifiedHost)
  const priorities = businessPriorities({ project, businessId: business.id })
  const moves = businessNextMoves({ project, userId: user.id, businessId: business.id })
  const studioEnabled = isStudioWorkspaceEnabled(user.id)

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Growth</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Turn the read into customers</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Everything below comes from what Atai read on {hostname ?? "your site"}. No numbers are invented.
        </p>
      </header>

      <SiteReadingCard businessId={business.id} reading={reading} hostname={hostname} verified={verified} />

      {priorities.length > 0 ? (
        <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold">What to fix first</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {priorities.map((priority) => (
              <li key={priority.title} className="border-t border-border/60 pt-3 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {priority.priority.replace("_", " ")}
                  </span>
                  <p className="font-medium">{priority.title}</p>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{priority.explanation}</p>
                {priority.href && priority.executableNow ? (
                  <Link href={priority.href} className="mt-1 inline-block text-xs font-medium text-primary hover:underline">
                    Work on this →
                  </Link>
                ) : priority.needs ? (
                  <p className="mt-1 text-xs text-muted-foreground">Needs: {priority.needs}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {moves.length > 0 ? (
        <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Where to start</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {moves.map((move) => (
              <li key={`${move.objective}-${move.title}`} className="rounded-xl border border-border/70 p-3">
                <p className="text-sm font-medium">{move.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{move.detail}</p>
                <Link href={move.href} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">Create &amp; publish</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Draft posts, pages and emails in your own voice. Nothing is published or sent automatically.
          </p>
        </div>
        {studioEnabled ? (
          <Link href={`/business/${business.id}/growth/studio`} className={buttonVariants()}>
            Open the Studio
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">The Studio is not enabled for this account yet.</span>
        )}
      </section>
    </div>
  )
}
