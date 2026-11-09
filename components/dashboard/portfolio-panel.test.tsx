import { afterEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const state = vi.hoisted(() => ({
  overview: null as null | Record<string, unknown>,
  error: null as null | { message: string },
  isLoading: false,
}))

vi.mock("@/lib/client/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePortfolioOverview: () => ({
    overview: state.overview,
    error: state.error,
    isLoading: state.isLoading,
    refresh: () => {},
  }),
}))

const { PortfolioPanel } = await import("./portfolio-panel")

afterEach(() => {
  state.overview = null
  state.error = null
  state.isLoading = false
})

function overview(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: Date.parse("2026-11-05T12:00:00.000Z"),
    days: 30,
    daily: [
      { date: "2026-11-04", creditsCharged: 1200, earningsMinor: 5900, providerCostUsd: 3.5 },
      { date: "2026-11-05", creditsCharged: 800, earningsMinor: 0, providerCostUsd: null },
    ],
    totals: {
      requests: 420,
      succeeded: 400,
      failed: 20,
      creditsCharged: 2000,
      earningsMinor: 5900,
      providerCostUsd: 3.5,
      providerCostUnavailableCount: 0,
      succeededPayments: 1,
      pendingPayments: 2,
      currencies: ["USD"],
    },
    prior: { requests: 300, creditsCharged: 1000, earningsMinor: 0 },
    spendChangePct: 100,
    earningsStatus: "ok",
    earningsNote: null,
    projectsCount: 3,
    earningsSweepComplete: true,
    byProject: [
      { projectId: "prj_a", projectName: "Northwind Store", requests: 300, creditsCharged: 1500, earningsMinor: 5900, currency: "USD" },
      { projectId: "prj_b", projectName: "Helio Docs", requests: 120, creditsCharged: 500, earningsMinor: 0, currency: "USD" },
    ],
    ...overrides,
  }
}

const render = () => renderToStaticMarkup(createElement(PortfolioPanel))

describe("PortfolioPanel — the dashboard's real earnings/spend chart", () => {
  it("renders the range control and one KPI per unit, never a blended net", () => {
    state.overview = overview()
    const html = render()
    expect(html).toContain('aria-label="Chart window"')
    expect(html).toContain("14d")
    expect(html).toContain("30d")
    expect(html).toContain("90d")
    expect(html).toContain("Attributed earnings (30d)")
    expect(html).toContain("USD 59.00")
    expect(html).toContain("2,000 credits")
    expect(html).toContain("$3.50")
    expect(html).toContain("420")
    expect(html).toContain("+100% vs the prior window")
    expect(html).not.toContain("Net (earnings")
    // Stacked business cards, not a grid table.
    expect(html).not.toContain("<table")
    expect(html).toContain("Northwind Store")
    expect(html).toContain('href="/project/prj_a/finances"')
  })

  it("keeps an unavailable earnings feed unavailable instead of a zero", () => {
    state.overview = overview({
      earningsStatus: "unavailable",
      earningsNote: "No platform payment provider is configured.",
      totals: {
        ...overview().totals,
        earningsMinor: null,
        currencies: [],
        succeededPayments: 0,
        pendingPayments: 0,
      },
      // What the server actually sends when the feed isn't ok — null, never 0.
      byProject: [
        { projectId: "prj_a", projectName: "Northwind Store", requests: 300, creditsCharged: 1500, earningsMinor: null, currency: null },
      ],
    })
    const html = render()
    expect(html).toContain("Earnings feed not configured.")
    expect(html).toContain("No platform payment provider is configured.")
    expect(html).toContain("unavailable")
    expect(html).toContain("earnings not reported")
    expect(html).not.toContain("USD 0.00")
  })

  it("says so when there is no prior window to compare against", () => {
    state.overview = overview({ spendChangePct: null })
    expect(render()).toContain("No spend in the window before this one")
  })

  it("warns when payments arrived in more than one currency", () => {
    state.overview = overview({
      totals: { ...overview().totals, currencies: ["EUR", "USD"] },
    })
    const html = render()
    expect(html).toContain("more than one currency")
    expect(html).toContain("EUR, USD")
  })

  it("discloses a partial earnings sweep rather than implying full coverage", () => {
    state.overview = overview({ earningsSweepComplete: false })
    expect(render()).toContain("most recently updated businesses")
  })

  it("shows an honest empty state when the window saw nothing", () => {
    state.overview = overview({
      daily: [],
      totals: { ...overview().totals, requests: 0, succeeded: 0, failed: 0, creditsCharged: 0, earningsMinor: 0, providerCostUsd: null },
      spendChangePct: null,
      byProject: [],
    })
    const html = render()
    expect(html).toContain("Nothing has run yet in this window.")
    expect(html).toContain("not reported")
    expect(html).not.toContain("Daily flow")
  })

  it("surfaces a failed load rather than an empty dashboard", () => {
    state.error = { message: "Request failed with status 500." }
    const html = render()
    expect(html).toContain("We couldn&#x27;t load your portfolio numbers.")
    expect(html).toContain("Request failed with status 500.")
  })

  it("paints skeletons while the first fetch is in flight", () => {
    state.isLoading = true
    expect(render()).toContain('animate-pulse')
  })
})
