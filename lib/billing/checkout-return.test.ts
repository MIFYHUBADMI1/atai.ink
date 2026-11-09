import { describe, expect, it } from "vitest"
import { checkoutReturnPath } from "./checkout-return"

describe("checkout return path", () => {
  it("keeps onboarding and billing returns", () => {
    expect(checkoutReturnPath("/start")).toBe("/start")
    expect(checkoutReturnPath("/settings/billing")).toBe("/settings/billing")
    expect(checkoutReturnPath("/dashboard")).toBe("/dashboard")
  })

  it("rejects arbitrary or unsafe urls", () => {
    expect(checkoutReturnPath("https://evil.example/phish")).toBe("/settings/billing")
    expect(checkoutReturnPath("//evil.example")).toBe("/settings/billing")
    expect(checkoutReturnPath("/admin")).toBe("/settings/billing")
  })

  it("returns a founder to the project page they were working on", () => {
    // Credits run out mid-build; the payment leg must not drop them elsewhere.
    expect(checkoutReturnPath("/project/flowmart-37bc7db3")).toBe("/project/flowmart-37bc7db3")
    expect(checkoutReturnPath("/project/flowmart/collaborate")).toBe("/project/flowmart/collaborate")
    expect(checkoutReturnPath("/project/flowmart/studio")).toBe("/project/flowmart/studio")
    expect(checkoutReturnPath("/projects")).toBe("/projects")
  })

  it("still refuses to smuggle anything through a project path", () => {
    expect(checkoutReturnPath("/project/..")).toBe("/settings/billing")
    expect(checkoutReturnPath("/project/flowmart/admin")).toBe("/settings/billing")
    expect(checkoutReturnPath("/project/flow mart")).toBe("/settings/billing")
    expect(checkoutReturnPath("/project/flowmart?next=//evil.example")).toBe("/project/flowmart")
  })
})
