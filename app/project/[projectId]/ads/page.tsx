import Link from "next/link"
import { AdsBench } from "@/components/marketing/ads-bench"
import { AdRequestPanel } from "@/components/marketing/ad-request-panel"
import { AdsRequestsView, type RequestCardView } from "@/components/marketing/ads-requests-view"
import { AdsNav, isAdsTab, type AdsTab } from "@/components/marketing/ads-nav"
import { PromoteWizard } from "@/components/marketing/promote-wizard"
import { PROMOTE_SERVICE_INTRO } from "@/lib/marketing/ads/request-shared"
import { listAdRequests } from "@/lib/marketing/ads/requests"
import {
  AdsStrategyPanel,
  type AdStrategyView,
  type StrategyDraftView,
} from "@/components/marketing/ads-strategy-panel"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { ProjectComingSoon } from "@/components/workspace/project-coming-soon"
import { getCurrentUser } from "@/lib/auth/session"
import { readMarketPositioningText } from "@/lib/analysis/plan-sections"
import { isCampaignsEnabledForUser, isMarketStudioEnabled } from "@/lib/marketing/feature-flags"
import { getAdsBenchData } from "@/lib/marketing/ads-bench-data"
import { getAdStrategy } from "@/lib/marketing/ads/strategy"
import { ADS_STRATEGY_SLOT } from "@/lib/marketing/ads/strategy-content"
import { listAdsKitDrafts } from "@/lib/marketing/studio/ads-kit"
import { getGrowthCenterOverview } from "@/lib/marketing/ads/growth-center"
import { GrowthCenterOverviewView } from "@/components/marketing/growth-center-overview"
import { getAdsAnalytics, isAnalyticsRange } from "@/lib/marketing/ads/analytics"
import { AdsAnalyticsView } from "@/components/marketing/ads-analytics-view"
import { capabilityAvailability } from "@/lib/runtime/router/adapters/availability"
import { getAvailableCredits } from "@/lib/billing/credit-service"
import { requireOwnedProject } from "@/lib/workspace/require-owned-project"
import { logger } from "@/lib/logging/logger"

/**
 * Ads & Growth Center. Real tabs (?tab=): Overview (an honest growth dashboard),
 * Strategy (the founder's own advertising strategy + metered AI recommendations),
 * Ad bench (the creative generation bench), Analytics (recorded promotion
 * results, labeled by source), Promote (request Atai's manual promotion) and
 * History (every ads-kit draft, newest first).
 *
 * Authorization is the uniform `requireOwnedProject` (404 for non-owners, no
 * existence leak). Every tab is a real URL, so refresh and bookmarking work.
 *
 * Honesty: nothing here publishes, uploads, or runs anything on an ad
 * platform. Atai does not place or manage ads — every piece is a draft the
 * founder copies into their platforms by hand, and every recorded result is
 * labeled by source rather than fabricated.
 */

const DRAFT_KIND_LABELS: Record<string, string> = {
  image: "Image creative",
  copy: "Copy",
  brief: "Brief",
}

export default async function ProjectAdsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ tab?: string; request?: string; range?: string; campaign?: string }>
}) {
  const { projectId } = await params
  const { tab: rawTab, request: requestId, range: rawRange, campaign } = await searchParams
  const tab: AdsTab = isAdsTab(rawTab) ? rawTab : requestId ? "requests" : "overview"

  const project = await requireOwnedProject(projectId, `/project/${projectId}/ads`)
  const user = await getCurrentUser()

  if (!user || !isMarketStudioEnabled()) {
    return (
      <ProjectComingSoon
        projectId={project.id}
        projectName={project.name}
        kicker="Ads & growth"
        title={`Growth Center for ${project.name}`}
        description="This is where you plan how the business grows: your strategy, ad drafts and campaign plans in one place. The experience is not available yet."
      />
    )
  }

  return (
    <DashboardShell title={project.name} projectId={project.id}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-16">
        <header className="mb-4 flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Ads &amp; growth</p>
          <h1 className="break-words text-2xl font-semibold tracking-tight text-balance sm:text-3xl lg:text-4xl">
            Growth Center for {project.name}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Your strategy, ad drafts and campaign plans in one place. Atai drafts everything for you to review —
            it never places ads, publishes anything, or promises impressions, reach, or sales.
          </p>
        </header>

        <AdsNav projectId={project.id} active={tab} />

        {tab === "overview" ? (
          <OverviewTab projectId={project.id} user={user} project={project} />
        ) : tab === "strategy" ? (
          <StrategyTab projectId={project.id} user={user} project={project} />
        ) : tab === "bench" ? (
          <BenchTab user={user} project={project} />
        ) : tab === "analytics" ? (
          <AnalyticsTab projectId={project.id} range={rawRange} campaign={campaign} />
        ) : tab === "requests" ? (
          <RequestsTab project={project} requestId={requestId} />
        ) : tab === "promote" ? (
          requestId ? (
            <RequestsTab project={project} requestId={requestId} />
          ) : (
            <PromoteTab project={project} user={user} />
          )
        ) : (
          <HistoryTab projectId={project.id} />
        )}
      </div>
    </DashboardShell>
  )
}

