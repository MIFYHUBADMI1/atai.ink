import { notFound, redirect } from "next/navigation"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { BusinessProfile } from "@/components/existing-business/business-profile"
import { getCurrentUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { businessStartingPointOf } from "@/lib/types/business-intake"
import { listProjectDomains } from "@/lib/domain/service"
import { buildIntakeView } from "@/lib/existing-business/view"

export default async function BusinessProfilePage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser()
  const { projectId } = await params
  if (!user) redirect(`/login?next=${encodeURIComponent(`/project/${projectId}/business`)}`)

  const project = await store.getProject(projectId)
  if (!project || project.userId !== user.id) notFound()
  if (businessStartingPointOf(project) !== "existing_business") redirect(`/project/${projectId}`)

  const domains = await listProjectDomains(projectId)
  const view = buildIntakeView(project, domains)

  return (
    <DashboardShell title={view.displayName || project.name} projectId={project.id}>
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <BusinessProfile projectId={project.id} initialView={view} />
      </div>
    </DashboardShell>
  )
}