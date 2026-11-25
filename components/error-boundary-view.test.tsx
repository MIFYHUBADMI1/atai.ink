import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { ErrorBoundaryView } from "./error-boundary-view"

describe("ErrorBoundaryView", () => {
  it("says what failed, prints the reference and offers a way out", () => {
    const error = Object.assign(new Error("boom"), { digest: "digest-123" })
    const html = renderToStaticMarkup(createElement(ErrorBoundaryView, { scope: "page", error, retry: () => {} }))

    expect(html).toContain("This part of the workspace did not load")
    expect(html).toContain("Try again")
    expect(html).toContain("Reference:")
    expect(html).toContain("digest-123")
    expect(html).toContain('href="/projects"')
  })

  it("uses the root copy and omits the reference when there is no digest", () => {
    const html = renderToStaticMarkup(createElement(ErrorBoundaryView, { scope: "global", error: new Error("x"), retry: () => {} }))

    expect(html).toContain("Atai hit an unexpected error")
    expect(html).not.toContain("Reference:")
    expect(html).toContain('href="/"')
  })
})
