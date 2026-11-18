/**
 * Meta-tag extraction for domain verification.
 *
 * The directive forbids regex-primary HTML parsing, and no HTML parser is
 * installed (adding one is not justified for a single attribute lookup — see
 * the engineering report). So this is a small character-level scanner: it
 * walks the document, honours comments and `<script>`/`<style>` raw-text
 * elements, and extracts real start-tag attributes. It reads the server-
 * returned HTML only — nothing is executed, and no subresource is fetched.
 *
 * Scope is deliberately narrow: we only ever ask "is there a
 * `<meta name="atai-verification" content="...">` in this document".
 */

export const VERIFICATION_META_NAME = "atai-verification"

const VOID_TAGS = new Set(["meta", "link", "br", "hr", "img", "input", "source", "area", "base", "col", "embed", "param", "track", "wbr"])
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title", "noscript", "iframe"])

export interface ScannedMeta {
  name?: string
  property?: string
  content?: string
}

/**
 * Decode the handful of entities that realistically appear inside an
 * attribute value. An unknown entity is left alone, so a token containing a
 * literal "&" cannot be forged by writing "&amp;" — the comparison is made
 * against the exact expected value after this minimal decode.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

/**
 * Parse `key="value"`, `key='value'`, `key=value` and bare attributes out of a
 * start tag body. Quoted values may contain anything except the quote;
 * unquoted values end at whitespace or ">".
 */
function parseAttributes(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let i = 0
  while (i < tagBody.length) {
    while (i < tagBody.length && /\s/.test(tagBody[i]!)) i++
    if (i >= tagBody.length || tagBody[i] === "/" || tagBody[i] === ">") break

    let name = ""
    while (i < tagBody.length && !/[\s="/]/.test(tagBody[i]!)) {
      name += tagBody[i]
      i++
    }
    if (!name) break

    while (i < tagBody.length && /\s/.test(tagBody[i]!)) i++
    let value = ""
    if (tagBody[i] === "=") {
      i++
      while (i < tagBody.length && /\s/.test(tagBody[i]!)) i++
      const quote = tagBody[i]
      if (quote === '"' || quote === "'") {
        i++
        while (i < tagBody.length && tagBody[i] !== quote) {
          value += tagBody[i]
          i++
        }
        i++ // closing quote
      } else {
        while (i < tagBody.length && !/[\s>]/.test(tagBody[i]!)) {
          value += tagBody[i]
          i++
        }
      }
    } else {
      // Attribute without "=" is a boolean attribute; record it as empty.
      value = ""
    }
    attrs[name.toLowerCase()] = decodeEntities(value)
  }
  return attrs
}

/**
 * Walk the document and return every `<meta>` element found (in document
 * order). `<script>`/`<style>`/comment interiors are skipped, so a token
 * printed inside a script or hidden in a comment does NOT count as a
 * verification tag — only a real meta element does.
 */
export function scanMetaTags(html: string): ScannedMeta[] {
  const metas: ScannedMeta[] = []
  const source = html ?? ""
  let i = 0

  while (i < source.length) {
    const lt = source.indexOf("<", i)
    if (lt < 0) break

    // Comments: skip to "-->"
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4)
      i = end < 0 ? source.length : end + 3
      continue
    }

    // Closing tag: skip
    if (source[lt + 1] === "/") {
      const end = source.indexOf(">", lt)
      i = end < 0 ? source.length : end + 1
      continue
    }

    const bodyEnd = source.indexOf(">", lt + 1)
    if (bodyEnd < 0) break
    const rawBody = source.slice(lt + 1, bodyEnd)
    const tagName = (rawBody.match(/^[a-zA-Z][a-zA-Z0-9-]*/)?.[0] ?? "").toLowerCase()

    if (tagName === "meta") {
      const attrs = parseAttributes(rawBody.slice("meta".length))
      metas.push({ name: attrs.name, property: attrs.property, content: attrs.content })
      i = bodyEnd + 1
      continue
    }

    if (RAW_TEXT_TAGS.has(tagName) && !VOID_TAGS.has(tagName)) {
      // Skip everything up to the matching close tag: content inside is raw
      // text, not markup, and must never satisfy a verification check.
      const close = source.toLowerCase().indexOf(`</${tagName}`, bodyEnd)
      i = close < 0 ? source.length : close
      continue
    }

    i = bodyEnd + 1
  }

  return metas
}

/**
 * The verification token is present only if a real `<meta>` element has
 * `name` exactly `atai-verification` (case-insensitive per HTML attribute
 * semantics) whose `content` matches the expected token.
 */
export function findVerificationTokens(html: string): string[] {
  return scanMetaTags(html)
    .filter((meta) => (meta.name ?? "").trim().toLowerCase() === VERIFICATION_META_NAME)
    .map((meta) => (meta.content ?? "").trim())
    .filter((content) => content.length > 0)
}

export function hasVerificationToken(html: string, expectedToken: string): boolean {
  const found = findVerificationTokens(html)
  return found.some((token) => token === expectedToken)
}

/** Distinguish "no tag at all" from "tag present, wrong token" so the UI can
 * give the founder the right instruction instead of one generic failure. */
export function diagnoseVerificationMeta(html: string, expectedToken: string): "missing" | "mismatch" | "match" {
  const found = findVerificationTokens(html)
  if (!found.length) return "missing"
  return found.includes(expectedToken) ? "match" : "mismatch"
}

export function buildMetaTagSnippet(token: string): string {
  return `<meta name="${VERIFICATION_META_NAME}" content="${token}">`
}
