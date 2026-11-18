import { requireOwnedProject } from "@/lib/workspace/require-owned-project"
import { userHasBuiltBusiness } from "@/lib/dashboard/business-access"
import { BusinessLockedForProject } from "@/components/workspace/business-locked"
import { RuntimeOverviewClient } from "@/components/runtime-control/overview-client"

export default async function RuntimeOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const project = await requireOwnedProject(projectId, `/project/${projectId}/runtime`)
  if (!(await userHasBuiltBusiness(project.userId))) return <BusinessLockedForProject section="Runtime" projectId={project.id} />
  return <RuntimeOverviewClient projectId={projectId} />
}
