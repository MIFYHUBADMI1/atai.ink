import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { OnboardingPathStep } from "./path-step"

function render(value: "" | "build" | "import" | "connect"): string {
  return renderToStaticMarkup(createElement(OnboardingPathStep, { value, onChoose: () => {} }))
}

describe("OnboardingPathStep", () => {
  it("offers all three starting points instead of assuming a build", () => {
    const html = render("")
    expect(html).toContain("Build something new")
    expect(html).toContain("Bring an existing codebase")
    expect(html).toContain("Connect a business you already run")
    expect(html.match(/data-path=/g)).toHaveLength(3)
  })

  it("says plainly that connecting does not rebuild anything", () => {
    expect(render("")).toContain("nothing gets rebuilt")
  })

  it("marks exactly the chosen path so a returning founder sees their answer", () => {
    expect(render("").match(/aria-pressed="true"/g)).toBeNull()
    for (const path of ["build", "import", "connect"] as const) {
      const pressed = render(path)
        .split("<button")
        .filter((block) => block.includes('aria-pressed="true"'))
      expect(pressed).toHaveLength(1)
      expect(pressed[0]).toContain(`data-path="${path}"`)
    }
  })
})
