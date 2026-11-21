import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { CampaignsPanel, type CampaignView } from "@/components/marketing/campaigns-panel"
import { ProjectComingSoon } from "@/components/workspace/project-coming-soon"
import { getCurrentUser } from "@/lib/auth/session"
import { isCampaignsEnabledForUser } from "@/lib/marketing/feature-flags"
import { listCampaigns } from "@/lib/marketing/campaigns/service"
import { requireOwnedProject } from "@/lib/workspace/require-owned-project"
import { userHasRealBusiness } from "@/lib/dashboard/business-access"
import { BusinessLockedForProject } from "@/components/workspace/business-locked"

/**
 * Campaigns route (Phase 6 — W5).
 *
 * Authorization is identical to every other project page: requireOwnedProject
 * session-checks the user and 404s on any non-owner (uniform — no existence leak).
 * The feature flag is evaluated server-side only; when disabled the route renders
 * the EXACT coming-soon experience. The page load is read-only and FREE — creating
 * plans and approving AI proposals happen via the API route / CONFIRM tool. A
 * campaign is a plan the founder manages manually: it tracks intent, not results,
 * and Atai sends/posts/spends/runs nothing here.
 */
export default async function ProjectCampaignsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const project = await requireOwnedProject(projectId, `/project/${projectId}/campaigns`)
  if (!(await userHasRealBusiness(project.userId))) return <BusinessLockedForProject section="Campaigns" projectId={project.id} />
  const user = await getCurrentUser()

  if (!user || !isCampaignsEnabledForUser(user.id, user.featurePreferences)) {
    return (
      <ProjectComingSoon
        projectId={project.id}
        projectName={project.name}
        kicker="Plan & track"
        title={`Campaigns for ${project.name}`}
        description="This is where you will plan and track marketing campaigns for this project. The experience is not available yet."
        action={{ href: "/settings/features", label: "Turn on campaign planning" }}
      />
    )
  }

  // Read-only, free assembly.
  const docs = await listCampaigns(project.id)
  const campaigns: CampaignView[] = docs.map((d) => ({
    id: d.id,
    name: d.name,
    objective: d.objective,
    channels: d.channels,
    status: d.status,
    plannedBudgetCents: d.plannedBudgetCents,
    utmCampaign: d.utmCampaign,
    startDate: d.startDate,
    endDate: d.endDate,
    notes: d.notes ?? null,
    assetIds: d.assetIds ?? [],
    origin: d.origin,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    pausedAt: d.pausedAt,
    cancelledAt: d.cancelledAt,
  }))

  return (
    <DashboardShell title={project.name} projectId={project.id}>
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-16">
        <header className="mb-5 flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Ads &amp; growth</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="break-words text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Campaigns for {project.name}
            </h1>
            <a
              href={`/project/${project.id}/ads`}
              className="text-xs font-medium text-primary hover:underline"
            >
              <span aria-hidden>←</span> Back to Growth Center
            </a>
          </div>
        </header>
        <CampaignsPanel projectId={project.id} state={{ enabled: true, campaigns }} />
      </div>
    </DashboardShell>
  )
}
