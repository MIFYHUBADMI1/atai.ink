import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SdkSetupCard } from "./sdk-setup-card"

vi.mock("@/lib/client/api", () => ({ postJson: vi.fn() }))

function render() {
  return renderToStaticMarkup(createElement(SdkSetupCard, { businessId: "biz_1" }))
}

describe("SdkSetupCard", () => {
  it("names the install command instead of describing it", () => {
    expect(render()).toContain("npm install @atai-group/sdk")
  })

  it("offers the brief as a file to hand to an agent", () => {
    const html = render()

    expect(html).toContain("Download the brief")
    expect(html).toContain("follow this brief")
  })

  it("points at the browser measurement and the reference", () => {
    const html = render()

    expect(html).toContain("Measure your site")
    expect(html).toContain('href="/sdk"')
  })
})
