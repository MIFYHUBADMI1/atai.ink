import { describe, expect, it } from "vitest"
import { adsKitBrief, adsKitSlotById, ADS_KIT_SLOTS, buildAdsKitContext, defaultBenchSlots } from "./ads-kit-content"
import { MARKET_CHANNELS, MARKET_CONTENT_KINDS, MARKET_ASPECT_RATIOS } from "./market-content"

/** The service caps briefs at 2000 chars — every composed bench brief must fit. */
const SERVICE_BRIEF_CAP = 2000

const MAXIMAL_INPUT = {
  projectName: "Sweet Crust Bakery".repeat(10),
  offer: "Weekend delivery bundle — six oven-fresh pastries delivered before breakfast, first delivery free. ".repeat(10),
  audience: "Families in Kampala who order breakfast online and care about freshness. ".repeat(6),
  description: "A neighbourhood bakery storefront with same-day delivery. ".repeat(6),
  positioning: "Position around the warm, local bakery that delivers before breakfast; oven-fresh without the queue. ".repeat(8),
  targetUsers: ["Weekend families", "Office managers", "Cafés", "Event planners", "Expats", "Extra user beyond cap"],
  siteUrl: "https://sweet-crust.example.com",
}

const BUDGET = 1100

describe("ADS_KIT_SLOTS", () => {
  it("has unique, well-formed slots with valid studio vocabulary", () => {
    const ids = ADS_KIT_SLOTS.map((slot) => slot.slot)
    expect(new Set(ids).size).toBe(ids.length)
    for (const slot of ADS_KIT_SLOTS) {
      expect(slot.title.trim()).not.toBe("")
      expect(slot.label.trim()).not.toBe("")
      expect(slot.description.trim()).not.toBe("")
      expect(MARKET_CONTENT_KINDS).toContain(slot.kind)
      if (slot.channel) expect(MARKET_CHANNELS).toContain(slot.channel)
      if (slot.aspectRatio) expect(MARKET_ASPECT_RATIOS).toContain(slot.aspectRatio)
    }
  })

  it("tells a first-timer where each piece goes and what good looks like", () => {
    for (const slot of ADS_KIT_SLOTS) {
      expect(slot.whereToPost.trim().length).toBeGreaterThan(20)
      expect(slot.whatGoodLooksLike.trim().length).toBeGreaterThan(20)
      expect(slot.group === "posts" || slot.group === "ads").toBe(true)
    }
  })

  it("covers free posts first, then the paid ad pieces", () => {
    expect(ADS_KIT_SLOTS.map((slot) => slot.slot)).toEqual([
      "first-post",
      "business-profile",
      "customer-message",
      "content-plan",
      "facebook-copy",
      "instagram-copy",
      "tiktok-copy",
      "image-square",
      "image-story",
    ])
    const free = ADS_KIT_SLOTS.filter((slot) => slot.group === "posts")
    const paid = ADS_KIT_SLOTS.filter((slot) => slot.group === "ads")
    expect(free.map((slot) => slot.slot)).toEqual(["first-post", "business-profile", "customer-message", "content-plan"])
    expect(paid.map((slot) => slot.slot)).toEqual([
      "facebook-copy",
      "instagram-copy",
      "tiktok-copy",
      "image-square",
      "image-story",
    ])
  })

  it("keeps the paid ad slots on the studio's platform vocabulary", () => {
    const copySlots = ADS_KIT_SLOTS.filter((slot) => slot.group === "ads" && slot.kind === "copy")
    const imageSlots = ADS_KIT_SLOTS.filter((slot) => slot.kind === "image")
    expect(copySlots.length).toBe(3)
    expect(imageSlots.map((slot) => slot.aspectRatio)).toEqual(["1:1", "9:16"])
  })

  it("resolves slots by id and rejects unknown ones", () => {
    expect(adsKitSlotById("tiktok-copy")?.label).toBe("TikTok ad")
    expect(adsKitSlotById("first-post")?.group).toBe("posts")
    expect(adsKitSlotById("nope")).toBeNull()
  })
})

describe("defaultBenchSlots", () => {
  it("starts a beginner on the free posts, never on paid ad pieces", () => {
    const slots = defaultBenchSlots(["facebook", "google-business"])
    expect(slots).toEqual(["first-post", "business-profile", "content-plan"])
    expect(slots).not.toContain("facebook-copy")
    expect(slots).not.toContain("image-square")
  })

  it("adds the customer message when they already talk to people on email or WhatsApp", () => {
    expect(defaultBenchSlots(["whatsapp"])).toContain("customer-message")
    expect(defaultBenchSlots(["email"])).toContain("customer-message")
    expect(defaultBenchSlots(["facebook"])).not.toContain("customer-message")
  })

  it("only ever returns slots that exist", () => {
    for (const slots of ADS_KIT_SLOTS.map((slot) => defaultBenchSlots([slot.channelIds[0] ?? "facebook"]))) {
      for (const id of slots) expect(ADS_KIT_SLOTS.some((slot) => slot.slot === id)).toBe(true)
    }
  })
})

