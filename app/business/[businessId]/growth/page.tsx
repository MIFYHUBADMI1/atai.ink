import Link from "next/link"
import { BadgeCheck, Compass, Globe, ListChecks, PenLine, ShieldQuestion } from "lucide-react"

import { NotConnected } from "@/components/connected-business/not-connected"
import { Chip, PageHero, SectionCard } from "@/components/connected-business/page-ui"
import { GrowthOverviewView } from "@/components/marketing/growth-overview-view"
import { ProductAnalyticsPanel } from "@/components/marketing/product-analytics"
import { SiteReadingCard } from "@/components/connected-business/site-reading-card"
import { SeoAuditPanel } from "@/components/marketing/seo-audit-panel"
import { buttonVariants } from "@/components/ui/button"
import { verifiedHostnameForBusiness } from "@/lib/connected-business/anchor"
import { businessPageContext } from "@/lib/connected-business/page-context"
import { businessNextMoves, businessPriorities } from "@/lib/connected-business/growth"
import { auditableSiteUrl } from "@/lib/connected-business/site-url"
import { businessBase } from "@/lib/connected-business/surface"
import { getProductAnalytics } from "@/lib/analytics/product/service"
import { emptyProductSummary } from "@/lib/analytics/product/summary"
import { getGrowthOverview } from "@/lib/marketing/growth-overview"
import { isSeoAuditEnabledForUser, isStudioWorkspaceEnabled } from "@/lib/marketing/feature-flags"
import { getSeoAuditAffordability } from "@/lib/marketing/seo/credits"
import { getLatestSeoAudit } from "@/lib/marketing/seo/service"

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
 * already maps objectives to screens. The growth overview engine runs here too,
 * but against the proved address (`externalSite`): its result is the
 * unmeasured variant, which states what Atai cannot see instead of rendering a
 * grid of zeroes for a site it does not host.
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

  // The audit reads the proved hostname, never a typed URL, so an unproved
  // business is told what to do instead of being offered an audit that will
  // refuse. Credits are charged to the acting member.
  const site = await auditableSiteUrl(project)
  const overview = await getGrowthOverview({
    user,
    project,
    externalSite: site ? { url: site.url } : {},
  })
  const seoEnabled = isSeoAuditEnabledForUser(user.id, user.featurePreferences)
  const seoAffordability = seoEnabled ? await getSeoAuditAffordability(user.id) : null
  const seoLatest = seoEnabled ? await getLatestSeoAudit(project.id) : null
  // The collector reports into the anchor project, so the read is the same one
  // the build surface makes — the snippet is the only difference between them.
  // A measurement panel is not worth failing a page over.
  const product = await getProductAnalytics(project.id, 30).catch(() => emptyProductSummary(30))

  const priorityTone = (priority: "immediate" | "short_term" | "later") =>
    priority === "immediate" ? "danger" : priority === "short_term" ? "warning" : "muted"

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        eyebrow="Growth"
        title="Turn the read into customers"
        description={`Everything below comes from what Atai read on ${hostname ?? "your site"}. No numbers are invented.`}
        meta={
          <>
            {hostname ? (
              <Chip tone="primary">
                <Globe className="size-3" aria-hidden />
                <span className="break-all">{hostname}</span>
              </Chip>
            ) : null}
            {verified ? (
              <Chip tone="success">
                <BadgeCheck className="size-3" aria-hidden />
                Domain proved
              </Chip>
            ) : (
              <Chip tone="warning">
                <ShieldQuestion className="size-3" aria-hidden />
                Prove the domain to audit it
              </Chip>
            )}
            {seoEnabled && seoAffordability ? <Chip>Audit · {seoAffordability.cost} credits</Chip> : null}
          </>
        }
      />

      <GrowthOverviewView overview={overview} base={businessBase(business.id)} />

      <SiteReadingCard businessId={business.id} reading={reading} hostname={hostname} verified={verified} />

      {priorities.length > 0 ? (
        <SectionCard
          icon={ListChecks}
          title="What to fix first"
          description="Ordered by what holds the business back most, taken from the assessment of your site."
        >
          <ol className="flex flex-col gap-3">
            {priorities.map((priority, index) => (
              <li key={priority.title} className="flex min-w-0 gap-3 border-t border-border/60 pt-3 first:border-0 first:pt-0">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-[11px] font-medium text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={priorityTone(priority.priority)}>{priority.priority.replace("_", " ")}</Chip>
                    <p className="break-words font-medium">{priority.title}</p>
                  </div>
                  <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{priority.explanation}</p>
                  {priority.href && priority.executableNow ? (
                    <Link
                      href={priority.href}
                      className="mt-1.5 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Work on this →
                    </Link>
                  ) : priority.needs ? (
                    <p className="mt-1 text-xs text-muted-foreground">Needs: {priority.needs}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </SectionCard>
      ) : null}

      {moves.length > 0 ? (
        <SectionCard
          icon={Compass}
          title="Where to start"
          description="The shortest paths from what the site says to a first customer."
        >
          <ul className="grid gap-3 sm:grid-cols-2">
            {moves.map((move) => (
              <li
                key={`${move.objective}-${move.title}`}
                className="group flex min-w-0 flex-col gap-1 rounded-xl border border-border/70 p-3 transition-colors hover:border-primary/30 hover:bg-muted/30"
              >
                <p className="break-words text-sm font-medium">{move.title}</p>
                <p className="break-words text-sm leading-6 text-muted-foreground">{move.detail}</p>
                <Link
                  href={move.href}
                  className="mt-1 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SeoAuditPanel
        apiBase={`/api/businesses/${business.id}`}
        state={{
          enabled: seoEnabled,
          ready: Boolean(site),
          notReadyMessage:
            "Prove your domain first — the audit reads only an address you have proved you own. Finish the domain step in Overview.",
          cost: seoAffordability?.cost ?? 0,
          available: seoAffordability?.available ?? 0,
          latest: seoLatest
            ? {
                url: seoLatest.url,
                status: seoLatest.status,
                score: seoLatest.score,
                auditScore: seoLatest.auditScore ?? null,
                pagesCrawled: seoLatest.pagesCrawled,
                findings: seoLatest.findings,
                fromCache: seoLatest.fromCache,
                createdAt: seoLatest.createdAt,
              }
            : null,
        }}
      />

      <ProductAnalyticsPanel summary={product} keysHref={`/business/${business.id}/settings`} />

      <SectionCard
        icon={PenLine}
        title="Create & publish"
        description="Draft posts, pages and emails in your own voice. Nothing is published or sent automatically."
        actions={
          studioEnabled ? (
            <Link href={`/business/${business.id}/growth/studio`} className={buttonVariants()}>
              Open the Studio
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">The Studio is not enabled for this account yet.</span>
          )
        }
      />
    </div>
  )
}
