import { describe, expect, it } from "vitest"

import { shellNavigation } from "./dashboard-shell"

const hrefs = (enabled: boolean) => shellNavigation(enabled).map((item) => item.href)

describe("shellNavigation", () => {
  it("leaves the navigation untouched while the rollout is closed", () => {
    expect(hrefs(false)).not.toContain("/business")
  })

  it("slots the connected-business entry right after Businesses", () => {
    const open = hrefs(true)
    expect(open.indexOf("/business")).toBe(open.indexOf("/projects") + 1)
  })

  it("only adds an entry, never removes one", () => {
    expect(hrefs(true)).toEqual(expect.arrayContaining(hrefs(false)))
    expect(hrefs(true)).toHaveLength(hrefs(false).length + 1)
  })
})
