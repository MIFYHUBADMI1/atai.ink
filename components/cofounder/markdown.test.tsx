import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { CofounderMarkdown } from "./markdown"

/**
 * The suite runs in `node`, so UI assertions are static markup. What matters
 * here is that markdown is rendered as markup (not printed as raw text) and
 * that the user variant right-aligns prose while leaving blocks readable.
 */

describe("CofounderMarkdown", () => {
  it("renders headings, lists and emphasis as markup", () => {
    const html = renderToStaticMarkup(
      <CofounderMarkdown>{"## Plan\n\n- first\n- second\n\n**bold** and *italic*"}</CofounderMarkdown>,
    )
    expect(html).toContain("<h2")
    expect(html).toContain("<ul")
    expect(html).toContain("<li")
    expect(html).toContain("<strong")
    expect(html).toContain("<em")
    expect(html).not.toContain("## Plan")
  })

  it("right-aligns the user variant while keeping blocks left-aligned", () => {
    const html = renderToStaticMarkup(<CofounderMarkdown variant="user">{"hello"}</CofounderMarkdown>)
    expect(html).toContain("text-right")
    expect(html).toContain("[&amp;_ul]:text-left")
  })

  it("does not right-align the assistant variant", () => {
    const html = renderToStaticMarkup(<CofounderMarkdown>{"hello"}</CofounderMarkdown>)
    expect(html).not.toContain("text-right")
  })
})