async function OverviewTab({
  user,
  project,
}: {
  projectId: string
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
  project: Awaited<ReturnType<typeof requireOwnedProject>>
}) {
  const [overview, campaignsOn] = await Promise.all([
    getGrowthCenterOverview({ user, project }),
    Promise.resolve(isCampaignsEnabledForUser(user.id, user.featurePreferences)),
  ])

  return <GrowthCenterOverviewView overview={overview} projectId={project.id} campaignsEnabled={campaignsOn} />
}

async function AnalyticsTab({
  projectId,
  range,
  campaign,
}: {
  projectId: string
  range?: string
  campaign?: string
}) {
  const parsed = Number(range)
  const rangeDays = isAnalyticsRange(parsed) ? parsed : 30
  const analytics = await getAdsAnalytics({
    projectId,
    rangeDays,
    requestId: campaign?.trim() ? campaign.trim() : null,
  })

  return <AdsAnalyticsView analytics={analytics} projectId={projectId} />
}

async function StrategyTab({
  projectId,
  user,
  project,
}: {
  projectId: string
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
  project: Awaited<ReturnType<typeof requireOwnedProject>>
}) {
  const availability = capabilityAvailability()

  const [strategy, recommendations, creditsAvailable] = await Promise.all([
    getAdStrategy(projectId).catch(() => null),
    listAdsKitDrafts(projectId, { kitSlot: ADS_STRATEGY_SLOT, limit: 10 }).catch(() => []),
    getAvailableCredits(user.id).catch(() => null),
  ])

  const view: AdStrategyView | null = strategy
    ? {
        positioning: strategy.positioning,
        icp: strategy.icp,
        geographies: strategy.geographies,
        objectives: strategy.objectives,
        channels: strategy.channels,
        budgetNote: strategy.budgetNote,
        priorities: strategy.priorities,
        brandVoice: strategy.brandVoice,
        usps: strategy.usps,
        updatedAt: strategy.updatedAt,
      }
    : null

  const drafts: StrategyDraftView[] = recommendations.map((draft) => ({
    id: draft.id,
    title: draft.title,
    body: draft.body,
    kind: draft.kind,
    creditsCharged: draft.creditsCharged,
    createdAt: draft.createdAt,
  }))

  // Prefill from the plan only when nothing is saved yet — a saved strategy is
  // the founder's own words and is never silently overwritten.
  const prefill = view
    ? {}
    : {
        positioning: readMarketPositioningText(project.specification).trim(),
        icp: (project.specification?.targetUsers ?? []).filter(Boolean).join(", "),
      }

  return (
    <AdsStrategyPanel
      projectId={projectId}
      strategy={view}
      prefill={prefill}
      creditsAvailable={creditsAvailable}
      aiTextReady={Boolean(availability["ai.text"]?.configured)}
      initialRecommendations={drafts}
      campaignsEnabled={isCampaignsEnabledForUser(user.id, user.featurePreferences)}
    />
  )
}

async function BenchTab({
  user,
  project,
}: {
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
  project: Awaited<ReturnType<typeof requireOwnedProject>>
}) {
  const bench = await getAdsBenchData({
    userId: user.id,
    projectId: project.id,
    user,
    project,
  })

  return (
    <AdsBench
      projectId={project.id}
      slots={bench.slots}
      creditsAvailable={bench.creditsAvailable}
      textReady={bench.textReady}
      imageReady={bench.imageReady}
      guide={bench.guide}
    />
  )
}

