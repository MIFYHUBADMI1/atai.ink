import { handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { restoreBusiness } from "@/lib/business/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(_request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    requireWorkspace(user.id)
    const { businessId } = await params
    const business = await restoreBusiness({ businessId, actor: actorOf(user) })
    return ok({ business })
  } catch (error) {
    return handleRouteError("businesses.restore", error)
  }
}
