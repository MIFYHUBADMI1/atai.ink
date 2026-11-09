import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/client/api", () => ({ postJson: vi.fn() }))
import { ResetPasswordForm } from "./reset-password-form"

describe("reset form initial rendering", () => {
  it("offers a replacement link when the URL has no token", () => {
    const html = renderToStaticMarkup(createElement(ResetPasswordForm, { token: null }))
    expect(html).toContain("missing its reset token")
    expect(html).toContain('href="/forgot-password"')
    expect(html).not.toContain('<form')
  })
  it("renders labeled bounded password fields without putting the token in the markup", () => {
    const token = "a".repeat(43)
    const html = renderToStaticMarkup(createElement(ResetPasswordForm, { token }))
    expect(html).toContain("New password")
    expect(html).toContain("Confirm new password")
    expect(html).toContain('type="password"')
    expect(html).toContain('autoComplete="new-password"')
    expect(html).toContain('maxLength="1024"')
    expect(html).not.toContain(token)
  })
})
