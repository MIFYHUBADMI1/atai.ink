import { z } from "zod"

/**
 * Promotional offers attached to a checkout.
 *
 * An offer adds credits on top of a purchase; it never changes the catalog
 * price. Offers live in the billing settings document so an admin can create,
 * pause and expire a campaign without a deploy.
 */

export const PROMOTIONAL_OFFER_TARGETS = ["all", "credit_pack", "subscription"] as const
export type PromotionalOfferTarget = (typeof PROMOTIONAL_OFFER_TARGETS)[number]

export const PROMOTIONAL_OFFER_STATUSES = ["draft", "active", "paused", "ended"] as const
export type PromotionalOfferStatus = (typeof PROMOTIONAL_OFFER_STATUSES)[number]

const nullableTimestamp = z.number().int().min(0).nullable()

export const PromotionalOfferDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(600).default(""),
    status: z.enum(PROMOTIONAL_OFFER_STATUSES).default("draft"),
    target: z.enum(PROMOTIONAL_OFFER_TARGETS).default("all"),
    /** Empty means every product in the target category. */
    productIds: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
    bonusCredits: z.number().int().min(1).max(10_000_000),
    startsAt: nullableTimestamp.default(null),
    endsAt: nullableTimestamp.default(null),
  })
  .strict()

export const PromotionalOfferSchema = PromotionalOfferDraftSchema.extend({
  id: z.string().trim().min(1).max(80),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
}).strict()

export type PromotionalOfferDraft = z.infer<typeof PromotionalOfferDraftSchema>
export type PromotionalOffer = z.infer<typeof PromotionalOfferSchema>

export const DEFAULT_PROMOTIONAL_OFFERS: PromotionalOffer[] = []

export function offerIsLive(offer: PromotionalOffer, now = Date.now()): boolean {
  if (offer.status !== "active") return false
  if (offer.startsAt !== null && now < offer.startsAt) return false
  if (offer.endsAt !== null && now >= offer.endsAt) return false
  return true
}

export function offerAppliesToProduct(
  offer: PromotionalOffer,
  target: Exclude<PromotionalOfferTarget, "all">,
  productId: string,
): boolean {
  if (offer.target !== "all" && offer.target !== target) return false
  return offer.productIds.length === 0 || offer.productIds.includes(productId)
}

/** The best live offer for a checkout. Highest bonus wins; ties go to the
 * most recently edited offer so an admin can promote a replacement. */
export function resolvePromotionalOffer(
  offers: readonly PromotionalOffer[],
  target: Exclude<PromotionalOfferTarget, "all">,
  productId: string,
  now = Date.now(),
): PromotionalOffer | undefined {
  return offers
    .filter((offer) => offerIsLive(offer, now) && offerAppliesToProduct(offer, target, productId))
    .sort((a, b) => b.bonusCredits - a.bonusCredits || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))[0]
}

export interface PublicPromotionalOffer {
  id: string
  name: string
  description: string
  target: PromotionalOfferTarget
  productIds: string[]
  bonusCredits: number
  startsAt: number | null
  endsAt: number | null
}

/** Safe projection for marketing pages. No status, creator or audit fields. */
export function publicPromotionalOffers(
  offers: readonly PromotionalOffer[],
  now = Date.now(),
): PublicPromotionalOffer[] {
  return offers
    .filter((offer) => offerIsLive(offer, now))
    .sort((a, b) => b.bonusCredits - a.bonusCredits || a.name.localeCompare(b.name))
    .map((offer) => ({
      id: offer.id,
      name: offer.name,
      description: offer.description,
      target: offer.target,
      productIds: [...offer.productIds],
      bonusCredits: offer.bonusCredits,
      startsAt: offer.startsAt,
      endsAt: offer.endsAt,
    }))
}
