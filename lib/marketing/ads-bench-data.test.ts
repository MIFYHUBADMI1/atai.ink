import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { mockListAdsKit, mockGetAvailableCredits, mockCapabilityAvailability, mockGetAdStrategy, mockReadPositioning } =
  vi.hoisted(() => ({
    mockListAdsKit: vi.fn(),
    mockGetAvailableCredits: vi.fn(),
    mockCapabilityAvailability: vi.fn(),
    mockGetAdStrategy: vi.fn(),
    mockReadPositioning: vi.fn(),
  }))

vi.mock("@/lib/marketing/studio/ads-kit", () => ({
  listAdsKit: mockListAdsKit,
  ADS_KIT_SLOTS: [
    { slot: "first-post", label: "First post", description: "", kind: "social", group: "posts", whereToPost: "", whatGoodLooksLike: "", channelIds: [] },
    { slot: "business-profile", label: "Business bio", description: "", kind: "copy", group: "posts", whereToPost: "", whatGoodLooksLike: "", channelIds: [] },
    { slot: "content-plan", label: "Two-week plan", description: "", kind: "timeline", group: "posts", whereToPost: "", whatGoodLooksLike: "", channelIds: [] },
    { slot: "customer-message", label: "Message customers", description: "", kind: "email", group: "posts", whereToPost: "", whatGoodLooksLike: "", channelIds: [] },
    { slot: "facebook-copy", label: "Facebook ad", description: "", kind: "copy", group: "ads", whereToPost: "", whatGoodLooksLike: "", channelIds: [] },
  ],
}))

vi.mock("@/lib/billing/credit-service", () => ({
  getAvailableCredits: mockGetAvailableCredits,
}))

vi.mock("@/lib/runtime/router/adapters/availability", () => ({
  capabilityAvailability: mockCapabilityAvailability,
}))

vi.mock("@/lib/marketing/ads/strategy", () => ({
  getAdStrategy: mockGetAdStrategy,
}))

vi.mock("@/lib/analysis/plan-sections", () => ({
  readMarketPositioningText: mockReadPositioning,
}))

import { getAdsBenchData } from "./ads-bench-data"

const USER = {
  id: "user_1",
  onboarding: { businessGoal: "Sell 100 weekend bundles" },
}

const PROJECT = {
  id: "proj_1",
  userId: "user_1",
  name: "Sweet Crust Bakery",
  specification: {
    targetUsers: ["Weekend families", "Office managers"],
  },
  deployment: { status: "success", productionUrl: "https://sweet-crust.example.com" },
} as unknown as Parameters<typeof getAdsBenchData>[0]["project"]

function slot(overrides: Record<string, unknown> = {}) {
  return {
    slot: "facebook-copy",
    label: "Facebook ad",
    description: "",
    kind: "copy",
    group: "ads",
    whereToPost: "",
    whatGoodLooksLike: "",
    channelIds: [],
    item: null,
    ...overrides,
  }
}

async function bench(overrides: Partial<Parameters<typeof getAdsBenchData>[0]> = {}) {
  return getAdsBenchData({
    userId: "user_1",
    projectId: "proj_1",
    user: USER,
    project: PROJECT,
    ...overrides,
  })
}

describe("getAdsBenchData", () => {
  beforeEach(() => {
    mockListAdsKit.mockReset()
    mockListAdsKit.mockResolvedValue([slot()])
    mockGetAvailableCredits.mockReset()
    mockGetAvailableCredits.mockResolvedValue(120)
    mockCapabilityAvailability.mockReset()
    mockCapabilityAvailability.mockReturnValue({
      "ai.text": { configured: true },
      "ai.image": { configured: true },
    })
    mockGetAdStrategy.mockReset()
    mockGetAdStrategy.mockResolvedValue(null)
    mockReadPositioning.mockReset()
    mockReadPositioning.mockReturnValue("A neighbourhood bakery that delivers before breakfast.")
  })

  it("suggests the free posts first and never a paid ad piece", async () => {
    const data = await bench()
    // WhatsApp is in the starter set, so the customer message comes with it.
    expect(data.guide.defaultSlots).toEqual([
      "first-post",
      "business-profile",
      "content-plan",
      "customer-message",
    ])
    expect(data.guide.defaultSlots).not.toContain("facebook-copy")
  })

  it("adds the customer message when the founder reaches people on email or WhatsApp", async () => {
    mockGetAdStrategy.mockResolvedValue({ channels: ["WhatsApp"], positioning: "", icp: "" })
    const data = await bench()
    expect(data.guide.defaultSlots).toContain("customer-message")
  })

  it("prefills the offer from the plan and says where it came from", async () => {
    const data = await bench()
    expect(data.guide.inputs.offer).toBe("A neighbourhood bakery that delivers before breakfast.")
    expect(data.guide.inputs.offerSource).toBe("your-plan")
    expect(data.guide.inputs.audience).toBe("Weekend families, Office managers")
    expect(data.guide.inputs.audienceSource).toBe("your-plan")
  })

  it("prefers the founder's own saved strategy over the plan's wording", async () => {
    mockGetAdStrategy.mockResolvedValue({
      channels: ["Facebook page"],
      positioning: "Oven-fresh bread delivered before breakfast.",
      icp: "Office managers ordering breakfast",
    })
    const data = await bench()
    expect(data.guide.inputs.offer).toBe("Oven-fresh bread delivered before breakfast.")
    expect(data.guide.inputs.offerSource).toBe("your-own-words")
    expect(data.guide.inputs.audience).toBe("Office managers ordering breakfast")
    expect(data.guide.inputs.audienceSource).toBe("your-own-words")
    expect(data.guide.channels[0].source).toBe("your-strategy")
  })

  it("keeps what the founder used last time and says so", async () => {
    mockListAdsKit.mockResolvedValue([
      slot({
        slot: "first-post",
        group: "posts",
        item: {
          id: "content_1",
          title: "Your first post",
          body: "Draft",
          kind: "social",
          creditsCharged: 4,
          createdAt: 50,
          input: { offer: "Saturday cake boxes", audience: "Office staff" },
        },
      }),
    ])
    const data = await bench()
    expect(data.guide.inputs.offer).toBe("Saturday cake boxes")
    expect(data.guide.inputs.offerSource).toBe("last-time")
    expect(data.guide.inputs.audience).toBe("Office staff")
    expect(data.guide.inputs.audienceSource).toBe("last-time")
  })

  it("renders an empty bench when the kit read fails, without losing the guide", async () => {
    mockListAdsKit.mockRejectedValue(new Error("mongo down"))
    const data = await bench()
    expect(data.slots.every((entry) => entry.item === null)).toBe(true)
    expect(data.guide.channels.length).toBeGreaterThan(0)
    expect(data.guide.inputs.offer).toBe("A neighbourhood bakery that delivers before breakfast.")
  })

  it("tells the founder to publish the site first when there is no live site", async () => {
    const data = await bench({
      project: { ...PROJECT, deployment: { status: "idle" } } as typeof PROJECT,
    })
    expect(data.guide.firstActions[0].id).toBe("site")
  })
})
