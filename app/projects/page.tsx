import type { Metadata } from "next"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { ProjectsWorkspace, type ConnectedBusinessItem } from "./workspace"
import { getCurrentUser } from "@/lib/auth/session"
import { redirect } from "next/navigation"
import { store } from "@/lib/store/store"
import { getPlatformFinances } from "@/lib/finances/platform-finances"
import { resolveProjectThumbnail } from "@/lib/media/project-thumbnail"
import type { ProjectSummary } from "@/lib/types/project"
import { ensureBusinessForProject } from "@/lib/connected-business/anchor"
import { userActor } from "@/lib/business/permissions"
import { listBusinessesForUser } from "@/lib/business/service"

export const metadata: Metadata = {
  title: "All businesses - Atai",
  description: "Manage your businesses, track performance, and decide what to do next — all in one place.",
}

/**
 * Business portfolio workspace — server component.
 *
 * Fetches projects and platform finances server-side, joins them to create
 * enriched business summaries, then passes to the interactive client workspace.
 * Follows the honesty rule: financial data is shown only where available;
 * missing data is labeled "No financial data yet," never fabricated.
 */
export default async function ProjectsPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login?next=/projects")

  const actor = userActor(user.id)

  // One portfolio: every business the founder owns, whichever surface it opens.
  // Connected businesses are fetched unconditionally — a business the founder
  // just connected must appear immediately, not once a rollout flag catches up.
  const [allProjects, platformFinances, owned] = await Promise.all([
    store.listProjects(user.id),
    getPlatformFinances(user.id).catch(() => null), // Graceful degradation
    listBusinessesForUser({ actor }).catch(() => []),
  ])

  // A connected project without a business row would send the founder to a
  // workspace that does not exist yet. Idempotent, and capped so a large legacy
  // account cannot turn one page render into fifty transactions.
  const needsBusiness = allProjects.filter(
    (project) => project.startingPoint === "existing_business" && !project.businessId,
  )
  for (const project of needsBusiness.slice(0, 5)) {
    await ensureBusinessForProject({ projectId: project.id, userId: user.id }).catch(() => undefined)
  }

  // An operate project is the hidden anchor of a business: it must never be
  // listed as a build row, or the founder sees one business twice and the build
  // workspace leaks a surface it does not own.
  const operatedProjectIds = new Set<string>()
  for (const project of allProjects) {
    if (project.businessId) operatedProjectIds.add(project.id)
  }
  for (const business of owned) {
    if (business.legacyProjectId) operatedProjectIds.add(business.legacyProjectId)
  }

  const projects = allProjects.filter(
    (project) => !operatedProjectIds.has(project.id) && project.startingPoint !== "existing_business",
  )

  const businesses: ConnectedBusinessItem[] = owned.map((business) => ({
    kind: "business" as const,
    id: business.id,
    name: business.name,
    status: business.status,
    updatedAt: business.updatedAt,
  }))

  // Build a map of project finances for quick lookup
  const financesByProject = new Map(
    (platformFinances?.byProject ?? []).map((pf) => [pf.projectId, pf])
  )

  // Enrich projects with financial summaries where available
  const enrichedProjects: Array<ProjectSummary & {
    financialSummary?: {
      earningsMinor: number | null
      creditsCharged: number
      providerCostUsd: number | null
      currency: string | null
      hasFinancialData: boolean
    }
  }> = projects.map((p) => {
    const finance = financesByProject.get(p.id)
    const summary: ProjectSummary = {
      id: p.id,
      name: p.name,
      mode: p.mode,
      state: p.state,
      sourceUrl: p.sourceUrl,
      updatedAt: p.updatedAt,
      thumbnailUrl: resolveProjectThumbnail(p.understanding?.screenshots),
      visibility: p.visibility,
      // Lets the list recognise a build that lost its watching session.
      totalumProjectId: p.totalumProjectId,
      lastPolledAt: p.lastPolledAt,
    }

    if (finance) {
      return {
        ...summary,
        financialSummary: {
          earningsMinor: finance.earningsMinor,
          creditsCharged: finance.creditsCharged,
          providerCostUsd: finance.providerCostUsd,
          currency: finance.currency,
          hasFinancialData: true,
        },
      }
    }

    return {
      ...summary,
      financialSummary: {
        earningsMinor: null,
        creditsCharged: 0,
        providerCostUsd: null,
        currency: null,
        hasFinancialData: false,
      },
    }
  })

  // Portfolio totals for the overview section
  const portfolioTotals = platformFinances?.totals ?? null

  return (
    <DashboardShell title="All businesses">
      <div className="mx-auto w-full max-w-7xl px-6 py-10 lg:px-10">
        <ProjectsWorkspace
          projects={enrichedProjects}
          businesses={businesses}
          portfolioTotals={portfolioTotals}
        />
      </div>
    </DashboardShell>
  )
}