describe("buildAdsKitContext", () => {
  it("always keeps the app name, the founder's offer and the URL line", () => {
    const context = buildAdsKitContext(MAXIMAL_INPUT)
    expect(context).toContain("App: Sweet Crust Bakery")
    expect(context).toContain("What is being advertised (the founder's own words):")
    expect(context).toContain("Weekend delivery bundle")
    expect(context).toContain("Live URL: https://sweet-crust.example.com")
  })

  it("states honestly that there is no URL yet", () => {
    const context = buildAdsKitContext({ projectName: "Tiny App", offer: "Free trial month" })
    expect(context).toContain("Live URL: none yet")
    expect(context).toContain("Free trial month")
  })

  it("stays within the context budget even with the most verbose input", () => {
    const context = buildAdsKitContext(MAXIMAL_INPUT)
    expect(context.length).toBeLessThanOrEqual(BUDGET)
  })

  it("drops plan backing facts before the founder's own words", () => {
    const context = buildAdsKitContext(MAXIMAL_INPUT)
    // With a 600-char offer, the founder-typed audience survives (shrunk if
    // needed) and the least important backing lines give way first.
    expect(context).toContain("Intended audience:")
    expect(context).not.toContain("Target users:")
    expect(context).not.toContain("Positioning from the plan:")
  })

  it("keeps everything when the input is small", () => {
    const context = buildAdsKitContext({
      projectName: "Tea Kiosk",
      offer: "Ten-bag breakfast tea bundle",
      audience: "Morning commuters",
      description: "A tea subscription kiosk",
      positioning: "The freshest cup on the platform",
      targetUsers: ["Commuters", "Offices"],
      siteUrl: "https://tea.example",
    })
    expect(context).toContain("Intended audience: Morning commuters")
    expect(context).toContain("What it is: A tea subscription kiosk")
    expect(context).toContain("Positioning from the plan: The freshest cup on the platform")
    expect(context).toContain("Target users: Commuters; Offices")
  })

  it("carries the founder's onboarding goal into the context when it fits", () => {
    const context = buildAdsKitContext({
      projectName: "Tea Kiosk",
      offer: "Ten-bag breakfast tea bundle",
      ownerGoals: { businessGoal: "Sell 100 subscriptions", destination: "A shop that runs itself" },
    })
    expect(context).toContain("Founder's goal: Sell 100 subscriptions — aiming for: A shop that runs itself")
  })

  it("drops the goal before the founder's own audience when the budget is tight", () => {
    const context = buildAdsKitContext({
      ...MAXIMAL_INPUT,
      ownerGoals: { businessGoal: "Grow revenue with weekend bundles" },
    })
    expect(context).not.toContain("Founder's goal:")
    expect(context).toContain("Intended audience:")
    expect(context.length).toBeLessThanOrEqual(BUDGET)
  })

  it("ignores goals that are empty or missing", () => {
    const context = buildAdsKitContext({ projectName: "Tea Kiosk", offer: "Ten-bag breakfast tea bundle" })
    expect(context).not.toContain("Founder's goal:")
    const empty = buildAdsKitContext({
      projectName: "Tea Kiosk",
      offer: "Ten-bag breakfast tea bundle",
      ownerGoals: { businessGoal: "  ", revenueTarget: "$10k" },
    })
    expect(empty).not.toContain("Founder's goal:")
  })
})

describe("adsKitBrief", () => {
  it("defines an ask for every slot, so no piece can fail to brief", () => {
    const context = buildAdsKitContext({ projectName: "Tea Kiosk", offer: "Ten-bag breakfast tea bundle" })
    for (const slot of ADS_KIT_SLOTS) {
      expect(() => adsKitBrief(slot, context)).not.toThrow()
    }
  })

  it("fits the service brief cap for every slot with the most verbose context", () => {
    const context = buildAdsKitContext(MAXIMAL_INPUT)
    for (const slot of ADS_KIT_SLOTS) {
      const brief = adsKitBrief(slot, context)
      expect(brief.length).toBeLessThanOrEqual(SERVICE_BRIEF_CAP)
      expect(brief).toContain("App: Sweet Crust Bakery")
    }
  })

  it("gives copy slots the anti-fabrication footer and image slots a visual context line", () => {
    const context = buildAdsKitContext({ projectName: "Tea Kiosk", offer: "Ten-bag breakfast tea bundle" })
    const copySlot = adsKitSlotById("facebook-copy")!
    expect(adsKitBrief(copySlot, context)).toContain("do not invent facts that are not here")
    const imageSlot = adsKitSlotById("image-square")!
    expect(adsKitBrief(imageSlot, context)).toContain("Product and audience context:")
    expect(adsKitBrief(imageSlot, context)).not.toContain("do not invent facts")
  })

  it("refuses a slot with no defined ask", () => {
    expect(() => adsKitBrief({ ...ADS_KIT_SLOTS[0], slot: "mystery" }, "ctx")).toThrow(/mystery/)
  })
})
