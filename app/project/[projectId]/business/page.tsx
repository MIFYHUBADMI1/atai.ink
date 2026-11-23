import { notFound, redirect } from "next/navigation"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { BusinessProfile } from "@/components/existing-business/business-profile"
import { getCurrentUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { businessStartingPointOf } from "@/lib/types/business-intake"
import { listProjectDomains } from "@/lib/domain/service"
import { buildIntakeView } from "@/lib/existing-business/view"
import { ensureBusinessForProject } from "@/lib/connected-business/anchor"

export default async function BusinessProfilePage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser()
  const { projectId } = await params
  if (!user) redirect(`/login?next=${encodeURIComponent(`/project/${projectId}/business`)}`)

  const project = await store.getProject(projectId)
  if (!project || project.userId !== user.id) notFound()
  if (businessStartingPointOf(project) !== "existing_business") redirect(`/project/${projectId}`)

  // A connected business lives in its own workspace. This stepper is now the
  // Overview of that workspace, so a direct visit here is forwarded once the
  // business row exists. The stepper still renders if the business could not be
  // created, so a failed link never strands the founder.
  const businessId =
    project.businessId ??
    (await ensureBusinessForProject({ projectId, userId: user.id })
      .then((result) => result.businessId)
      .catch(() => null))
  if (businessId) redirect(`/business/${businessId}`)

  const domains = await listProjectDomains(projectId)
  const view = buildIntakeView(project, domains)

  return (
    <DashboardShell title={view.displayName || project.name} projectId={project.id}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:py-8 lg:px-8">
        <BusinessProfile projectId={project.id} initialView={view} />
      </div>
    </DashboardShell>
  )
}