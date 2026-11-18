import { describe, expect, it } from "vitest"
import {
  buildMetaTagSnippet,
  diagnoseVerificationMeta,
  findVerificationTokens,
  hasVerificationToken,
  scanMetaTags,
} from "./html-meta"

const TOKEN = "a".repeat(64)

describe("scanMetaTags", () => {
  it("extracts real meta elements with quoted, single-quoted and unquoted values", () => {
    const html = `<html><head>
      <meta name="atai-verification" content="${TOKEN}">
      <meta name='description' content='hello'>
      <meta name=viewport content=width=device-width>
    </head></html>`
    const metas = scanMetaTags(html)
    expect(metas).toHaveLength(3)
    expect(metas[0]).toEqual({ name: "atai-verification", property: undefined, content: TOKEN })
    expect(metas[1]!.content).toBe("hello")
    expect(metas[2]!.content).toBe("width=device-width")
  })

  it("ignores meta tags hidden inside comments", () => {
    const html = `<!-- <meta name="atai-verification" content="${TOKEN}"> --><head></head>`
    expect(scanMetaTags(html)).toHaveLength(0)
  })

  it("ignores meta-looking text inside script, style, textarea and title", () => {
    for (const tag of ["script", "style", "textarea", "title", "noscript"]) {
      const html = `<head><${tag}><meta name="atai-verification" content="${TOKEN}"></${tag}></head>`
      expect(scanMetaTags(html), tag).toHaveLength(0)
    }
  })

  it("finds a real meta tag that follows a script block", () => {
    const html = `<head><script>var x = "<meta name='atai-verification' content='fake'>";</script><meta name="atai-verification" content="${TOKEN}"></head>`
    expect(findVerificationTokens(html)).toEqual([TOKEN])
  })

  it("decodes the common entities inside attribute values", () => {
    const html = `<meta name="atai-verification" content="a&amp;b&quot;c">`
    expect(findVerificationTokens(html)).toEqual(['a&b"c'])
  })

  it("handles uppercase tag and attribute names", () => {
    const html = `<META NAME="Atai-Verification" CONTENT="${TOKEN}">`
    expect(hasVerificationToken(html, TOKEN)).toBe(true)
  })

  it("tolerates self-closing syntax and attribute order", () => {
    const html = `<meta content="${TOKEN}" name="atai-verification" />`
    expect(hasVerificationToken(html, TOKEN)).toBe(true)
  })
})

describe("verification diagnosis", () => {
  const page = (content: string) => `<html><head><meta name="atai-verification" content="${content}"></head><body>hi</body></html>`

  it("match only when the exact token sits in the right meta element", () => {
    expect(diagnoseVerificationMeta(page(TOKEN), TOKEN)).toBe("match")
    expect(diagnoseVerificationMeta(page("wrong-token"), TOKEN)).toBe("mismatch")
    expect(diagnoseVerificationMeta("<html><head></head></html>", TOKEN)).toBe("missing")
  })

  it("a token printed as plain text or in the wrong meta name never matches", () => {
    expect(hasVerificationToken(`<html><body>${TOKEN}</body></html>`, TOKEN)).toBe(false)
    expect(hasVerificationToken(`<meta name="other-verification" content="${TOKEN}">`, TOKEN)).toBe(false)
    expect(hasVerificationToken(`<meta property="atai-verification" content="${TOKEN}">`, TOKEN)).toBe(false)
  })

  it("multiple tags: any exact match counts, mismatches alone do not", () => {
    const two = `<meta name="atai-verification" content="old"><meta name="atai-verification" content="${TOKEN}">`
    expect(hasVerificationToken(two, TOKEN)).toBe(true)
    const wrongOnly = `<meta name="atai-verification" content="old"><meta name="atai-verification" content="older">`
    expect(diagnoseVerificationMeta(wrongOnly, TOKEN)).toBe("mismatch")
  })

  it("empty content is not a token", () => {
    expect(findVerificationTokens(`<meta name="atai-verification" content="">`)).toEqual([])
    expect(diagnoseVerificationMeta(`<meta name="atai-verification" content="">`, TOKEN)).toBe("missing")
  })

  it("buildMetaTagSnippet round-trips through the scanner", () => {
    const snippet = buildMetaTagSnippet(TOKEN)
    expect(snippet).toBe(`<meta name="atai-verification" content="${TOKEN}">`)
    expect(hasVerificationToken(`<head>${snippet}</head>`, TOKEN)).toBe(true)
  })
})
