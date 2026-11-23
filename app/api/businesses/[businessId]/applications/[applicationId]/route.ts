import { handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { archiveApplication } from "@/lib/business/applications"
import { actorOf, requireWorkspace } from "@/lib/business/http"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ businessId: string; applicationId: string }> },
) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")
    const { businessId, applicationId } = await params

    const application = await archiveApplication({ businessId, applicationId, actor: actorOf(user) })
    return ok({ application })
  } catch (error) {
    return handleRouteError("businesses.applications.archive", error)
  }
}
