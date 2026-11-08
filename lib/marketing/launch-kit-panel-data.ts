import "server-only"

/**
 * Assembles the Market page's Launch Kit panel data, fail-soft like every
 * other read on this page: a kit/library hiccup renders the panel with empty
 * slots rather than failing the whole route.
 */

import { logger } from "@/lib/logging/logger"
import { getAvailableCredits } from "@/lib/billing/credit-service"
import { capabilityAvailability } from "@/lib/runtime/router/adapters/availability"
import { listLaunchKit, LAUNCH_KIT_SLOTS, type LaunchKitSlotView } from "@/lib/marketing/studio/launch-kit"

export interface LaunchKitPanelData {
  slots: LaunchKitSlotView[]
  creditsAvailable: number | null
  textReady: boolean
}

export async function getLaunchKitPanelData(userId: string, projectId: string): Promise<LaunchKitPanelData> {
  const textReady = Boolean(capabilityAvailability()["ai.text"]?.configured)

  let slots: LaunchKitSlotView[]
  try {
    slots = await listLaunchKit(projectId)
  } catch (e) {
    logger.warn("marketing.launchKit", "kit read failed (non-fatal)", {
      projectId,
      message: e instanceof Error ? e.message : String(e),
    })
    slots = LAUNCH_KIT_SLOTS.map((slot) => ({
      slot: slot.slot,
      label: slot.label,
      description: slot.description,
      item: null,
    }))
  }

  let creditsAvailable: number | null = null
  try {
    creditsAvailable = await getAvailableCredits(userId)
  } catch (e) {
    logger.warn("marketing.launchKit", "credit balance read failed (non-fatal)", {
      userId,
      message: e instanceof Error ? e.message : String(e),
    })
  }

  return { slots, creditsAvailable, textReady }
}
