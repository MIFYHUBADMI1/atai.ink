import "server-only"

/**
 * Assembles the Ads page's bench data, fail-soft like every other read on the
 * project pages: a kit/library hiccup renders the bench with empty slots
 * rather than failing the whole route.
 *
 * The bench also carries a GUIDE — the scaffolding a business owner reads
 * before generating anything: the three steps, where their customers might
 * already be (with a reason for each), what to do in the first week, and an
 * offer/audience prefilled from what Atai already knows about this business.
 *
 * Honesty rules the guide keeps: every recommendation says where it comes
 * from, prefilled text is labelled as prefilled, and nothing here claims Atai
 * will post, publish, buy or place anything.
 */

import { logger } from "@/lib/logging/logger"
import { getAvailableCredits } from "@/lib/billing/credit-service"
import { capabilityAvailability } from "@/lib/runtime/router/adapters/availability"
import { listAdsKit, ADS_KIT_SLOTS, type AdsKitItemInput, type AdsKitSlotView } from "@/lib/marketing/studio/ads-kit"
import { defaultBenchSlots } from "@/lib/marketing/studio/ads-kit-content"
import { getAdStrategy } from "@/lib/marketing/ads/strategy"
import { readMarketPositioningText } from "@/lib/analysis/plan-sections"
import { readOwnerGoals } from "@/lib/marketing/growth-overview"
import {
  BENCH_STEPS,
  buildPrefill,
  firstActions,
  recommendChannels,
  skippedChannels,
  type BenchGuide,
  type GuideContext,
} from "@/lib/marketing/ads/beginner-guide"
import type { MirrorProject } from "@/lib/types/project"
import type { UserDoc } from "@/lib/types/db"

export interface AdsBenchData {
  slots: AdsKitSlotView[]
  creditsAvailable: number | null
  textReady: boolean
  imageReady: boolean
  /** The beginner scaffolding: steps, places to show up, first actions, prefill. */
  guide: BenchGuide
}

export async function getAdsBenchData(input: {
  userId: string
  projectId: string
  /** The server-resolved session user — never a client-provided id. */
  user: Pick<UserDoc, "id"> & { onboarding?: UserDoc["onboarding"] }
  /** The project, already ownership-checked by the caller. */
  project: MirrorProject
}): Promise<AdsBenchData> {
  const { userId, projectId, user, project } = input
  const availability = capabilityAvailability()
  const textReady = Boolean(availability["ai.text"]?.configured)
  const imageReady = Boolean(availability["ai.image"]?.configured)

  let slots: AdsKitSlotView[]
  try {
    slots = await listAdsKit(projectId)
  } catch (e) {
    logger.warn("marketing.adsKit", "ads bench read failed (non-fatal)", {
      projectId,
      message: e instanceof Error ? e.message : String(e),
    })
    slots = ADS_KIT_SLOTS.map((slot) => ({
      slot: slot.slot,
      label: slot.label,
      description: slot.description,
      kind: slot.kind,
      group: slot.group,
      whereToPost: slot.whereToPost,
      whatGoodLooksLike: slot.whatGoodLooksLike,
      channelIds: slot.channelIds,
      item: null,
    }))
  }

  let creditsAvailable: number | null = null
  try {
    creditsAvailable = await getAvailableCredits(userId)
  } catch (e) {
    logger.warn("marketing.adsKit", "credit balance read failed (non-fatal)", {
      userId,
      message: e instanceof Error ? e.message : String(e),
    })
  }

  // Each slot fronts its newest draft; the founder's latest generation input is
  // whichever slot item was created last.
  let initialInput: AdsKitItemInput | null = null
  let newestAt = -1
  for (const slot of slots) {
    if (slot.item?.input && slot.item.createdAt > newestAt) {
      newestAt = slot.item.createdAt
      initialInput = slot.item.input
    }
  }

  const guide = await buildGuide({ project, user, initialInput })

  return {
    slots,
    creditsAvailable,
    textReady,
    imageReady,
    guide,
  }
}

/** Assemble the beginner guide from what Atai already knows about the business. */
async function buildGuide(input: {
  project: MirrorProject
  user: Pick<UserDoc, "id"> & { onboarding?: UserDoc["onboarding"] }
  initialInput: AdsKitItemInput | null
}): Promise<BenchGuide> {
  const { project, user, initialInput } = input

  const strategy = await getAdStrategy(project.id).catch((e) => {
    logger.warn("marketing.adsKit", "ad strategy read failed (non-fatal)", {
      projectId: project.id,
      message: e instanceof Error ? e.message : String(e),
    })
    return null
  })

  const ownerGoals = readOwnerGoals(user)
  const planPositioning = readMarketPositioningText(project.specification).trim()
  // The founder's own saved positioning outranks the plan's wording.
  const strategyPositioning = strategy?.positioning?.trim() ?? ""
  const strategyIcp = strategy?.icp?.trim() ?? ""

  const ctx: GuideContext = {
    hasLiveSite: Boolean(project.deployment?.status === "success" && project.deployment?.productionUrl),
    hasSavedStrategy: Boolean(strategy),
    strategyChannels: strategy?.channels ?? [],
    icp: strategyIcp,
    targetUsers: (project.specification?.targetUsers ?? []).filter(
      (user): user is string => typeof user === "string" && user.trim().length > 0,
    ),
    positioning: strategyPositioning || planPositioning,
    businessGoal: ownerGoals?.businessGoal ?? "",
  }

  const recommendations = recommendChannels(ctx)
  const prefill = buildPrefill(ctx)

  const lastOffer = initialInput?.offer?.trim() ?? ""
  const lastAudience = initialInput?.audience?.trim() ?? ""
  const offer = lastOffer || prefill.offer
  const audience = lastAudience || prefill.audience

  return {
    steps: BENCH_STEPS,
    channels: recommendations.map((entry) => ({
      id: entry.channel.id,
      label: entry.channel.label,
      whatItIs: entry.channel.whatItIs,
      whatToPost: entry.channel.whatToPost,
      whereToPost: entry.channel.whereToPost,
      effort: entry.channel.effort,
      cost: entry.channel.cost,
      why: entry.why,
      source: entry.source,
    })),
    others: skippedChannels(ctx).map((entry) => ({
      id: entry.channel.id,
      label: entry.channel.label,
      why: entry.why,
    })),
    firstActions: firstActions(ctx),
    inputs: {
      offer,
      audience,
      offerSource: lastOffer
        ? "last-time"
        : prefill.offer
          ? strategyPositioning
            ? "your-own-words"
            : "your-plan"
          : "none",
      audienceSource: lastAudience
        ? "last-time"
        : prefill.audience
          ? strategyIcp
            ? "your-own-words"
            : "your-plan"
          : "none",
    },
    defaultSlots: defaultBenchSlots(recommendations.map((entry) => entry.channel.id)),
  }
}
