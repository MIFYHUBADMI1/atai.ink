/**
 * Write-time content sanitisation for admin-authored articles.
 *
 * The public renderer is already safe by construction: react-markdown runs
 * without `rehype-raw`, so raw HTML is never rendered, and its default URL
 * transform rejects `javascript:` targets. This module is the second layer —
 * it keeps the *stored* document clean, so a draft copied between systems, a
 * future renderer, or a raw API read cannot resurrect a payload that was
 * never meant to be executable.
 *
 * The rules are deliberately narrow: only things that can execute are removed.
 * Normal prose, GFM tables, task lists, code fences, autolinks and https
 * links are untouched.
 */

/** Elements that can execute or smuggle a payload. */
const BLOCKED_ELEMENTS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "link",
  "meta",
  "base",
  "svg",
  "math",
  "template",
  "noscript",
  "portal",
] as const

/** URL schemes that are safe to keep in a link or image target. */
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"])

/** Removes elements that carry their own content (script/style bodies). */
function stripDangerousElements(markdown: string): string {
  let output = markdown
  for (const tag of BLOCKED_ELEMENTS) {
    // Paired form: drop the element *and* everything inside it.
    output = output.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "")
    // Unpaired / self-closing leftovers.
    output = output.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "")
  }
  return output
}

/** Drops inline event handlers (`onclick=…`) from any surviving raw HTML. */
function stripEventHandlers(markdown: string): string {
  return markdown.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
}

/** Removes remaining raw HTML tags. The renderer never showed them anyway. */
function stripRawHtml(markdown: string): string {
  return markdown.replace(/<\/?[a-z][^>]*>/gi, "")
}

/**
 * Neutralises dangerous URL schemes at the start of a markdown link or image
 * target. The target text is left untouched otherwise, so URLs containing
 * parentheses or titles survive intact.
 */
function neutraliseDangerousLinks(markdown: string): string {
  return markdown.replace(
    /(\]\()\s*[\u0000-\u0020]*([a-z][a-z0-9+.-]*)\s*:/gi,
    (match, open: string, scheme: string) => {
      if (SAFE_SCHEMES.has(scheme.toLowerCase())) return match
      return `${open}#`
    },
  )
}

/**
 * Sanitise an article body. Markdown structure is preserved; only executable
 * constructs are removed.
 */
export function sanitizeBlogMarkdown(markdown: string): string {
  if (!markdown) return ""
  return neutraliseDangerousLinks(stripRawHtml(stripEventHandlers(stripDangerousElements(markdown))))
}

/**
 * Sanitise a plain-text field (title, description, excerpt). These are never
 * rendered as markup, but stripping tags keeps them safe if they are ever
 * interpolated into one.
 */
export function sanitizeBlogText(value: string): string {
  if (!value) return ""
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
}
