import { handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { removeMember } from "@/lib/business/members"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ businessId: string; userId: string }> },
) {
  try {
    const user = await requireUser()
    requireWorkspace(user.id)
    const { businessId, userId } = await params

    const member = await removeMember({ businessId, userId, actor: actorOf(user) })
    return ok({ member })
  } catch (error) {
    return handleRouteError("businesses.members.remove", error)
  }
}
