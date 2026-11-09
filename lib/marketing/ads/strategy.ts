import "server-only"

/**
 * Advertising strategy service — the founder's own strategy document, one per
 * project. Reads/writes `ad_strategies`; ownership is re-asserted against the
 * project owner on every write (same posture as campaigns/tasks/studio).
 *
 * Saving a strategy is FREE: it records founder intent, it does not generate
 * anything. AI recommendations are studio generations (metered by the runtime
 * router) and are stored as content-library items — never merged into this doc.
 */

import { ObjectId } from "mongodb"
import { store, cryptoId } from "@/lib/store/store"
import { adStrategiesCol, ensureAdsIndexes } from "@/lib/db/ads-collections"
import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import type { AdStrategyDoc } from "@/lib/types/ads"
import {
  AD_STRATEGY_BOUNDS,
  ADS_STRATEGY_SLOT,
  buildStrategyBrief,
  type StrategyBriefInput,
} from "./strategy-content"

export { AD_STRATEGY_BOUNDS, ADS_STRATEGY_SLOT }

export interface AdStrategyInput {
  positioning?: string
  icp?: string
  geographies?: string
  objectives?: unknown
  channels?: unknown
  budgetNote?: string
  priorities?: unknown
  brandVoice?: string
  usps?: string
}

function bounded(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim().slice(0, max)
}

/** Keep only bounded strings, de-duplicated, preserving order. */
function boundedList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") continue
    const cleaned = entry.replace(/\s+/g, " ").trim().slice(0, maxChars)
    if (cleaned && !out.includes(cleaned)) out.push(cleaned)
    if (out.length >= maxItems) break
  }
  return out
}

function normalize(input: AdStrategyInput) {
  return {
    positioning: bounded(input.positioning, AD_STRATEGY_BOUNDS.positioning),
    icp: bounded(input.icp, AD_STRATEGY_BOUNDS.icp),
    geographies: bounded(input.geographies, AD_STRATEGY_BOUNDS.geographies),
    objectives: boundedList(input.objectives, AD_STRATEGY_BOUNDS.listItems, AD_STRATEGY_BOUNDS.listItem),
    channels: boundedList(input.channels, AD_STRATEGY_BOUNDS.listItems, AD_STRATEGY_BOUNDS.listItem),
    budgetNote: bounded(input.budgetNote, AD_STRATEGY_BOUNDS.budgetNote),
    priorities: boundedList(input.priorities, AD_STRATEGY_BOUNDS.listItems, AD_STRATEGY_BOUNDS.listItem),
    brandVoice: bounded(input.brandVoice, AD_STRATEGY_BOUNDS.brandVoice),
    usps: bounded(input.usps, AD_STRATEGY_BOUNDS.usps),
  }
}

export async function getAdStrategy(projectId: string): Promise<AdStrategyDoc | null> {
  await ensureAdsIndexes()
  const col = await adStrategiesCol()
  return (await col.findOne({ projectId })) as unknown as AdStrategyDoc | null
}

/** Create or replace the founder's strategy (one doc per project). */
export async function upsertAdStrategy(input: {
  userId: string
  projectId: string
  strategy: AdStrategyInput
}): Promise<AdStrategyDoc> {
  const project = await store.getProject(input.projectId)
  if (!project || project.userId !== input.userId) {
    throw new AppError("UNAUTHORIZED_PROJECT_ACCESS")
  }

  const fields = normalize(input.strategy)
  const now = Date.now()
  const existing = await getAdStrategy(input.projectId)

  if (existing) {
    const col = await adStrategiesCol()
    const updated = (await col.findOneAndUpdate(
      { projectId: input.projectId },
      { $set: { ...fields, updatedAt: now } },
      { returnDocument: "after" },
    )) as unknown as AdStrategyDoc | null
    if (!updated) throw new AppError("DATABASE_UNAVAILABLE")
    logger.info("marketing.ads.strategy", "strategy updated", { projectId: input.projectId })
    return updated
  }

  const doc: AdStrategyDoc = {
    _id: new ObjectId(),
    id: `adstrat_${cryptoId()}`,
    userId: input.userId,
    projectId: input.projectId,
    ...fields,
    createdAt: now,
    updatedAt: now,
  }
  const col = await adStrategiesCol()
  await col.insertOne(doc as never)
  logger.info("marketing.ads.strategy", "strategy created", { projectId: input.projectId })
  return doc
}

/** The brief for an AI strategy recommendation (metered studio generation). */
export function strategyRecommendationBrief(input: StrategyBriefInput): string {
  return buildStrategyBrief(input)
}

export { ADS_STRATEGY_SLOT as STRATEGY_RECOMMENDATION_SLOT }
