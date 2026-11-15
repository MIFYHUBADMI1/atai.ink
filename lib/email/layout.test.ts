import { describe, expect, it } from "vitest"

import { emailButton, emailMetaTable, escapeHtml, renderEmailShell, safeHttpUrl } from "@/lib/email/layout"

const BANNED_EMAIL_CSS = ["@keyframes", "animation", "backdrop-filter", "position:absolute", "linear-gradient", "rgba("]

function expectEmailSafe(html: string) {
  expect(html).toContain("<!DOCTYPE html>")
  expect(html).toContain('role="presentation"')
  expect(html).toContain('bgcolor="#f4f4f5"')
  expect(html).toContain('name="color-scheme"')
  expect(html).toContain("prefers-color-scheme: dark")
  for (const banned of BANNED_EMAIL_CSS) {
    expect(html).not.toContain(banned)
  }
}

describe("renderEmailShell", () => {
  it("renders a table-based shell with a light fallback and dark-mode hooks", () => {
    const html = renderEmailShell({
      title: "Hello",
      preheader: "Preview text",
      heading: "Hello there",
      eyebrow: "Account",
      bodyHtml: "<p>Body</p>",
      footerNote: "Footer note",
    })

    expectEmailSafe(html)
    expect(html).toContain("Hello there")
    expect(html).toContain("Preview text")
    expect(html).toContain("Account")
    expect(html).toContain("Footer note")
  })

  it("escapes shell copy", () => {
    const html = renderEmailShell({
      title: "<script>alert(1)</script>",
      preheader: "<img src=x>",
      heading: "<b>bold</b>",
      eyebrow: "<em>eyebrow</em>",
      bodyHtml: "<p>safe</p>",
      footerNote: "<svg>",
    })

    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).not.toContain("<img src=x>")
    expect(html).not.toContain("<svg>")
    expect(html).toContain("&lt;script&gt;")
  })
})

describe("email helpers", () => {
  it("only allows http(s) URLs", () => {
    expect(safeHttpUrl("https://atai.ink/x")).toBe("https://atai.ink/x")
    expect(safeHttpUrl("http://atai.ink/x")).toBe("http://atai.ink/x")
    expect(safeHttpUrl("javascript:alert(1)")).toBe("")
    expect(safeHttpUrl("not a url")).toBe("")
  })

  it("does not emit a link for an unsafe button URL", () => {
    const html = emailButton("javascript:alert(1)", "Click me")
    expect(html).not.toContain("javascript:alert(1)")
    expect(html).toContain("Click me")
  })

  it("escapes meta table values", () => {
    const html = emailMetaTable([{ label: "Name", value: "<script>alert(1)</script>" }])
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("escapes HTML entities", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;")
  })
})
