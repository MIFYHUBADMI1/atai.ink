import { describe, expect, it } from "vitest"

import { shellNavigation } from "./dashboard-shell"

describe("shellNavigation", () => {
  it("calls the portfolio link All businesses", () => {
    const portfolio = shellNavigation().find((item) => item.href === "/projects")
    expect(portfolio?.label).toBe("All businesses")
  })

  it("lists destinations only — never a user's own projects", () => {
    for (const item of shellNavigation()) {
      expect(item.href.startsWith("/project/")).toBe(false)
    }
  })

  it("keeps one entry per destination — no second list for connected businesses", () => {
    const hrefs = shellNavigation().map((item) => item.href)
    expect(hrefs).not.toContain("/business")
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
