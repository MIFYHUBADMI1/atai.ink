import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { ProjectWorkspace } from "@/components/project-workspace"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { getCurrentUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { businessStartingPointOf } from "@/lib/types/business-intake"

export default async function ProjectWorkspacePage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/project/${(await params).projectId}`)}`)

  const { projectId } = await params
  const project = await store.getProject(projectId)
  if (!project || project.userId !== user.id) notFound()

  return (
    <DashboardShell title={project.name} projectId={project.id}>
      {businessStartingPointOf(project) === "existing_business" ? (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 lg:px-8">
          <Link
            href={`/project/${project.id}/business`}
            data-atai-tour="existing-business-profile-link"
            className="group flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-2.5 text-xs font-medium text-primary transition-colors hover:border-primary/45 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>Business profile — what Atai read, your co-founder&apos;s assessment, and domain ownership</span>
            <ArrowRight className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      ) : null}
      <ProjectWorkspace projectId={project.id} initialState={project.state} />
    </DashboardShell>
  )
}
