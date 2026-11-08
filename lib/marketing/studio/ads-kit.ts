import "server-only"

/**
 * Ads Bench service — the /ads surface behind the project dashboard. The
 * founder describes the offer once; each ad-relevant piece (platform copy and
 * image creatives) is drafted through the studio's generation pipeline and
 * persisted as a kit-stamped draft (`kit: "ads"` + a stable `kitSlot`).
 *
 * Nothing is published, uploaded, or run on any ad platform; Atai does not
 * place or manage ads. Billing is the studio's own per-call metering — no
 * up-front kit charge, so a failed piece costs nothing and retries alone.
 */

import { contentItemsCol } from "@/lib/db/collections"
import { AppError } from "@/lib/errors"
import { readCombinedMarketingPlan } from "@/lib/analysis/plan-sections"
import type { OwnerGoals } from "@/lib/marketing/growth-overview"
import type { ContentItemDoc } from "@/lib/types/db"
import type { MirrorProject } from "@/lib/types/project"
import type { ApplicationSpecification } from "@/lib/types/specification"
import { generateMarketContent, type MarketContentView } from "./market-service"
import { adsKitBrief, adsKitSlotById, buildAdsKitContext, ADS_KIT_SLOTS, type AdsKitSlot } from "./ads-kit-content"
import { clean } from "./market-content"

export { ADS_KIT_SLOTS }
export type { AdsKitSlot }

export interface AdsKitItemView {
  id: string
  title: string
  body: string
  kind: MarketContentView["kind"]
  creditsCharged: number
  createdAt: number
  /** Present only in freshly generated items (list reads omit media blobs). */
  media?: MarketContentView["media"]
}

export interface AdsKitSlotView {
  slot: string
  label: string
  description: string
  kind: AdsKitSlot["kind"]
  item: AdsKitItemView | null
}

/** Generate one ads-bench piece from the founder's offer and persist it. */
export async function generateAdsKitSlot(input: {
  userId: string
  projectId: string
  slotId: string
  offer: string
  audience?: string
  project: MirrorProject
  ownerGoals?: OwnerGoals | null
}): Promise<MarketContentView> {
  const slot = adsKitSlotById(input.slotId)
  if (!slot) throw new AppError("VALIDATION")
  const offer = clean(input.offer, 600)
  if (!offer) throw new AppError("VALIDATION")

  const spec = (input.project.specification ?? undefined) as ApplicationSpecification | undefined
  const context = buildAdsKitContext({
    projectName: input.project.name,
    offer,
    audience: input.audience,
    description: spec?.description,
    positioning: spec ? readCombinedMarketingPlan(spec).trim() : undefined,
    targetUsers: spec?.targetUsers,
    siteUrl:
      input.project.deployment?.status === "success" ? input.project.deployment?.productionUrl : undefined,
  })

  return generateMarketContent({
    userId: input.userId,
    projectId: input.projectId,
    kind: slot.kind,
    brief: adsKitBrief(slot, context),
    title: slot.title,
    kit: "ads",
    kitSlot: slot.slot,
    ...(slot.tone ? { tone: slot.tone } : {}),
    ...(slot.channel ? { channel: slot.channel } : {}),
    ...(slot.aspectRatio ? { aspectRatio: slot.aspectRatio } : {}),
    ...(slot.kind === "image" ? { quality: "auto" as const } : {}),
    ...(input.audience ? { audience: input.audience } : {}),
  })
}

function toItemView(doc: ContentItemDoc, kind: AdsKitSlot["kind"]): AdsKitItemView {
  return {
    id: doc.id,
    title: doc.title,
    body: doc.body,
    kind,
    creditsCharged: doc.creditsCharged ?? 0,
    createdAt: doc.createdAt,
  }
}

/**
 * The bench view: every slot with the NEWEST ads-bench draft that fills it.
 * Regenerating a slot adds a new draft; older ones stay in the library.
 * Media blobs are not included — the freshly generated item carries them,
 * and stored items are opened through the studio's per-item read.
 */
export async function listAdsKit(projectId: string): Promise<AdsKitSlotView[]> {
  const col = await contentItemsCol()
  const docs = (await col
    .find(
      { projectId, kind: "marketing_asset", kit: "ads" },
      { projection: { "media.dataUrl": 0 } },
    )
    .sort({ createdAt: -1 })
    .limit(80)
    .toArray()) as unknown as ContentItemDoc[]

  return ADS_KIT_SLOTS.map((slot) => {
    const doc = docs.find((entry) => entry.kitSlot === slot.slot)
    return {
      slot: slot.slot,
      label: slot.label,
      description: slot.description,
      kind: slot.kind,
      item: doc ? toItemView(doc, slot.kind) : null,
    }
  })
}
