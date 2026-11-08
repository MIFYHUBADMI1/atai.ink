import { z } from "zod"
import { requireUser } from "@/lib/auth/session"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import type { FeaturePreferences } from "@/lib/types/db"
import {
  isCampaignsEnabledForUser,
  isCampaignsEnvBlocked,
  isGrowthTasksEnabledForUser,
  isGrowthTasksEnvBlocked,
  isSeoAuditEnabledForUser,
  isSeoAuditEnvBlocked,
} from "@/lib/marketing/feature-flags"
import { writeFeaturePreference, type FeaturePreferenceKey } from "@/lib/marketing/feature-preferences"

const PatchSchema = z
  .object({
    seoAudit: z.boolean().optional(),
    growthTasks: z.boolean().optional(),
    campaigns: z.boolean().optional(),
  })
  .strict()

const ENV_BLOCKED: Record<FeaturePreferenceKey, { name: string; blocked: () => boolean }> = {
  seoAudit: { name: "SEO visibility audits", blocked: isSeoAuditEnvBlocked },
  growthTasks: { name: "Growth tasks", blocked: isGrowthTasksEnvBlocked },
  campaigns: { name: "Campaign planning", blocked: isCampaignsEnvBlocked },
}

/**
 * PATCH /api/settings/features
 * The founder flips their own optional features on or off. One or more keys
 * per call; each write merges into the user's featurePreferences.
 * An operator env kill switch beats the founder: the switch refuses honestly
 * instead of silently ignoring the flip.
 */
export async function PATCH(req: Request) {
  try {
    const user = await requireUser()
    const body = PatchSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) {
      return fail("VALIDATION", "Send the switches to flip, e.g. { \"seoAudit\": true }.", 422)
    }

    const keys = (Object.keys(body.data) as FeaturePreferenceKey[]).filter(
      (k) => typeof body.data[k] === "boolean",
    )
    if (keys.length === 0) {
      return fail("VALIDATION", "Nothing to update — pick at least one feature switch.", 422)
    }

    for (const key of keys) {
      if (ENV_BLOCKED[key].blocked()) {
        return fail(
          "VALIDATION",
          `${ENV_BLOCKED[key].name} are temporarily unavailable on this deployment and can't be switched right now.`,
          409,
        )
      }
    }

    let preferences: FeaturePreferences = {}
    for (const key of keys) {
      preferences = await writeFeaturePreference(user.id, key, body.data[key] === true)
    }

    return ok({
      preferences,
      enabled: {
        seoAudit: isSeoAuditEnabledForUser(user.id, preferences),
        growthTasks: isGrowthTasksEnabledForUser(user.id, preferences),
        campaigns: isCampaignsEnabledForUser(user.id, preferences),
      },
    })
  } catch (e) {
    return handleRouteError("api.settings.features", e)
  }
}
