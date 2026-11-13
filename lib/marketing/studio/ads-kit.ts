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

export interface AdsKitItemInput {
  offer: string
  audience?: string
}

export interface AdsKitItemView {
  id: string
  title: string
  body: string
  kind: MarketContentView["kind"]
  creditsCharged: number
  createdAt: number
  /** Present only in freshly generated items (list reads omit media blobs). */
  media?: MarketContentView["media"]
  /** The founder's raw bench inputs persisted with the item, for prefill on return. */
  input?: AdsKitItemInput
  /** True when a stored image exists and can be fetched through the per-item read. */
  hasMedia: boolean
  /** The media was too large to persist — nothing viewable exists for this item. */
  mediaNotPersisted?: boolean
}

export interface AdsKitSlotView {
  slot: string
  label: string
  description: string
  kind: AdsKitSlot["kind"]
  /** Free posts the founder publishes, or paid ad pieces. */
  group: AdsKitSlot["group"]
  /** Step-by-step: exactly where this draft gets pasted. */
  whereToPost: string
  /** What a good version of this looks like. */
  whatGoodLooksLike: string
  /** The places this piece makes sense on. */
  channelIds: AdsKitSlot["channelIds"]
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
    ownerGoals: input.ownerGoals ?? null,
  })

  return generateMarketContent({
    userId: input.userId,
    projectId: input.projectId,
    kind: slot.kind,
    brief: adsKitBrief(slot, context),
    title: slot.title,
    kit: "ads",
    kitSlot: slot.slot,
    kitInput: input.audience ? { offer, audience: input.audience } : { offer },
    ...(slot.tone ? { tone: slot.tone } : {}),
    ...(slot.channel ? { channel: slot.channel } : {}),
    ...(slot.aspectRatio ? { aspectRatio: slot.aspectRatio } : {}),
    ...(slot.kind === "image" ? { quality: "auto" as const } : {}),
    ...(input.audience ? { audience: input.audience } : {}),
  })
}

function toItemView(doc: ContentItemDoc, kind: AdsKitSlot["kind"]): AdsKitItemView {
  const raw = doc.kitInput
  const offer = typeof raw?.offer === "string" && raw.offer ? raw.offer : undefined
  const audience = typeof raw?.audience === "string" && raw.audience ? raw.audience : undefined
  return {
    id: doc.id,
    title: doc.title,
    body: doc.body,
    kind,
    creditsCharged: doc.creditsCharged ?? 0,
    createdAt: doc.createdAt,
    // List reads exclude the dataUrl blob; the bench fetches it per item.
    ...(doc.media
      ? {
          media: {
            kind: doc.media.kind,
            ...(doc.media.jobId ? { jobId: doc.media.jobId } : {}),
            ...(doc.media.status ? { status: doc.media.status } : {}),
            ...(doc.media.notPersisted ? { notPersisted: true } : {}),
          } as MarketContentView["media"],
        }
      : {}),
    ...(offer ? { input: { offer, ...(audience ? { audience } : {}) } } : {}),
    hasMedia: Boolean(doc.media?.kind),
    ...(doc.media?.notPersisted ? { mediaNotPersisted: true } : {}),
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
      group: slot.group,
      whereToPost: slot.whereToPost,
      whatGoodLooksLike: slot.whatGoodLooksLike,
      channelIds: slot.channelIds,
      item: doc ? toItemView(doc, slot.kind) : null,
    }
  })
}

export interface AdsKitDraftView {
  id: string
  title: string
  body: string
  kind: MarketContentView["kind"]
  kitSlot?: string
  creditsCharged: number
  createdAt: number
  hasMedia: boolean
  mediaNotPersisted?: boolean
}

/**
 * Newest-first ads-bench drafts (no per-slot dedupe): the History tab and the
 * strategy recommendation read both use this. Media blobs are excluded —
 * stored items open through the library's per-item read.
 */
export async function listAdsKitDrafts(
  projectId: string,
  opts: { kitSlot?: string; limit?: number } = {},
): Promise<AdsKitDraftView[]> {
  const col = await contentItemsCol()
  const filter: Record<string, unknown> = { projectId, kind: "marketing_asset", kit: "ads" }
  if (opts.kitSlot) filter.kitSlot = opts.kitSlot
  const docs = (await col
    .find(filter, { projection: { "media.dataUrl": 0 } })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(opts.limit ?? 20, 1), 50))
    .toArray()) as unknown as ContentItemDoc[]

  return docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    body: doc.body,
    kind: (doc.assetKind ?? "copy") as MarketContentView["kind"],
    ...(doc.kitSlot ? { kitSlot: doc.kitSlot } : {}),
    creditsCharged: doc.creditsCharged ?? 0,
    createdAt: doc.createdAt,
    hasMedia: Boolean(doc.media?.kind),
    ...(doc.media?.notPersisted ? { mediaNotPersisted: true } : {}),
  }))
}
