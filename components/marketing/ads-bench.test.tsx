import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("@/lib/client/api", () => ({
  postNdjson: vi.fn(),
}))

const { AdsBench } = await import("./ads-bench")
const { BENCH_STEPS } = await import("@/lib/marketing/ads/beginner-guide")

const READY = { textReady: true, imageReady: true }

function slot(overrides: Record<string, unknown> = {}) {
  return {
    slot: "facebook-copy",
    label: "Facebook ad",
    description: "Primary text and headline options for Facebook.",
    kind: "copy",
    group: "ads",
    whereToPost: "Facebook Ads Manager → Create ad → paste the primary text.",
    whatGoodLooksLike: "One clear offer and one call to action.",
    channelIds: ["facebook"],
    item: null,
    ...overrides,
  }
}

function postSlot(overrides: Record<string, unknown> = {}) {
  return slot({
    slot: "first-post",
    label: "First post",
    description: "One post you can publish today.",
    kind: "social",
    group: "posts",
    whereToPost: "Facebook → your business page → Create post → paste the text.",
    whatGoodLooksLike: "It says what you sell and one clear thing to do next.",
    channelIds: ["facebook", "instagram"],
    ...overrides,
  })
}

const GUIDE = {
  steps: BENCH_STEPS,
  channels: [
    {
      id: "facebook" as const,
      label: "Facebook page",
      whatItIs: "A public page for your business.",
      whatToPost: "One post a week.",
      whereToPost: "Facebook → your business page → Create post.",
      effort: "low" as const,
      cost: "free" as const,
      why: "You chose Facebook page in your advertising strategy.",
      source: "your-strategy" as const,
    },
  ],
  others: [{ id: "tiktok" as const, label: "TikTok", why: "Only worth it if you can post video several times a week." }],
  firstActions: [
    { id: "page", title: "Create or claim your business page", detail: "One page, one place people can find you.", kind: "do" as const },
  ],
  inputs: {
    offer: "Weekend delivery bundle — six oven-fresh pastries.",
    audience: "Families in Kampala",
    offerSource: "your-plan" as const,
    audienceSource: "your-plan" as const,
  },
  defaultSlots: ["first-post", "business-profile", "content-plan"],
}

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(AdsBench, {
      projectId: "proj_1",
      slots: [],
      creditsAvailable: 120,
      ...READY,
      guide: GUIDE,
      ...props,
    }),
  )

describe("AdsBench — the founder-facing ads bench", () => {
  it("starts empty and asks for the offer before anything can be drafted", () => {
    const html = render({
      slots: [postSlot(), slot()],
      guide: { ...GUIDE, inputs: { offer: "", audience: "", offerSource: "none", audienceSource: "none" } },
    })
    expect(html).toContain("Describe the offer first")
    expect(html).toContain("Draft 3 pieces")
  })

  it("pre-selects the free posts and leaves the paid ad pieces alone", () => {
    const html = render({ slots: [postSlot(), slot()] })
    expect(html).toMatch(/aria-checked="true"[^>]*>[\s\S]{0,300}?First post/)
    expect(html).toMatch(/aria-checked="false"[^>]*>[\s\S]{0,300}?Facebook ad/)
  })

  it("prefills the offer and audience the founder generated with", () => {
    const html = render({
      slots: [slot()],
      guide: {
        ...GUIDE,
        inputs: {
          offer: "Weekend delivery bundle — six oven-fresh pastries.",
          audience: "Families in Kampala",
          offerSource: "last-time",
          audienceSource: "last-time",
        },
      },
    })
    expect(html).toContain("Weekend delivery bundle — six oven-fresh pastries.")
    expect(html).toContain("Families in Kampala")
    expect(html).toContain("We kept what you used here last time.")
  })

  it("says where a prefilled value came from instead of silently filling the field", () => {
    const html = render({ slots: [slot()] })
    expect(html).toContain("Prefilled from your plan.")
  })

  it("walks a beginner through the three steps and the first week", () => {
    const html = render({ slots: [slot()] })
    expect(html).toContain("Say what you are promoting")
    expect(html).toContain("Copy it and post it yourself")
    expect(html).toContain("Your first week")
    expect(html).toContain("Create or claim your business page")
  })

  it("explains where their customers might already be, and why", () => {
    const html = render({ slots: [slot()] })
    expect(html).toContain("Where your customers might already be")
    expect(html).toContain("Facebook page")
    expect(html).toContain("You chose Facebook page in your advertising strategy.")
    expect(html).toContain("Only worth it if you can post video several times a week.")
  })

  it("separates free posts from the paid ad pieces", () => {
    const html = render({ slots: [postSlot(), slot()] })
    expect(html).toContain("Publish for free — no ad budget")
    expect(html).toContain("Paid ads — need an ad account and a budget")
  })

  it("shows a stored image slot loading its media instead of a dead placeholder", () => {
    const html = render({
      slots: [
        slot({
          slot: "image-square",
          label: "Creative · square",
          kind: "image",
          item: { id: "content_sq1", title: "Ad creative · square", body: "prompt text", kind: "image", creditsCharged: 40, createdAt: 1, hasMedia: true },
        }),
      ],
    })
    expect(html).toContain("Loading your saved creative…")
  })

  it("renders a fresh creative with an inline image and a real download button", () => {
    const html = render({
      slots: [
        slot({
          slot: "image-square",
          label: "Creative · square",
          kind: "image",
          item: {
            id: "content_sq2",
            title: "Ad creative · square",
            body: "prompt text",
            kind: "image",
            creditsCharged: 40,
            createdAt: 1,
            media: { kind: "image", dataUrl: "data:image/webp;base64,QUJD" },
            hasMedia: true,
          },
        }),
      ],
    })
    expect(html).toContain('src="data:image/webp;base64,QUJD"')
    expect(html).toContain("Download image")
  })

  it("is honest when the creative was too large to persist", () => {
    const html = render({
      slots: [
        slot({
          slot: "image-story",
          label: "Creative · story",
          kind: "image",
          item: {
            id: "content_st1",
            title: "Ad creative · story",
            body: "prompt text",
            kind: "image",
            creditsCharged: 40,
            createdAt: 1,
            media: { kind: "image", notPersisted: true },
            hasMedia: false,
          },
        }),
      ],
    })
    expect(html).toContain("too large to store")
    expect(html).not.toContain("Download image")
  })

  it("tells the founder exactly where to paste each draft", () => {
    const html = render({ slots: [slot()] })
    expect(html).toContain("Where to post it")
    expect(html).toContain("Facebook Ads Manager → Create ad → paste the primary text.")
    expect(html).toContain("What good looks like")
    expect(html).toContain("One clear offer and one call to action.")
  })

  it("deep-links each draft into the library item, not the studio homepage", () => {
    const html = render({
      slots: [slot({ item: { id: "content_fb9", title: "Facebook ad copy", body: "Copy body", kind: "copy", creditsCharged: 4, createdAt: 1 } })],
    })
    expect(html).toContain("/project/proj_1/studio?tab=library&amp;item=content_fb9")
  })

  it("keeps the honesty line about who places the ads", () => {
    const html = render({ slots: [slot()] })
    expect(html).toContain("you copy it into your ad platforms yourself")
    expect(html).toContain("Atai doesn&#x27;t place, run, or manage ads")
  })
})
