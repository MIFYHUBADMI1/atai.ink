import "server-only"

/**
 * Assembles the Ads page's bench data, fail-soft like every other read on the
 * project pages: a kit/library hiccup renders the bench with empty slots
 * rather than failing the whole route.
 */

import { logger } from "@/lib/logging/logger"
import { getAvailableCredits } from "@/lib/billing/credit-service"
import { capabilityAvailability } from "@/lib/runtime/router/adapters/availability"
import { listAdsKit, ADS_KIT_SLOTS, type AdsKitItemInput, type AdsKitSlotView } from "@/lib/marketing/studio/ads-kit"

export interface AdsBenchData {
  slots: AdsKitSlotView[]
  creditsAvailable: number | null
  textReady: boolean
  imageReady: boolean
  /** The most recent offer/audience the founder generated with, for prefill. */
  initialInput: AdsKitItemInput | null
}

export async function getAdsBenchData(userId: string, projectId: string): Promise<AdsBenchData> {
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

  return {
    slots,
    creditsAvailable,
    textReady,
    imageReady,
    initialInput,
  }
}
