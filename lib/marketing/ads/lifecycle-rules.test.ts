import { describe, expect, it } from "vitest"
import { canTransitionAdRequest } from "@/lib/types/ads"
import { normalizeProposalDraft, proposalIsExpired } from "./lifecycle-rules"
import { normalizePromotionUrl } from "./requests"

describe("canTransitionAdRequest", () => {
  it("allows the paid quotation path and blocks skipping payment", () => {
    expect(canTransitionAdRequest("submitted", "under_review")).toBe(true)
    expect(canTransitionAdRequest("under_review", "awaiting_approval")).toBe(true)
    expect(canTransitionAdRequest("awaiting_approval", "awaiting_payment")).toBe(true)
    expect(canTransitionAdRequest("awaiting_payment", "approved")).toBe(true)
    expect(canTransitionAdRequest("awaiting_approval", "approved")).toBe(false)
    expect(canTransitionAdRequest("submitted", "approved")).toBe(false)
  })
})

describe("normalizeProposalDraft", () => {
  it("requires a title and a credits price", () => {
    expect(() => normalizeProposalDraft({ title: "  ", creditsPrice: 10 })).toThrow(/title and a price/)
    expect(() => normalizeProposalDraft({ title: "Starter", creditsPrice: 0 })).toThrow(/title and a price/)
  })

  it("snapshots a valid quotation without inventing guaranteed reach", () => {
    const draft = normalizeProposalDraft({
      title: " Growth promo ",
      creditsPrice: 4000,
      estimatedImpressionsMin: 3000,
      estimatedImpressionsMax: 10000,
      platforms: ["Instagram", "Instagram", ""],
    })
    expect(draft.title).toBe("Growth promo")
    expect(draft.creditsPrice).toBe(4000)
    expect(draft.platforms).toEqual(["Instagram"])
    expect(draft.estimateNote.toLowerCase()).toContain("not guaranteed")
  })
})

describe("proposalIsExpired", () => {
  it("treats missing expiry as still valid", () => {
    expect(proposalIsExpired({}, 100)).toBe(false)
    expect(proposalIsExpired({ expiresAt: 50 }, 100)).toBe(true)
    expect(proposalIsExpired({ expiresAt: 150 }, 100)).toBe(false)
  })
})

describe("normalizePromotionUrl", () => {
  it("normalizes https URLs and rejects credentials", () => {
    expect(normalizePromotionUrl("example.com")).toBe("https://example.com")
    expect(normalizePromotionUrl("https://user:pass@example.com")).toBeNull()
    expect(normalizePromotionUrl("javascript:alert(1)")).toBeNull()
  })
})
