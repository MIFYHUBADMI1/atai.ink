import { z } from "zod"

import { handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { addMember, listMembers } from "@/lib/business/members"
import { BUSINESS_ROLES } from "@/lib/types/business"
import { AppError } from "@/lib/errors"

const ScopeSchema = z.union([
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("applications"), applicationIds: z.array(z.string().min(1)).min(1) }),
])

const AddMemberSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(BUSINESS_ROLES),
  scope: ScopeSchema.optional(),
})

export async function GET(_request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "read")
    const { businessId } = await params
    return ok({ members: await listMembers({ businessId, actor: actorOf(user) }) })
  } catch (error) {
    return handleRouteError("businesses.members.list", error)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")
    const { businessId } = await params

    const parsed = AddMemberSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw new AppError("VALIDATION", "Check the person and the role.")

    const member = await addMember({ businessId, actor: actorOf(user), ...parsed.data })
    return ok({ member }, { status: 201 })
  } catch (error) {
    return handleRouteError("businesses.members.add", error)
  }
}
