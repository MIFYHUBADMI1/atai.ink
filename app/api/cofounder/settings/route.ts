import { z } from "zod"

import { requireUser } from "@/lib/auth/session"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { COFOUNDER_ARCHETYPES } from "@/lib/cofounder/persona"
import { listToolCatalog } from "@/lib/cofounder/tool-registry"
import { listCofounderTiers } from "@/lib/cofounder/model-catalog"
import { readCofounderModelTier, resolveCofounderModel } from "@/lib/cofounder/model"
import {
  COFOUNDER_HISTORY_DEPTHS,
  MAX_COFOUNDER_INSTRUCTIONS_LENGTH,
  MAX_COFOUNDER_NAME_LENGTH,
  MAX_COFOUNDER_NOTES_LENGTH,
  readCofounderSettings,
  writeCofounderSettings,
} from "@/lib/cofounder/profile"

/**
 * GET /api/cofounder/settings — everything the settings rail needs.
 * PATCH /api/cofounder/settings — save one or more sections.
 *
 * The tool catalog is read-only: the rail may disable a tool, never add one.
 */

const PatchSchema = z
  .object({
    profile: z
      .object({
        name: z.string().max(MAX_COFOUNDER_NAME_LENGTH).optional(),
        archetype: z.string().min(1).max(40).optional(),
        detail: z.number().int().min(1).max(5).optional(),
        directness: z.number().int().min(1).max(5).optional(),
        instructions: z.string().max(MAX_COFOUNDER_INSTRUCTIONS_LENGTH).optional(),
      })
      .strict()
      .optional(),
    context: z
      .object({
        historyDepth: z.number().int().optional(),
        includePlanBrief: z.boolean().optional(),
        includeAnalytics: z.boolean().optional(),
        includeRecentProjects: z.boolean().optional(),
        includeBusinessAssessment: z.boolean().optional(),
        notes: z.string().max(MAX_COFOUNDER_NOTES_LENGTH).optional(),
      })
      .strict()
      .optional(),
    tools: z
      .object({
        disabledTools: z.array(z.string().min(1).max(80)).max(200).optional(),
        allowConsequential: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export async function GET() {
  try {
    const user = await requireUser()
    await checkRateLimit({
      action: "cofounder_settings_read",
      identifier: user.id,
      limit: 120,
      windowMs: 60_000,
    })

    const [settings, tiers, stored, resolved] = await Promise.all([
      readCofounderSettings(user.id),
      listCofounderTiers(),
      readCofounderModelTier(user.id),
      resolveCofounderModel(user.id),
    ])

    return ok({
      settings,
      archetypes: COFOUNDER_ARCHETYPES,
      toolCatalog: listToolCatalog(),
      tiers,
      current: {
        tierId: resolved.tier.id,
        tierName: resolved.tier.name,
        modelId: resolved.modelId,
        creditsPerMessage: resolved.tier.creditsPerMessage,
      },
      storedTierId: stored ?? null,
      envTierId: process.env.COFOUNDER_MODEL_TIER?.trim() || null,
      limits: {
        name: MAX_COFOUNDER_NAME_LENGTH,
        instructions: MAX_COFOUNDER_INSTRUCTIONS_LENGTH,
        notes: MAX_COFOUNDER_NOTES_LENGTH,
        historyDepths: COFOUNDER_HISTORY_DEPTHS,
      },
    })
  } catch (e) {
    return handleRouteError("api.cofounder.settings.get", e)
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser()
    await checkRateLimit({
      action: "cofounder_settings_write",
      identifier: user.id,
      limit: 60,
      windowMs: 60_000,
    })

    const body = PatchSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) {
      return fail("VALIDATION", "Those co-founder settings didn't look right.", 422)
    }

    const settings = await writeCofounderSettings(user.id, body.data)
    return ok({ settings })
  } catch (e) {
    return handleRouteError("api.cofounder.settings.patch", e)
  }
}
