import { requireAdmin } from "@/lib/auth/session"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { createCofounderTier, listCofounderTiers } from "@/lib/cofounder/model-catalog"
import { notifyCofounderCatalogChange } from "@/lib/cofounder/notify"
import type { CofounderModelTier } from "@/lib/cofounder/models"
import { z } from "zod"

const CreateSchema = z
  .object({
    name: z.string().min(1).max(60),
    strength: z.string().min(1).max(300),
    modelId: z.string().min(1).max(120),
    creditsPerMessage: z.number().int().min(0).max(10000),
  })
  .strict()

/** GET /api/admin/cofounder-models — the live engine catalog founders see. */
export async function GET() {
  try {
    await requireAdmin()
    return ok({ tiers: await listCofounderTiers() })
  } catch (e) {
    return handleRouteError("api.admin.cofounder-models.list", e)
  }
}

/** POST /api/admin/cofounder-models — add an engine, then email founders. */
export async function POST(req: Request) {
  try {
    await requireAdmin()
    const body = CreateSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) {
      return fail("VALIDATION", "Send name, strength, modelId and creditsPerMessage.", 422)
    }
    const doc = await createCofounderTier(body.data)
    const tier: CofounderModelTier = {
      id: doc.id,
      name: doc.name,
      strength: doc.strength,
      modelId: doc.modelId,
      creditsPerMessage: doc.creditsPerMessage,
    }
    // Broadcast is best-effort inside notify — a mail outage never fails this.
    const notice = await notifyCofounderCatalogChange({ kind: "added", tiers: [tier] })
    return ok({ tier, notified: notice }, { status: 201 })
  } catch (e) {
    return handleRouteError("api.admin.cofounder-models.create", e)
  }
}
