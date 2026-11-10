import Link from "next/link"
import { AdsBench } from "@/components/marketing/ads-bench"
import { AdRequestList } from "@/components/marketing/ad-request-list"
import { AdRequestPanel } from "@/components/marketing/ad-request-panel"
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
import { getGrowthOverview } from "@/lib/marketing/growth-overview"
import { listCampaigns } from "@/lib/marketing/campaigns/service"
import { capabilityAvailability } from "@/lib/runtime/router/adapters/availability"
import { getAvailableCredits } from "@/lib/billing/credit-service"
import { requireOwnedProject } from "@/lib/workspace/require-owned-project"
import { logger } from "@/lib/logging/logger"
import type { NumberMetric } from "@/lib/marketing/growth-overview"

/**
 * Ads & Growth Center (Phase 2). Four real tabs (?tab=): Overview (an honest
 * growth snapshot + campaign and bench status), Strategy (the founder's own
 * advertising strategy + metered AI recommendations), Ad bench (the Phase 1
 * generation bench) and History (every ads-kit draft, newest first).
 *
 * Authorization is the uniform `requireOwnedProject` (404 for non-owners, no
 * existence leak). Every tab is a real URL, so refresh and bookmarking work.
 *
 * Honesty: nothing here publishes, uploads, or runs anything on an ad
 * platform. Atai does not place or manage ads — every piece is a draft the
 * founder copies into their platforms by hand.
 */

const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Running",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
}

const DRAFT_KIND_LABELS: Record<string, string> = {
  image: "Image creative",
  copy: "Copy",
  brief: "Brief",
}

function compactMetric(metric: NumberMetric, label: string) {
  const showValue = metric.state === "available" || metric.state === "measured_zero"
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {metric.state === "available"
            ? "measured"
            : metric.state === "measured_zero"
              ? "measured · zero"
              : metric.state === "unavailable"
                ? "data unavailable"
                : "not measured yet"}
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {showValue ? (metric.value ?? 0).toLocaleString() : "—"}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{metric.definition}</p>
      <p className="mt-1 text-xs leading-5 italic text-muted-foreground">{metric.caveat}</p>
    </div>
  )
}

export default async function ProjectAdsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ tab?: string; request?: string }>
}) {
  const { projectId } = await params
  const { tab: rawTab, request: requestId } = await searchParams
  const tab: AdsTab = isAdsTab(rawTab) ? rawTab : requestId ? "promote" : "overview"

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
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-16">
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
          <BenchTab userId={user.id} projectId={project.id} />
        ) : tab === "promote" ? (
          <PromoteTab project={project} user={user} requestId={requestId} />
        ) : (
          <HistoryTab projectId={project.id} />
        )}
      </div>
    </DashboardShell>
  )
}

