import { CompetitionDashboard } from "@/components/marketing/competition-dashboard"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { ProjectComingSoon } from "@/components/workspace/project-coming-soon"
import { getCurrentUser } from "@/lib/auth/session"
import { isMarketStudioEnabled } from "@/lib/marketing/feature-flags"
import { getAvailableCredits } from "@/lib/billing/credit-service"
import { capabilityAvailability } from "@/lib/runtime/router/adapters/availability"
import { isFirecrawlConfigured } from "@/lib/integrations/firecrawl/client"
import { competitionContextHash, listCompetitionSnapshots } from "@/lib/marketing/competition-snapshot"
import { readOwnerGoals } from "@/lib/marketing/growth-overview"
import { isPlaceholderValue, readMarketPositioningText, readValuePropositionText } from "@/lib/analysis/plan-sections"
import type { ApplicationSpecification } from "@/lib/types/specification"
import { requireOwnedProject } from "@/lib/workspace/require-owned-project"
import { getResourcesCompetitorIntelligence } from "@/lib/resources/competitor-intelligence"

/**
 * Competition route — the Competition Center dashboard.
 *
 * Combines three honest layers: the competitive story the founder's plan
 * already holds (positioning, value proposition, target users), on-demand
 * LIVE web research (founder-triggered, billed, Firecrawl-backed — queries
 * derived from the plan, sources shown with links and dates), and existing
 * Resources competitor suggestions (labelled as needing verification).
 * Nothing here is presented as continuously monitored market data — every
 * layer states what it actually is, and dashboard estimates are labelled
 * as estimates derived from source mentions.
 */
export default async function ProjectCompetitionPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const project = await requireOwnedProject(projectId, `/project/${projectId}/competition`)
  const user = await getCurrentUser()

  if (!user) {
    return (
      <ProjectComingSoon
        projectId={project.id}
        projectName={project.name}
        kicker="Competition"
        title={`Competitors for ${project.name}`}
        description="This view will show the competitive story from your plan and draft a landscape snapshot from it. The experience is not available yet."
      />
    )
  }

  const spec = (project.specification ?? undefined) as ApplicationSpecification | undefined
  const positioning = readMarketPositioningText(spec)
  const positioningPresent = positioning.length > 0 && !isPlaceholderValue(positioning)
  const valueProposition = readValuePropositionText(spec)
  const valuePresent = valueProposition.length > 0 && !isPlaceholderValue(valueProposition)
  const targetUsers = Array.isArray(spec?.targetUsers)
    ? spec.targetUsers.filter((u) => typeof u === "string" && u.trim().length > 0)
    : []

  const studioEnabled = isMarketStudioEnabled()
  const textReady = studioEnabled && Boolean(capabilityAvailability()["ai.text"]?.configured)
  const researchReady = isFirecrawlConfigured()

  let snapshot = null
  let history: Awaited<ReturnType<typeof listCompetitionSnapshots>> = []
  let creditsAvailable: number | null = null
  if (studioEnabled) {
    try {
      const snapshots = await listCompetitionSnapshots(user.id, project.id)
      snapshot = snapshots[0] ?? null
      history = snapshots.slice(1)
    } catch {
      // Fail-soft like every other read on project pages.
      snapshot = null
      history = []
    }
    try {
      creditsAvailable = await getAvailableCredits(user.id)
    } catch {
      creditsAvailable = null
    }
  }

  const resourcesIntelligence = await getResourcesCompetitorIntelligence(user.id, project.id).catch(() => null)

  return (
    <DashboardShell title={project.name} projectId={project.id}>
      <CompetitionDashboard
        projectId={project.id}
        snapshot={snapshot}
        history={history}
        currentContextHash={competitionContextHash(project, readOwnerGoals(user))}
        creditsAvailable={creditsAvailable}
        textReady={textReady}
        researchReady={researchReady}
        hasPlan={Boolean(spec)}
        researchEnabled={studioEnabled}
        positioning={positioningPresent ? positioning : ""}
        valueProposition={valuePresent ? valueProposition : ""}
        targetUsers={targetUsers}
        intelligence={resourcesIntelligence}
      />
    </DashboardShell>
  )
}