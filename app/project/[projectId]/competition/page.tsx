import { CompetitionSnapshotPanel, type CompetitionSnapshotItem } from "@/components/marketing/competition-snapshot-panel"
import { CofounderMarkdown } from "@/components/cofounder/markdown"
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
import { CompetitorIntelligenceList } from "@/components/project-resources/competitor-intelligence-list"

/**
 * Competition route.
 *
 * Combines three honest layers: the competitive story the founder's plan
 * already holds (positioning, value proposition, target users), on-demand
 * LIVE web research (founder-triggered, billed, Firecrawl-backed — queries
 * derived from the plan, sources shown with links and dates), and existing
 * Resources competitor suggestions (labelled as needing verification).
 * Nothing here is presented as continuously monitored market data — every
 * layer states what it actually is.
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
  let history: CompetitionSnapshotItem[] = []
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-12 pt-6 sm:gap-8 sm:px-6 sm:pt-8 lg:px-8 lg:pb-16">
        <header className="flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Competition</p>
          <h1 className="break-words text-2xl font-semibold tracking-tight text-balance sm:text-3xl lg:text-4xl">
            Where {project.name} stands
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Your plan&apos;s positioning, on-demand live web research you trigger yourself, and Resources competitor
            suggestions — each layer keeps its original context and is labelled for what it is. Research sources are
            shown with links so you can verify every claim.
          </p>
        </header>

        <section aria-labelledby="competitive-story-heading" className="flex flex-col gap-3">
          <h2 id="competitive-story-heading" className="text-lg font-semibold tracking-tight">
            The competitive story in your plan
          </h2>
          {!spec ? (
            <p className="rounded-2xl border border-dashed border-border bg-transparent p-4 text-sm leading-6 text-muted-foreground sm:p-5">
              No application plan exists yet for this project. Generate one from the workspace — the competitive story
              comes from it.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {positioningPresent ? (
                <div className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Market positioning</p>
                  <div className="mt-2 min-w-0">
                    <CofounderMarkdown>{positioning}</CofounderMarkdown>
                  </div>
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed border-border bg-transparent p-4 text-sm leading-6 text-muted-foreground sm:p-5">
                  The plan has no market positioning yet — add it in the plan editor and this page fills in.
                </p>
              )}
              {valuePresent ? (
                <div className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Value proposition</p>
                  <div className="mt-2 min-w-0">
                    <CofounderMarkdown>{valueProposition}</CofounderMarkdown>
                  </div>
                </div>
              ) : null}
              {targetUsers.length > 0 ? (
                <div className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Who you are competing for</p>
                  <ul className="mt-2 flex flex-col gap-1 text-sm leading-6">
                    {targetUsers.map((u, index) => (
                      <li key={`${index}-${u}`} className="break-words">· {u}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {studioEnabled && (
          <CompetitionSnapshotPanel
            projectId={project.id}
            snapshot={snapshot}
            history={history}
            currentContextHash={competitionContextHash(project, readOwnerGoals(user))}
            creditsAvailable={creditsAvailable}
            textReady={textReady}
            researchReady={researchReady}
            hasPlan={Boolean(spec)}
          />
        )}
        <CompetitorIntelligenceList intelligence={resourcesIntelligence} projectId={project.id} />
      </div>
    </DashboardShell>
  )
}
