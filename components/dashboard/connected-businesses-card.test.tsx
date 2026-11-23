import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const state = vi.hoisted(() => ({
  enabled: false,
  businesses: [] as Array<{ id: string; name: string; status: string; createdAt: number; updatedAt: number }>,
}))

vi.mock("@/lib/client/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBusinessAccess: () => ({ enabled: state.enabled, isLoading: false }),
  useBusinesses: () => ({ businesses: state.businesses, isLoading: false, error: null }),
}))

const { ConnectedBusinessesCard } = await import("./command-center")

describe("ConnectedBusinessesCard", () => {
  it("renders nothing while the rollout is closed for this account", () => {
    state.enabled = false
    state.businesses = [{ id: "biz_1", name: "Northwind", status: "active", createdAt: 1, updatedAt: 2 }]
    expect(renderToStaticMarkup(createElement(ConnectedBusinessesCard))).toBe("")
  })

  it("offers a way to connect one when the rollout is open and there are none", () => {
    state.enabled = true
    state.businesses = []
    const html = renderToStaticMarkup(createElement(ConnectedBusinessesCard))
    expect(html).toContain("No connected businesses yet")
    expect(html).toContain('href="/business"')
  })

  it("links each business straight to its workspace", () => {
    state.enabled = true
    state.businesses = [
      { id: "biz_1", name: "Northwind", status: "active", createdAt: 1, updatedAt: 2 },
      { id: "biz_2", name: "Contoso", status: "draft", createdAt: 1, updatedAt: 3 },
    ]
    const html = renderToStaticMarkup(createElement(ConnectedBusinessesCard))
    expect(html).toContain('href="/business/biz_1"')
    expect(html).toContain('href="/business/biz_2"')
    expect(html).toContain("Northwind")
    expect(html).toContain("Draft")
  })
})
