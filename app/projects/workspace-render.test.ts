import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}))
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }))

const { ProjectsWorkspace } = await import("./workspace")

const business = {
  kind: "business" as const,
  id: "biz_1",
  name: "Northwind Traders",
  status: "active" as const,
  updatedAt: Date.now(),
}

function render(node: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(node)
}

describe("ProjectsWorkspace with a connected business", () => {
  it("renders it as a card that opens its own workspace", () => {
    const html = render(
      createElement(ProjectsWorkspace, { projects: [], businesses: [business], portfolioTotals: null }),
    )
    expect(html).toContain("Northwind Traders")
    expect(html).toContain('href="/business/biz_1"')
    expect(html).toContain("Connected business")
  })

  it("counts it in the portfolio total instead of claiming the portfolio is empty", () => {
    const html = render(
      createElement(ProjectsWorkspace, { projects: [], businesses: [business], portfolioTotals: null }),
    )
    expect(html).not.toContain("Your next business starts here")
    expect(html).toContain("1 total business")
  })

  it("shows the empty state only when there is nothing at all", () => {
    const html = render(createElement(ProjectsWorkspace, { projects: [], businesses: [], portfolioTotals: null }))
    expect(html).toContain("Your next business starts here")
  })
})
