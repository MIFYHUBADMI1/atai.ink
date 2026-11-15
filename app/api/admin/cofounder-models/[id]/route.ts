import { requireAdmin } from "@/lib/auth/session"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { deleteCofounderTier, updateCofounderTier } from "@/lib/cofounder/model-catalog"
import { notifyCofounderCatalogChange } from "@/lib/cofounder/notify"
import type { CofounderModelTier } from "@/lib/cofounder/models"
import { z } from "zod"

const PatchSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    strength: z.string().min(1).max(300).optional(),
    modelId: z.string().min(1).max(120).optional(),
    creditsPerMessage: z.number().int().min(0).max(10000).optional(),
    position: z.number().int().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

/** PATCH /api/admin/cofounder-models/[id] — edit an engine; emails founders
 * when a user-visible field (name/strength/model/cost) actually changed. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const body = PatchSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) {
      return fail("VALIDATION", "Send only name, strength, modelId, creditsPerMessage, position or enabled.", 422)
    }
    const result = await updateCofounderTier(id, body.data)
    if (!result) return fail("NOT_FOUND", "That engine doesn't exist.", 404)

    let notified: { sent: number; failed: number } | null = null
    if (result.changed) {
      const tier: CofounderModelTier = {
        id: result.doc.id,
        name: result.doc.name,
        strength: result.doc.strength,
        modelId: result.doc.modelId,
        creditsPerMessage: result.doc.creditsPerMessage,
      }
      notified = await notifyCofounderCatalogChange({ kind: "updated", tiers: [tier] })
    }
    return ok({ tier: result.doc, changed: result.changed, notified })
  } catch (e) {
    return handleRouteError("api.admin.cofounder-models.patch", e)
  }
}

/** DELETE /api/admin/cofounder-models/[id] — remove an engine. The last
 * enabled tier can't be deleted; founders on a deleted engine fall back to
 * the default automatically. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const outcome = await deleteCofounderTier(id)
    if (outcome === "not_found") return fail("NOT_FOUND", "That engine doesn't exist.", 404)
    if (outcome === "last_tier") {
      return fail("VALIDATION", "Can't delete the last enabled engine — founders need at least one.", 409)
    }
    return ok({ deleted: id })
  } catch (e) {
    return handleRouteError("api.admin.cofounder-models.delete", e)
  }
}
