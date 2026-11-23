import { z } from "zod"

import { handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { createBusiness, listBusinessesForUser } from "@/lib/business/service"
import { AppError } from "@/lib/errors"

const CreateBusinessSchema = z.object({
  name: z.string().trim().min(1).max(120),
  suggestedName: z.string().trim().max(120).optional(),
  suggestedNameSource: z.enum(["website_title", "hostname", "founder"]).optional(),
})

export async function GET() {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "read")
    return ok({ businesses: await listBusinessesForUser({ actor: actorOf(user) }) })
  } catch (error) {
    return handleRouteError("businesses.list", error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")

    const parsed = CreateBusinessSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw new AppError("VALIDATION", "Give the business a name.")

    const business = await createBusiness({ actor: actorOf(user), ...parsed.data })
    return ok({ business }, { status: 201 })
  } catch (error) {
    return handleRouteError("businesses.create", error)
  }
}
