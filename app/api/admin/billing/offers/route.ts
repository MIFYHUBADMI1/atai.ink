import { z } from "zod"
import { requireAdmin } from "@/lib/auth/session"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import {
  PromotionalOfferDraftSchema,
  type PromotionalOffer,
} from "@/lib/billing/offers"
import {
  getPromotionalOffers,
  updatePromotionalOffers,
} from "@/lib/billing/runtime-config"
import { logger } from "@/lib/logging/logger"
import { cryptoId } from "@/lib/store/id"

const UpsertSchema = PromotionalOfferDraftSchema.extend({
  id: z.string().trim().min(1).max(80).optional(),
}).strict()

export async function GET() {
  try {
    await requireAdmin()
    const offers = await getPromotionalOffers()
    return ok({ offers })
  } catch (e) {
    return handleRouteError("api.admin.billing.offers.get", e)
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin()
    const parsed = UpsertSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Check the offer fields.", 422)
    }
    if (
      parsed.data.startsAt !== null &&
      parsed.data.endsAt !== null &&
      parsed.data.endsAt <= parsed.data.startsAt
    ) {
      return fail("VALIDATION", "The end date must be after the start date.", 422)
    }

    const existing = await getPromotionalOffers()
    const now = Date.now()
    const id = parsed.data.id ?? `offer_${cryptoId()}`
    const previous = existing.find((offer) => offer.id === id)
    const offer: PromotionalOffer = {
      ...parsed.data,
      id,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    const next = previous
      ? existing.map((item) => (item.id === id ? offer : item))
      : [...existing, offer]

    await updatePromotionalOffers(next)
    logger.info("api.admin.billing.offers", previous ? "offer updated" : "offer created", {
      adminId: admin.id,
      offerId: offer.id,
      status: offer.status,
      target: offer.target,
      bonusCredits: offer.bonusCredits,
    })
    return ok({ offer })
  } catch (e) {
    return handleRouteError("api.admin.billing.offers.post", e)
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin()
    const id = new URL(req.url).searchParams.get("id")?.trim()
    if (!id) return fail("VALIDATION", "An offer id is required.", 422)

    const existing = await getPromotionalOffers()
    const next = existing.filter((offer) => offer.id !== id)
    if (next.length === existing.length) {
      return fail("NOT_FOUND", "Offer not found.", 404)
    }

    await updatePromotionalOffers(next)
    logger.info("api.admin.billing.offers", "offer deleted", { adminId: admin.id, offerId: id })
    return ok({ deleted: id })
  } catch (e) {
    return handleRouteError("api.admin.billing.offers.delete", e)
  }
}
