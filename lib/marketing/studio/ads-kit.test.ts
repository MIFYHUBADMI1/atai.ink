import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { mockGenerateMarketContent, mockContentFind, mockReadCombinedMarketingPlan } = vi.hoisted(() => ({
  mockGenerateMarketContent: vi.fn(),
  mockContentFind: vi.fn(),
  mockReadCombinedMarketingPlan: vi.fn(),
}))

vi.mock("./market-service", () => ({
  generateMarketContent: mockGenerateMarketContent,
}))

vi.mock("@/lib/analysis/plan-sections", () => ({
  readCombinedMarketingPlan: mockReadCombinedMarketingPlan,
}))

vi.mock("@/lib/db/collections", () => ({
  contentItemsCol: async () => ({
    find: mockContentFind,
  }),
}))

import { generateAdsKitSlot, listAdsKit } from "./ads-kit"

const PROJECT = {
  id: "proj_1",
  userId: "user_1",
  name: "Sweet Crust Bakery",
  specification: {
    description: "A neighbourhood bakery storefront with same-day delivery.",
    targetUsers: ["Weekend families", "Office managers"],
  },
  deployment: { status: "success", productionUrl: "https://sweet-crust.example.com" },
} as Parameters<typeof generateAdsKitSlot>[0]["project"]

describe("generateAdsKitSlot", () => {
  beforeEach(() => {
    mockGenerateMarketContent.mockReset()
    mockGenerateMarketContent.mockResolvedValue({ id: "content_1", creditsCharged: 4, kind: "copy" })
    mockReadCombinedMarketingPlan.mockReset()
    mockReadCombinedMarketingPlan.mockReturnValue("Position around the warm, local bakery that delivers.")
  })

  it("stamps the slot and persists the founder's raw inputs for prefill", async () => {
    await generateAdsKitSlot({
      userId: "user_1",
      projectId: "proj_1",
      slotId: "instagram-copy",
      offer: "Weekend delivery bundle — six oven-fresh pastries.",
      audience: "Families in Kampala",
      project: PROJECT,
      ownerGoals: { businessGoal: "Sell 100 weekend bundles" },
    })

    expect(mockGenerateMarketContent).toHaveBeenCalledTimes(1)
    const input = mockGenerateMarketContent.mock.calls[0][0] as Record<string, unknown>
    expect(input.kit).toBe("ads")
    expect(input.kitSlot).toBe("instagram-copy")
    expect(input.kind).toBe("copy")
    expect(input.channel).toBe("instagram")
    expect(input.kitInput).toEqual({ offer: "Weekend delivery bundle — six oven-fresh pastries.", audience: "Families in Kampala" })
    expect(input.audience).toBe("Families in Kampala")
  })

  it("steers the brief with the owner's goals", async () => {
    await generateAdsKitSlot({
      userId: "user_1",
      projectId: "proj_1",
      slotId: "facebook-copy",
      offer: "Weekend delivery bundle.",
      project: PROJECT,
      ownerGoals: { businessGoal: "Sell 100 weekend bundles", destination: "A shop that runs itself" },
    })

    const input = mockGenerateMarketContent.mock.calls[0][0] as { brief: string }
    expect(input.brief).toContain("Founder's goal: Sell 100 weekend bundles — aiming for: A shop that runs itself")
    expect(input.brief).toContain("Live URL: https://sweet-crust.example.com")
    expect(input.kitInput).toEqual({ offer: "Weekend delivery bundle." })
  })

  it("sets the image slots' aspect ratio and quality", async () => {
    await generateAdsKitSlot({
      userId: "user_1",
      projectId: "proj_1",
      slotId: "image-story",
      offer: "Weekend delivery bundle.",
      project: PROJECT,
    })

    const input = mockGenerateMarketContent.mock.calls[0][0] as Record<string, unknown>
    expect(input.kind).toBe("image")
    expect(input.aspectRatio).toBe("9:16")
    expect(input.quality).toBe("auto")
    expect(input.kitInput).toEqual({ offer: "Weekend delivery bundle." })
  })

  it("rejects unknown slots and empty offers", async () => {
    await expect(
      generateAdsKitSlot({ userId: "user_1", projectId: "proj_1", slotId: "nope", offer: "x", project: PROJECT }),
    ).rejects.toThrow()
    await expect(
      generateAdsKitSlot({ userId: "user_1", projectId: "proj_1", slotId: "facebook-copy", offer: "   ", project: PROJECT }),
    ).rejects.toThrow()
    expect(mockGenerateMarketContent).not.toHaveBeenCalled()
  })
})

describe("listAdsKit", () => {
  function doc(overrides: Record<string, unknown>) {
    return {
      id: `content_${Math.random().toString(36).slice(2, 8)}`,
      title: "Facebook ad copy",
      body: "Draft body",
      assetKind: "copy",
      creditsCharged: 4,
      createdAt: 1,
      kit: "ads",
      ...overrides,
    }
  }

  it("fronts the newest draft per slot and surfaces raw inputs and media presence", async () => {
    const docs = [
      doc({ kitSlot: "facebook-copy", kitInput: { offer: "Bundle", audience: "Families" }, createdAt: 30 }),
      doc({ kitSlot: "facebook-copy", kitInput: { offer: "Old offer" }, createdAt: 10 }),
      doc({ kitSlot: "image-square", assetKind: "image", media: { kind: "image" }, createdAt: 20 }),
      doc({ kitSlot: "image-story", assetKind: "image", media: { kind: "image", notPersisted: true }, createdAt: 15 }),
    ]
    mockContentFind.mockReturnValue({
      sort: () => ({
        limit: () => ({
          toArray: async () => docs,
        }),
      }),
    })

    const slots = await listAdsKit("proj_1")
    expect(slots.map((slot) => slot.slot)).toEqual([
      "facebook-copy",
      "instagram-copy",
      "tiktok-copy",
      "image-square",
      "image-story",
    ])

    const facebook = slots[0].item!
    expect(facebook.id).toBe(docs[0].id)
    expect(facebook.input).toEqual({ offer: "Bundle", audience: "Families" })
    expect(facebook.hasMedia).toBe(false)

    const square = slots[3].item!
    expect(square.hasMedia).toBe(true)
    expect(square.media?.kind).toBe("image")
    expect(square.media?.dataUrl).toBeUndefined()

    const story = slots[4].item!
    expect(story.hasMedia).toBe(true)
    expect(story.mediaNotPersisted).toBe(true)

    expect(slots[1].item).toBeNull()
    expect(slots[2].item).toBeNull()
  })

  it("renders empty slots when nothing is stored yet", async () => {
    mockContentFind.mockReturnValue({
      sort: () => ({
        limit: () => ({
          toArray: async () => [],
        }),
      }),
    })
    const slots = await listAdsKit("proj_1")
    expect(slots).toHaveLength(5)
    expect(slots.every((slot) => slot.item === null)).toBe(true)
  })
})
