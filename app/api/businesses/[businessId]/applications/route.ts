import { z } from "zod"

import { handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { createApplication, listApplications } from "@/lib/business/applications"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { APPLICATION_KINDS } from "@/lib/types/business"
import { AppError } from "@/lib/errors"

const CreateApplicationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(APPLICATION_KINDS),
  url: z.string().trim().min(1).max(2048),
  basePath: z.string().trim().max(512).optional(),
})

export async function GET(_request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    requireWorkspace(user.id)
    const { businessId } = await params
    return ok({ applications: await listApplications({ businessId, actor: actorOf(user) }) })
  } catch (error) {
    return handleRouteError("businesses.applications.list", error)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    requireWorkspace(user.id)
    const { businessId } = await params

    const parsed = CreateApplicationSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw new AppError("VALIDATION", "Check the application's name and address.")

    const application = await createApplication({ businessId, actor: actorOf(user), ...parsed.data })
    return ok({ application }, { status: 201 })
  } catch (error) {
    return handleRouteError("businesses.applications.create", error)
  }
}
