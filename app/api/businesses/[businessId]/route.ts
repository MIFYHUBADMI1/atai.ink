import { z } from "zod"

import { handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { listApplications } from "@/lib/business/applications"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { listMembers } from "@/lib/business/members"
import { archiveBusiness, getBusiness, renameBusiness } from "@/lib/business/service"
import { AppError } from "@/lib/errors"

const RenameSchema = z.object({ name: z.string().trim().min(1).max(120) })

export async function GET(_request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    requireWorkspace(user.id)
    const { businessId } = await params
    const actor = actorOf(user)

    const [business, applications, members] = await Promise.all([
      getBusiness({ businessId, actor }),
      listApplications({ businessId, actor }),
      listMembers({ businessId, actor }),
    ])
    return ok({ business, applications, members })
  } catch (error) {
    return handleRouteError("businesses.get", error)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    requireWorkspace(user.id)
    const { businessId } = await params

    const parsed = RenameSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw new AppError("VALIDATION", "Give the business a name.")

    const business = await renameBusiness({ businessId, actor: actorOf(user), name: parsed.data.name })
    return ok({ business })
  } catch (error) {
    return handleRouteError("businesses.rename", error)
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    requireWorkspace(user.id)
    const { businessId } = await params

    const business = await archiveBusiness({ businessId, actor: actorOf(user) })
    return ok({ business })
  } catch (error) {
    return handleRouteError("businesses.archive", error)
  }
}
