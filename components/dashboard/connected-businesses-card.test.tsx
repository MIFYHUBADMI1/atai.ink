import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const state = vi.hoisted(() => ({
  enabled: false,
  isLoading: false,
  businesses: [] as Array<{ id: string; name: string; status: string; createdAt: number; updatedAt: number }>,
}))

vi.mock("@/lib/client/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBusinessAccess: () => ({ enabled: state.enabled, isLoading: false }),
  useBusinesses: () => ({ businesses: state.businesses, isLoading: state.isLoading, error: null }),
}))

const { ConnectedBusinessesCard } = await import("./command-center")

const business = (id: string, name: string, status = "active") => ({
  id,
  name,
  status,
  createdAt: 1,
  updatedAt: 2,
})

describe("ConnectedBusinessesCard", () => {
  it("renders nothing while the rollout is closed for this account", () => {
    state.enabled = false
    state.isLoading = false
    state.businesses = [business("biz_1", "Northwind")]
    expect(renderToStaticMarkup(createElement(ConnectedBusinessesCard))).toBe("")
  })

  it("sends the empty state to the connect journey, not the portfolio", () => {
    state.enabled = true
    state.isLoading = false
    state.businesses = []
    const html = renderToStaticMarkup(createElement(ConnectedBusinessesCard))
    expect(html).toContain("No connected businesses yet")
    expect(html).toContain('href="/new/existing"')
    // There is no workspace to open yet, so the card must not promise one.
    expect(html).not.toContain("Open workspace")
    expect(html).not.toContain('href="/business"')
  })

  it("opens the only workspace when there is one business", () => {
    state.enabled = true
    state.isLoading = false
    state.businesses = [business("biz_1", "Northwind")]
    const html = renderToStaticMarkup(createElement(ConnectedBusinessesCard))
    expect(html).toContain("Open workspace")
    expect(html).toContain('href="/business/biz_1"')
    expect(html).not.toContain('href="/projects"')
  })

  it("names the portfolio when there are several businesses", () => {
    state.enabled = true
    state.isLoading = false
    state.businesses = [business("biz_1", "Northwind"), business("biz_2", "Contoso", "draft")]
    const html = renderToStaticMarkup(createElement(ConnectedBusinessesCard))
    expect(html).toContain("All businesses")
    expect(html).toContain('href="/projects"')
    // "Open workspace" would be a lie with two workspaces to choose from.
    expect(html).not.toContain("Open workspace")
  })

  it("links each business straight to its workspace", () => {
    state.enabled = true
    state.isLoading = false
    state.businesses = [business("biz_1", "Northwind"), business("biz_2", "Contoso", "draft")]
    const html = renderToStaticMarkup(createElement(ConnectedBusinessesCard))
    expect(html).toContain('href="/business/biz_1"')
    expect(html).toContain('href="/business/biz_2"')
    expect(html).toContain("Northwind")
    expect(html).toContain("Draft")
  })
})
