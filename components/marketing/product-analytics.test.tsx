import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { summariseProduct, type ProductEvent } from "@/lib/analytics/product/summary"
import { ProductAnalyticsPanel } from "./product-analytics"

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0)
const SINCE = NOW - 7 * 24 * 60 * 60 * 1000

function measuredSummary() {
  const events: ProductEvent[] = [
    { kind: "page_view", name: "page_view", path: "/", sessionId: "s1", visitorId: "v1", timestamp: NOW - 2000 },
    { kind: "page_view", name: "page_view", path: "/checkout", sessionId: "s1", visitorId: "v1", timestamp: NOW - 1000 },
    {
      kind: "click",
      name: "click",
      path: "/checkout",
      sessionId: "s1",
      visitorId: "v1",
      timestamp: NOW - 900,
      element: { role: "button", label: "Pay now" },
    },
  ]
  return summariseProduct(events, { windowDays: 7, since: SINCE })
}

describe("ProductAnalyticsPanel", () => {
  it("shows how to install the collector when there is nothing measured yet", () => {
    const html = renderToStaticMarkup(
      <ProductAnalyticsPanel
        summary={summariseProduct([], { windowDays: 7, since: SINCE })}
        keysHref="/business/b1/settings"
      />,
    )

    expect(html).toContain("No visits recorded yet")
    expect(html).toContain('href="/business/b1/settings"')
    // A wall of zeroes is not an empty state.
    expect(html).not.toContain("Leave after one page")
  })

  it("renders the measured numbers, the advice and the pages people stop on", () => {
    const html = renderToStaticMarkup(<ProductAnalyticsPanel summary={measuredSummary()} />)

    expect(html).toContain("What visitors do")
    expect(html).toContain("Visitors")
    expect(html).toContain("Page views")
    expect(html).toContain("/checkout")
    expect(html).toContain("Pay now")
    expect(html).toContain("What this means")
  })

  it("says so when the read was capped, rather than presenting a floor as exact", () => {
    const summary = { ...measuredSummary(), sampled: true }
    const html = renderToStaticMarkup(<ProductAnalyticsPanel summary={summary} />)
    expect(html).toContain("sampled")
  })
})
