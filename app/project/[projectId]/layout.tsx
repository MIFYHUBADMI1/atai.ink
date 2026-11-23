import { notFound, redirect } from "next/navigation"

import { getCurrentUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { workspaceModeOf } from "@/lib/connected-business/surface"

/**
 * The build workspace is closed to a connected business.
 *
 * A connected business is managed at `/business/<id>`; letting `/project/<id>`
 * render for it would show source, database, deploy and plan screens that do
 * not describe it. This guard is a layout on purpose: it covers every project
 * page but not the `/api/projects/**` routes, which the connected app's runtime
 * and SDK still need through the anchor project.
 *
 * A project that has not been linked to a business yet is left alone, so the
 * onboarding stepper at `/project/<id>/business` can create the business and
 * send the founder on — redirecting it here would loop.
 */
export default async function ProjectWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const user = await getCurrentUser()
  if (!user) return children

  const project = await store.getProject(projectId)
  if (!project || project.userId !== user.id) notFound()

  if (workspaceModeOf(project) === "operate" && project.businessId) {
    redirect(`/business/${project.businessId}`)
  }

  return children
}
