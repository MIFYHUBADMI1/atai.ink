import "server-only"

import { AppError } from "@/lib/errors"
import { usersCol } from "@/lib/db/collections"
import { logger } from "@/lib/logging/logger"
import { isKnownToolName } from "./tool-registry"
import {
  COFOUNDER_HISTORY_DEPTHS,
  DEFAULT_COFOUNDER_HISTORY_DEPTH,
  MAX_COFOUNDER_INSTRUCTIONS_LENGTH,
  MAX_COFOUNDER_NOTES_LENGTH,
  clampDetail,
  clampDirectness,
  normaliseCofounderName,
  resolveArchetype,
} from "./persona"

/**
 * Persistence and validation for the founder's co-founder settings.
 *
 * Reads are fail-soft (a storage hiccup yields defaults — a broken user doc must
 * never stop the co-founder from answering). Writes are strict: an unknown
 * archetype or an unsupported history depth is a client error, not something
 * to silently coerce, because the settings rail would otherwise show a saved
 * value the server never accepted.
 */

export interface ResolvedCofounderProfile {
  name: string
  archetype: string
  detail: number
  directness: number
  instructions: string
  updatedAt?: number
}

export interface ResolvedCofounderContext {
  historyDepth: number
  includePlanBrief: boolean
  includeAnalytics: boolean
  includeRecentProjects: boolean
  includeBusinessAssessment: boolean
  notes: string
  updatedAt?: number
}

export interface ResolvedCofounderTools {
  disabledTools: string[]
  allowConsequential: boolean
  updatedAt?: number
}

export interface ResolvedCofounderSettings {
  profile: ResolvedCofounderProfile
  context: ResolvedCofounderContext
  tools: ResolvedCofounderTools
}

export interface RawCofounderSettings {
  profile?: Partial<ResolvedCofounderProfile>
  context?: Partial<ResolvedCofounderContext>
  tools?: Partial<ResolvedCofounderTools>
}

export interface CofounderSettingsPatch {
  profile?: Partial<ResolvedCofounderProfile>
  context?: Partial<ResolvedCofounderContext>
  tools?: Partial<ResolvedCofounderTools>
}

/** Strip control characters (newlines/tabs survive), collapse runs of spaces,
 * and bound the result. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
  return cleaned.slice(0, max).trim()
}

function isSupportedHistoryDepth(value: unknown): value is number {
  return typeof value === "number" && (COFOUNDER_HISTORY_DEPTHS as readonly number[]).includes(value)
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

export function resolveCofounderSettings(raw: RawCofounderSettings = {}): ResolvedCofounderSettings {
  const profile = raw.profile ?? {}
  const context = raw.context ?? {}
  const tools = raw.tools ?? {}

  return {
    profile: {
      name: normaliseCofounderName(profile.name),
      archetype: resolveArchetype(profile.archetype).id,
      detail: clampDetail(profile.detail),
      directness: clampDirectness(profile.directness),
      instructions: cleanText(profile.instructions, MAX_COFOUNDER_INSTRUCTIONS_LENGTH),
      ...(typeof profile.updatedAt === "number" ? { updatedAt: profile.updatedAt } : {}),
    },
    context: {
      historyDepth: isSupportedHistoryDepth(context.historyDepth)
        ? context.historyDepth
        : DEFAULT_COFOUNDER_HISTORY_DEPTH,
      includePlanBrief: booleanOr(context.includePlanBrief, true),
      includeAnalytics: booleanOr(context.includeAnalytics, true),
      includeRecentProjects: booleanOr(context.includeRecentProjects, true),
      includeBusinessAssessment: booleanOr(context.includeBusinessAssessment, true),
      notes: cleanText(context.notes, MAX_COFOUNDER_NOTES_LENGTH),
      ...(typeof context.updatedAt === "number" ? { updatedAt: context.updatedAt } : {}),
    },
    tools: {
      // The registry is a closed allow-list: unknown names are dropped rather
      // than stored, so a typo can never look like a tool that exists.
      disabledTools: Array.isArray(tools.disabledTools)
        ? [...new Set(tools.disabledTools.filter((name): name is string => isKnownToolName(name)))]
        : [],
      allowConsequential: booleanOr(tools.allowConsequential, true),
      ...(typeof tools.updatedAt === "number" ? { updatedAt: tools.updatedAt } : {}),
    },
  }
}

/** Read the founder's settings. Fail-soft: any error returns defaults. */
export async function readCofounderSettings(userId: string): Promise<ResolvedCofounderSettings> {
  try {
    const col = await usersCol()
    const doc = await col.findOne(
      { id: userId },
      { projection: { cofounderProfile: 1, cofounderContext: 1, cofounderTools: 1 } },
    )
    if (!doc) return resolveCofounderSettings()
    return resolveCofounderSettings({
      ...(doc.cofounderProfile ? { profile: doc.cofounderProfile } : {}),
      ...(doc.cofounderContext ? { context: doc.cofounderContext } : {}),
      ...(doc.cofounderTools ? { tools: doc.cofounderTools } : {}),
    })
  } catch (e) {
    logger.warn("cofounder.profile", "could not read settings; using defaults", {
      userId,
      message: e instanceof Error ? e.message : String(e),
    })
    return resolveCofounderSettings()
  }
}

/**
 * Merge and persist one or more sections.
 *
 * Each section is merged against its resolved current value, so a PATCH that
 * only changes `context` cannot clear the founder's name or tool choices.
 */
export async function writeCofounderSettings(
  userId: string,
  patch: CofounderSettingsPatch,
): Promise<ResolvedCofounderSettings> {
  if (patch.profile?.archetype !== undefined && resolveArchetype(patch.profile.archetype).id !== patch.profile.archetype) {
    throw new AppError("VALIDATION", "That co-founder archetype does not exist.")
  }
  if (patch.context?.historyDepth !== undefined && !isSupportedHistoryDepth(patch.context.historyDepth)) {
    throw new AppError("VALIDATION", "That conversation history depth is not supported.")
  }

  const col = await usersCol()
  const doc = await col.findOne(
    { id: userId },
    { projection: { cofounderProfile: 1, cofounderContext: 1, cofounderTools: 1 } },
  )
  if (!doc) throw new AppError("UNAUTHORIZED")

  const current = resolveCofounderSettings({
    ...(doc.cofounderProfile ? { profile: doc.cofounderProfile } : {}),
    ...(doc.cofounderContext ? { context: doc.cofounderContext } : {}),
    ...(doc.cofounderTools ? { tools: doc.cofounderTools } : {}),
  })

  const merged = resolveCofounderSettings({
    profile: { ...current.profile, ...patch.profile },
    context: { ...current.context, ...patch.context },
    tools: { ...current.tools, ...patch.tools },
  })

  const now = Date.now()
  merged.profile.updatedAt = now
  merged.context.updatedAt = now
  merged.tools.updatedAt = now

  await col.updateOne(
    { id: userId },
    { $set: { cofounderProfile: merged.profile, cofounderContext: merged.context, cofounderTools: merged.tools } },
  )

  logger.info("cofounder.profile", "settings saved", { userId })
  return merged
}

export {
  COFOUNDER_HISTORY_DEPTHS,
  DEFAULT_COFOUNDER_ARCHETYPE_ID,
  DEFAULT_COFOUNDER_HISTORY_DEPTH,
  MAX_COFOUNDER_INSTRUCTIONS_LENGTH,
  MAX_COFOUNDER_NAME_LENGTH,
  MAX_COFOUNDER_NOTES_LENGTH,
} from "./persona"
