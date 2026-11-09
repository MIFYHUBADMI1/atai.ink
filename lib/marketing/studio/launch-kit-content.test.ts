import { describe, expect, it } from "vitest"
import {
  buildLaunchKitContext,
  launchKitBrief,
  launchKitSlotById,
  LAUNCH_KIT_SLOTS,
} from "./launch-kit-content"
import { MARKET_CHANNELS, MARKET_CONTENT_KINDS, MARKET_LENGTHS, MARKET_TONES } from "./market-content"

/** The service caps briefs at 2000 chars — every composed kit brief must fit. */
const SERVICE_BRIEF_CAP = 2000

const MAXIMAL_CONTEXT_INPUT = {
  projectName: "Sweet Crust Bakery".repeat(10),
  description: "A neighbourhood bakery storefront. ".repeat(20),
  idea: "Fresh bread and pastries with same-day delivery. ".repeat(20),
  marketingPlan:
    "Position around the warm, local bakery that delivers before breakfast. Value proposition: oven-fresh without the queue. Channels: WhatsApp status, Instagram reels, weekend market stalls. Pricing anchor: bundle of six. ".repeat(12),
  targetUsers: ["Weekend families in Kampala", "Office managers ordering breakfast", "Cafés needing wholesale", "Event planners", "Expats missing home bakes", "Extra user beyond the cap"],
  siteUrl: "https://sweet-crust.example.com",
  goals: {
    businessGoal: "Run the bakery as a real business with steady morning orders".repeat(3),
    revenueTarget: "UGX 12m per month".repeat(3),
    destination: "Own storefront plus delivery app".repeat(3),
  },
}

describe("LAUNCH_KIT_SLOTS", () => {
  it("has unique, well-formed slots with valid studio vocabulary", () => {
    const ids = LAUNCH_KIT_SLOTS.map((slot) => slot.slot)
    expect(new Set(ids).size).toBe(ids.length)
    for (const slot of LAUNCH_KIT_SLOTS) {
      expect(slot.title.trim()).not.toBe("")
      expect(slot.label.trim()).not.toBe("")
      expect(slot.description.trim()).not.toBe("")
      expect(MARKET_CONTENT_KINDS).toContain(slot.kind)
      if (slot.tone) expect(MARKET_TONES).toContain(slot.tone)
      if (slot.channel) expect(MARKET_CHANNELS).toContain(slot.channel)
      if (slot.length) expect(MARKET_LENGTHS).toContain(slot.length)
    }
  })

  it("covers the whole launch package", () => {
    const slots = LAUNCH_KIT_SLOTS.map((slot) => slot.slot)
    expect(slots).toEqual([
      "announcement-x",
      "announcement-linkedin",
      "announcement-community",
      "product-hunt",
      "announcement-email",
      "content-calendar",
      "seo-share",
    ])
  })

  it("resolves slots by id and rejects unknown ones", () => {
    expect(launchKitSlotById("announcement-email")?.title).toBe("Announcement email")
    expect(launchKitSlotById("nope")).toBeNull()
  })
})

describe("buildLaunchKitContext", () => {
  it("keeps the short, high-value facts and the live URL", () => {
    const context = buildLaunchKitContext(MAXIMAL_CONTEXT_INPUT)
    expect(context).toContain("App: Sweet Crust Bakery")
    expect(context).toContain("Live URL: https://sweet-crust.example.com")
    expect(context).toContain("Business goal: Run the bakery")
    expect(context).toContain("Target users: Weekend families")
  })

  it("states honestly that there is no URL yet", () => {
    const context = buildLaunchKitContext({ projectName: "Tiny App" })
    expect(context).toContain("Live URL: none yet")
    expect(context).toContain("App: Tiny App")
  })

  it("caps the marketing-plan slice so the whole context stays bounded", () => {
    const context = buildLaunchKitContext(MAXIMAL_CONTEXT_INPUT)
    // The composed briefs must survive the service cap with the ask still
    // attached — so the context alone must stay far below 2000.
    expect(context.length).toBeLessThan(1500)
    // Truncation is honest (ellipsis), not silent data loss in the middle.
    expect(context).toContain("…")
  })
})

describe("launchKitBrief", () => {
  it("fits the service brief cap for every slot with the most verbose context", () => {
    const context = buildLaunchKitContext(MAXIMAL_CONTEXT_INPUT)
    for (const slot of LAUNCH_KIT_SLOTS) {
      const brief = launchKitBrief(slot, context)
      expect(brief.length).toBeLessThanOrEqual(SERVICE_BRIEF_CAP)
      expect(brief).toContain("Context you must draw from — do not invent facts that are not here")
      expect(brief).toContain("App: Sweet Crust Bakery")
    }
  })

  it("pairs each slot's ask with the shared context", () => {
    const slot = launchKitSlotById("announcement-email")
    expect(slot).not.toBeNull()
    const brief = launchKitBrief(slot as NonNullable<typeof slot>, buildLaunchKitContext({ projectName: "Tea Kiosk" }))
    expect(brief).toContain("subject line")
    expect(brief).toContain("App: Tea Kiosk")
  })

  it("refuses a slot with no defined ask", () => {
    expect(() => launchKitBrief({ ...LAUNCH_KIT_SLOTS[0], slot: "mystery" }, "ctx")).toThrow(/mystery/)
  })
})