async function HistoryTab({ projectId }: { projectId: string }) {
  let drafts: Awaited<ReturnType<typeof listAdsKitDrafts>> = []
  try {
    drafts = await listAdsKitDrafts(projectId, { limit: 50 })
  } catch (e) {
    logger.warn("marketing.adsGrowth", "history read failed (non-fatal)", {
      projectId,
      message: e instanceof Error ? e.message : String(e),
    })
  }

  return (
    <section aria-labelledby="ads-history-heading" className="flex flex-col gap-3">
      <h2 id="ads-history-heading" className="text-lg font-semibold tracking-tight">
        Every ad draft, newest first
      </h2>
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        Recommendations, copy and image creatives generated for this project. Each opens in the Studio library, where
        you can refine or reuse it.
      </p>
      {drafts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          Nothing generated yet. Draft creatives on the Ad bench or recommendations on the Strategy tab.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {drafts.map((draft) => {
            const isImage = draft.kind === "image"
            return (
              <li key={draft.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold tracking-tight">{draft.title}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {DRAFT_KIND_LABELS[draft.kind] ?? draft.kind}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {new Date(draft.createdAt).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {!isImage && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{draft.body}</p>}
                {isImage && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {draft.hasMedia
                      ? "Image creative — view and download it in the Studio library."
                      : "Image creative (the stored copy has no viewable image) — regenerate it on the Ad bench."}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {draft.creditsCharged > 0 && (
                    <span className="font-mono text-[10px] text-muted-foreground">{draft.creditsCharged} credits</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">AI draft — you place and run the ad yourself</span>
                  <Link
                    href={`/project/${projectId}/studio?tab=library&item=${encodeURIComponent(draft.id)}`}
                    className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Open in Studio <span aria-hidden>→</span>
                  </Link>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

async function RequestsTab({
  project,
  requestId,
}: {
  project: Awaited<ReturnType<typeof requireOwnedProject>>
  requestId?: string
}) {
  if (requestId) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href={`/project/${project.id}/ads?tab=requests`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden>←</span> All promotion requests
        </Link>
        <AdRequestPanel projectId={project.id} requestId={requestId} />
      </div>
    )
  }

  const docs = await listAdRequests(project.id, { limit: 100 }).catch(() => [])
  const requests: RequestCardView[] = docs.map((doc) => ({
    id: doc.id,
    name: doc.business.name,
    status: doc.status,
    submittedAt: doc.submittedAt,
    goals: doc.promote.goals,
    objective: doc.preferences.objective || doc.promote.goals[0] || "",
    proposalCredits: doc.proposal?.creditsPrice ?? null,
    ...(doc.proposal?.estimatedImpressionsMin !== undefined ? { estimatedImpressionsMin: doc.proposal.estimatedImpressionsMin } : {}),
    ...(doc.proposal?.estimatedImpressionsMax !== undefined ? { estimatedImpressionsMax: doc.proposal.estimatedImpressionsMax } : {}),
  }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">My promotion requests</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Track every request you&apos;ve sent Atai&apos;s team — from review through manual execution to recorded
            results.
          </p>
        </div>
        <Link
          href={`/project/${project.id}/ads?tab=promote`}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          New request <span aria-hidden>→</span>
        </Link>
      </div>
      <AdsRequestsView projectId={project.id} requests={requests} />
    </div>
  )
}

async function PromoteTab({
  project,
  user,
}: {
  project: Awaited<ReturnType<typeof requireOwnedProject>>
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
}) {
  const liveUrl = project.deployment?.productionUrl ?? ""
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Promote my business with Atai</h2>
          <Link href={`/project/${project.id}/ads?tab=requests`} className="text-xs font-medium text-primary hover:underline">
            Track my requests <span aria-hidden>→</span>
          </Link>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{PROMOTE_SERVICE_INTRO}</p>
        <p className="mt-2 text-xs italic leading-5 text-muted-foreground">
          Atai does not automatically publish ads or operate your advertising accounts. Submitting is free.
          You are charged only if you later approve a quotation.
        </p>
      </section>
      <PromoteWizard
        projectId={project.id}
        prefill={{
          name: project.name,
          liveUrl,
          description: project.idea ?? "",
          targetAudience: "",
          pricingInfo: "",
          stage: project.state,
          contact: user.email,
        }}
      />
    </div>
  )
}
