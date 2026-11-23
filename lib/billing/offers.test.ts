import { describe, expect, it } from "vitest"
import {
  offerAppliesToProduct,
  offerIsLive,
  publicPromotionalOffers,
  resolvePromotionalOffer,
  type PromotionalOffer,
} from "./offers"

const NOW = 1_800_000_000_000

function offer(overrides: Partial<PromotionalOffer> = {}): PromotionalOffer {
  return {
    id: "offer_1",
    name: "Launch bonus",
    description: "Extra credits",
    status: "active",
    target: "all",
    productIds: [],
    bonusCredits: 1_000,
    startsAt: null,
    endsAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe("promotional offers", () => {
  it("is live only while active and inside its window", () => {
    expect(offerIsLive(offer(), NOW)).toBe(true)
    expect(offerIsLive(offer({ status: "draft" }), NOW)).toBe(false)
    expect(offerIsLive(offer({ startsAt: NOW + 1 }), NOW)).toBe(false)
    expect(offerIsLive(offer({ endsAt: NOW }), NOW)).toBe(false)
    expect(offerIsLive(offer({ startsAt: NOW - 1, endsAt: NOW + 1 }), NOW)).toBe(true)
  })

  it("matches its target and optional product list", () => {
    expect(offerAppliesToProduct(offer(), "subscription", "growth")).toBe(true)
    expect(offerAppliesToProduct(offer({ target: "subscription" }), "credit_pack", "perm_200k")).toBe(false)
    expect(offerAppliesToProduct(offer({ productIds: ["growth"] }), "subscription", "growth")).toBe(true)
    expect(offerAppliesToProduct(offer({ productIds: ["growth"] }), "subscription", "starter")).toBe(false)
  })

  it("chooses the highest live matching bonus", () => {
    const offers = [
      offer({ id: "small", bonusCredits: 500 }),
      offer({ id: "large", bonusCredits: 2_000, updatedAt: NOW - 1 }),
      offer({ id: "wrong_target", target: "credit_pack", bonusCredits: 9_000 }),
    ]
    expect(resolvePromotionalOffer(offers, "subscription", "growth", NOW)?.id).toBe("large")
  })

  it("projects only live offers for public display", () => {
    const offers = [
      offer({ id: "live", bonusCredits: 2_000 }),
      offer({ id: "draft", status: "draft", bonusCredits: 9_000 }),
      offer({ id: "expired", endsAt: NOW - 1, bonusCredits: 8_000 }),
    ]
    expect(publicPromotionalOffers(offers, NOW)).toEqual([
      {
        id: "live",
        name: "Launch bonus",
        description: "Extra credits",
        target: "all",
        productIds: [],
        bonusCredits: 2_000,
        startsAt: null,
        endsAt: null,
      },
    ])
  })
})
