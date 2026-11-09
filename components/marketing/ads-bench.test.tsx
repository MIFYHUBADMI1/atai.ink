import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("@/lib/client/api", () => ({
  postNdjson: vi.fn(),
}))

const { AdsBench } = await import("./ads-bench")

const READY = { textReady: true, imageReady: true }

function slot(overrides: Record<string, unknown> = {}) {
  return {
    slot: "facebook-copy",
    label: "Facebook ad",
    description: "Primary text and headline options for Facebook.",
    kind: "copy",
    item: null,
    ...overrides,
  }
}

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(AdsBench, {
      projectId: "proj_1",
      slots: [],
      creditsAvailable: 120,
      ...READY,
      initialInput: null,
      ...props,
    }),
  )

describe("AdsBench — the founder-facing ads bench", () => {
  it("starts empty and asks for the offer before anything can be drafted", () => {
    const html = render({ slots: [slot()] })
    expect(html).toContain("Describe the offer first")
    expect(html).toContain("Draft 1 piece")
  })

  it("prefills the last offer and audience the founder generated with", () => {
    const html = render({
      slots: [slot()],
      initialInput: { offer: "Weekend delivery bundle — six oven-fresh pastries.", audience: "Families in Kampala" },
    })
    expect(html).toContain("Weekend delivery bundle — six oven-fresh pastries.")
    expect(html).toContain("Families in Kampala")
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
