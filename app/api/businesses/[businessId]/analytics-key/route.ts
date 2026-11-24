import "server-only"

import { z } from "zod"

import { withAiProtection } from "@/lib/api/ai-protection"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { resolveBusinessAnchorProject } from "@/lib/connected-business/anchor"
import { createApiKey, listApiKeys } from "@/lib/runtime/keys/service"

/**
 * The browser key a connected business needs to install the analytics snippet.
 *
 * A connected business has no project settings page — the build surface is
 * closed to it — so this is the one place it can mint the key. The route is
 * business-addressed (the anchor project id never reaches the browser) and it
 * only ever issues a PUBLISHABLE key, which the runtime restricts to the
 * `analytics` scope. The plaintext secret is returned once, as everywhere else.
 */

const BodySchema = z
  .object({ name: z.string().min(1).max(100).optional() })
  .strip()

export async function GET(_req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "read")
    const { businessId } = await params
    const { project, ownerId } = await resolveBusinessAnchorProject({
      businessId,
      actor: actorOf(user),
      permission: "runtime.keys.manage",
    })
    const keys = await listApiKeys(ownerId, project.id)
    return ok({ keys: keys.filter((key) => key.kind === "publishable") })
  } catch (e) {
    return handleRouteError("api.businesses.analyticsKey.get", e)
  }
}

export const POST = withAiProtection("analysis", post)

async function post(req: Request, context: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")
    const { businessId } = await context.params
    const { project, ownerId } = await resolveBusinessAnchorProject({
      businessId,
      actor: actorOf(user),
      permission: "runtime.keys.manage",
    })

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail("VALIDATION", "Invalid request.", 422)

    const created = await createApiKey(ownerId, {
      projectId: project.id,
      environment: "production",
      name: parsed.data.name ?? "Website analytics",
      scopes: [],
      kind: "publishable",
    })

    return ok({ key: created })
  } catch (e) {
    return handleRouteError("api.businesses.analyticsKey.post", e)
  }
}
