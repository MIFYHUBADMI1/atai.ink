import { NextRequest } from "next/server"
import { z } from "zod"

import { handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { requireAdmin } from "@/lib/auth/session"
import {
  clearBusinessRollout,
  deploymentRollout,
  getBusinessRollout,
  updateBusinessRollout,
} from "@/lib/business/flags"
import { AppError } from "@/lib/errors"

export const dynamic = "force-dynamic"

const PatchSchema = z
  .object({
    mode: z.enum(["off", "internal", "all"]).optional(),
    cohort: z.array(z.string().trim().min(1).max(128)).max(200).optional(),
  })
  .refine((value) => value.mode !== undefined || value.cohort !== undefined, {
    message: "Send a mode, a cohort, or both.",
  })

/** GET — the effective rollout and what the env fallback would be. */
export async function GET() {
  try {
    await requireAdmin()
    return ok({ rollout: await getBusinessRollout(), deployment: deploymentRollout() })
  } catch (error) {
    return handleRouteError("api.admin.connected-business.get", error)
  }
}

/**
 * PATCH — save the admin setting.
 *
 * The mode is a closed enum rather than the lenient parser used for env vars: a
 * typo in an env var must fall back to `off`, but a typo from an admin should be
 * rejected, not silently shut the surface down.
 */
export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await readJsonBody(request, 20_000)
    const parsed = PatchSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid rollout setting.", 422)
    }
    return ok({ rollout: await updateBusinessRollout(parsed.data, admin.id) })
  } catch (error) {
    return handleRouteError("api.admin.connected-business.patch", error)
  }
}

/** DELETE — remove the override and hand control back to the env vars. */
export async function DELETE() {
  try {
    await requireAdmin()
    return ok({ rollout: await clearBusinessRollout() })
  } catch (error) {
    return handleRouteError("api.admin.connected-business.delete", error)
  }
}
