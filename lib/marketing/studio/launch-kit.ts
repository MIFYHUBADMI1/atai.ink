import "server-only"

/**
 * Launch Kit service — the "Market my app for me" pass behind the Market page
 * hero. One click generates the founder's launch package piece by piece from
 * the plan the platform already holds; every piece is a DRAFT stamped into the
 * content library (`kit: "launch"` + a stable `kitSlot`). Nothing is posted,
 * sent, or scheduled anywhere — publishing stays entirely manual, exactly like
 * every other studio surface.
 *
 * Billing is the studio's own path: each piece runs through
 * `generateMarketContent`, which is metered per runtime call. There is no
 * up-front kit charge, so nothing needs refunding — a piece that fails was
 * never billed for, and the founder retries just that piece.
 */

import { contentItemsCol } from "@/lib/db/collections"
import { AppError } from "@/lib/errors"
import { readCombinedMarketingPlan } from "@/lib/analysis/plan-sections"
import { readOwnerGoals } from "@/lib/marketing/growth-overview"
import type { ContentItemDoc } from "@/lib/types/db"
import type { MirrorProject } from "@/lib/types/project"
import type { ApplicationSpecification } from "@/lib/types/specification"
import { generateMarketContent, type MarketContentView } from "./market-service"
import {
  launchKitBrief,
  launchKitSlotById,
  buildLaunchKitContext,
  LAUNCH_KIT_SLOTS,
  type LaunchKitSlot,
} from "./launch-kit-content"

export { LAUNCH_KIT_SLOTS }
export type { LaunchKitSlot }

export interface LaunchKitItemView {
  id: string
  title: string
  body: string
  creditsCharged: number
  createdAt: number
}

export interface LaunchKitSlotView {
  slot: string
  label: string
  description: string
  item: LaunchKitItemView | null
}

/** Generate one kit piece and persist it as a launch-kit library draft. */
export async function generateLaunchKitSlot(input: {
  userId: string
  projectId: string
  slotId: string
  project: MirrorProject
  ownerGoals: ReturnType<typeof readOwnerGoals>
}): Promise<MarketContentView> {
  const slot = launchKitSlotById(input.slotId)
  if (!slot) throw new AppError("VALIDATION")

  const spec = (input.project.specification ?? undefined) as ApplicationSpecification | undefined
  const context = buildLaunchKitContext({
    projectName: input.project.name,
    description: spec?.description,
    idea: input.project.idea,
    marketingPlan: spec ? readCombinedMarketingPlan(spec).trim() : undefined,
    targetUsers: spec?.targetUsers,
    siteUrl:
      input.project.deployment?.status === "success" ? input.project.deployment?.productionUrl : undefined,
    goals: input.ownerGoals ?? undefined,
  })

  return generateMarketContent({
    userId: input.userId,
    projectId: input.projectId,
    kind: slot.kind,
    brief: launchKitBrief(slot, context),
    title: slot.title,
    kit: "launch",
    kitSlot: slot.slot,
    ...(slot.tone ? { tone: slot.tone } : {}),
    ...(slot.channel ? { channel: slot.channel } : {}),
    ...(slot.length ? { length: slot.length } : {}),
  })
}

function toItemView(doc: ContentItemDoc): LaunchKitItemView {
  return {
    id: doc.id,
    title: doc.title,
    body: doc.body,
    creditsCharged: doc.creditsCharged ?? 0,
    createdAt: doc.createdAt,
  }
}

/**
 * The kit view: every slot with the NEWEST launch-kit draft that fills it.
 * Regenerating a slot adds a new draft; older ones stay in the library.
 */
export async function listLaunchKit(projectId: string): Promise<LaunchKitSlotView[]> {
  const col = await contentItemsCol()
  const docs = (await col
    .find(
      { projectId, kind: "marketing_asset", kit: "launch" },
      // Bodies are plain text and wanted here; media data URLs are not.
      { projection: { "media.dataUrl": 0 } },
    )
    .sort({ createdAt: -1 })
    .limit(80)
    .toArray()) as unknown as ContentItemDoc[]

  return LAUNCH_KIT_SLOTS.map((slot) => {
    const doc = docs.find((entry) => entry.kitSlot === slot.slot)
    return {
      slot: slot.slot,
      label: slot.label,
      description: slot.description,
      item: doc ? toItemView(doc) : null,
    }
  })
}
