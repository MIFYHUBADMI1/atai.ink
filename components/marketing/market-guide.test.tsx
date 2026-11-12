import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MarketGuide } from "@/components/marketing/market-guide"

describe("MarketGuide rendering", () => {
  it("renders the expanded guide deterministically on first paint with honest block copy", () => {
    const html = renderToStaticMarkup(<MarketGuide />)
    expect(html).toContain("Show me around (4 stops)")
    for (const block of ["Launch Kit", "Growth overview", "AI Marketing Studio", "SEO visibility"]) {
      expect(html).toContain(block)
    }
    // The trust contract is spelled out, not implied.
    expect(html).toContain("Nothing here posts, sends, or publishes")
    expect(html).toContain("runtime requests are API calls, not visitors")
    expect(html).toContain("AI-generated and unverified")
    expect(html).toContain("A good first session")
  })

  it("does not render the tour card before interaction", () => {
    const html = renderToStaticMarkup(<MarketGuide />)
    // The tour card (and its aria-live status) only appear after the founder
    // clicks "Show me around"; SSR stays deterministic and tour-free.
    expect(html).not.toContain("Stop 1 of 4")
    expect(html).not.toContain('role="status"')
    expect(html).toContain("market-guide-heading")
  })
})