async function OverviewTab({
  projectId,
  user,
  project,
}: {
  projectId: string
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
  project: Awaited<ReturnType<typeof requireOwnedProject>>
}) {
  const [overview, campaigns, strategy, campaignsOn] = await Promise.all([
    getGrowthOverview({ user, project }),
    listCampaigns(projectId, { limit: 5 }).catch(() => []),
    getAdStrategy(projectId).catch(() => null),
    Promise.resolve(isCampaignsEnabledForUser(user.id, user.featurePreferences)),
  ])

  const headlineMetrics: Array<{ label: string; metric: NumberMetric }> = [
    { label: "Runtime requests", metric: overview.metrics.runtimeRequests },
    { label: "Completed payments", metric: overview.metrics.completedPayments },
  ]
  const liveUrl = overview.site.url

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="growth-business-heading" className="flex flex-col gap-3">
        <h2 id="growth-business-heading" className="text-lg font-semibold tracking-tight">
          The business right now
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-2xl border border-border bg-card p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Lifecycle</p>
            <p className="mt-2 break-words text-base font-medium">{overview.projectStateLabel}</p>
          </div>
          <div className="min-w-0 rounded-2xl border border-border bg-card p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Live site</p>
            {liveUrl ? (
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-sm text-primary hover:underline">
                {liveUrl}
              </a>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Not deployed yet</p>
            )}
            <p className="mt-1 text-xs leading-5 italic text-muted-foreground">{overview.site.caveat}</p>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          The full picture — plan completeness, every metric and its caveats — lives in{" "}
          <Link href={`/project/${projectId}/market`} className="font-medium text-primary hover:underline">
            Market &amp; grow
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="growth-numbers-heading" className="flex flex-col gap-3">
        <h2 id="growth-numbers-heading" className="text-lg font-semibold tracking-tight">
          Real measurements (30-day window)
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {headlineMetrics.map(({ label, metric }) => (
            <div key={label}>{compactMetric(metric, label)}</div>
          ))}
        </div>
        <ul className="flex flex-col gap-1">
          {overview.trustNotes.map((note) => (
            <li key={note} className="text-xs leading-5 text-muted-foreground">
              {note}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="growth-next-heading" className="flex flex-col gap-3">
        <h2 id="growth-next-heading" className="text-lg font-semibold tracking-tight">
          Where to act next
        </h2>
        {overview.nextSteps.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
            Nothing is pending — keep going with your strategy and bench below.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {overview.nextSteps.slice(0, 4).map((step) => (
              <li key={step.id} className="rounded-2xl border border-border bg-card p-4">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          These steps come from observed project state, not analytics — they are suggestions, and Atai executes none of
          them for you.
        </p>
      </section>

      <section aria-labelledby="growth-workspace-heading" className="flex flex-col gap-3">
        <h2 id="growth-workspace-heading" className="text-lg font-semibold tracking-tight">
          Your growth workspace
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href={`/project/${projectId}/ads?tab=strategy`}
            className="flex h-full flex-col gap-1 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-sm font-medium">{strategy ? "Review your advertising strategy" : "Write your advertising strategy"}</span>
            <span className="text-xs leading-5 text-muted-foreground">
              {strategy
                ? "Saved — refine it or generate fresh recommendations."
                : "Tell Atai who you're reaching and what matters. Saving is free."}
            </span>
          </Link>
          <Link
            href={`/project/${projectId}/ads?tab=bench`}
            className="flex h-full flex-col gap-1 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-sm font-medium">Draft ad creatives</span>
            <span className="text-xs leading-5 text-muted-foreground">
              Platform copy and image creatives from your offer — you place them yourself.
            </span>
          </Link>
          <Link
            href={`/project/${projectId}/ads?tab=promote`}
            className="flex h-full flex-col gap-1 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-sm font-medium">Request Atai promotion</span>
            <span className="text-xs leading-5 text-muted-foreground">
              Ask Atai&apos;s team to review your live business and send a quotation. Execution is manual.
            </span>
          </Link>
          {campaignsOn ? (
            <Link
              href={`/project/${projectId}/campaigns`}
              className="flex h-full flex-col gap-1 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-sm font-medium">Plan a campaign</span>
              <span className="text-xs leading-5 text-muted-foreground">
                Audience, message, channels, timing — plans you run yourself, nothing scheduled or posted.
              </span>
            </Link>
          ) : null}
          <Link
            href={`/project/${projectId}/studio?tab=create`}
            className="flex h-full flex-col gap-1 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-sm font-medium">Open the Marketing Studio</span>
            <span className="text-xs leading-5 text-muted-foreground">
              Every draft lands in the Studio library — reuse and refine anything from here.
            </span>
          </Link>
        </div>
      </section>

      <section aria-labelledby="growth-campaigns-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="growth-campaigns-heading" className="text-lg font-semibold tracking-tight">
            Recent campaigns
          </h2>
          {campaignsOn ? (
            <Link href={`/project/${projectId}/campaigns`} className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Open campaign planning
            </Link>
          ) : null}
        </div>
        {!campaignsOn ? (
          <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
            Campaign planning is switched off. You can turn it on in{" "}
            <Link href="/settings/features" className="underline underline-offset-4">
              settings
            </Link>
            .
          </p>
        ) : campaigns.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
            No campaigns yet. Plans only — nothing is scheduled, posted, or executed anywhere.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
            {campaigns.map((campaign) => (
              <li key={campaign.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="font-medium">{campaign.name}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {CAMPAIGN_STATUS_LABELS[campaign.status] ?? campaign.status}
                </span>
                {campaign.channels.length > 0 && (
                  <span className="text-xs text-muted-foreground">{campaign.channels.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
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
    />
  )
}

async function BenchTab({ userId, projectId }: { userId: string; projectId: string }) {
  const bench = await getAdsBenchData(userId, projectId)

  return (
    <AdsBench
      projectId={projectId}
      slots={bench.slots}
      creditsAvailable={bench.creditsAvailable}
      textReady={bench.textReady}
      imageReady={bench.imageReady}
      initialInput={bench.initialInput}
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

async function PromoteTab({
  project,
  user,
  requestId,
}: {
  project: Awaited<ReturnType<typeof requireOwnedProject>>
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
  requestId?: string
}) {
  const requests = await listAdRequests(project.id)
  if (requestId) {
    return (
      <div className="flex flex-col gap-4">
        <Link href={`/project/${project.id}/ads?tab=promote`} className="text-sm text-muted-foreground hover:text-foreground">
          ← All promotion requests
        </Link>
        <AdRequestPanel projectId={project.id} requestId={requestId} />
      </div>
    )
  }

  const liveUrl = project.deployment?.productionUrl ?? ""
  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold tracking-tight">Promote my business with Atai</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{PROMOTE_SERVICE_INTRO}</p>
        <p className="mt-2 text-xs italic leading-5 text-muted-foreground">
          Atai does not automatically publish ads or operate your advertising accounts. Submitting is free.
          You are charged only if you later approve a quotation.
        </p>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Your requests</h3>
        <AdRequestList projectId={project.id} requests={requests} />
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
