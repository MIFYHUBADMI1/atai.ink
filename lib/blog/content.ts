/** Pure content helpers shared by the store, audits, editor and public pages.
 * No server-only imports — safe in client components and tests. */

import { markdownHeadingEntries } from "@/lib/resources/media"

export function slugifyBlog(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
}

export function wordCount(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`|_~-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length
}

export function readingMinutes(markdown: string): number {
  return Math.max(1, Math.round(wordCount(markdown) / 200))
}

/**
 * The article hero renders the page's only H1, so a leading `# Title` line is
 * dropped and any other in-body H1 is demoted to a section heading. Left as it
 * was, a stray `#` came out as a second, unstyled H1 and never appeared in the
 * outline.
 *
 * Pasted syntax is repaired on the way: `##Title` and `-item` are not a heading
 * or a list to a markdown parser, they are literal text the reader ends up
 * seeing. A single `#` before a word is left alone because `#hashtags` and
 * headings are indistinguishable there, and a leading `-` before a number ("-50%
 * off") is text, not a bullet.
 *
 * Outline and renderer must receive this same text: demoting inside the
 * renderer alone would give the heading an anchor that no outline link points
 * at. Fenced code is left untouched — `# comment` inside a sample is content.
 */
export function normalizeBlogBody(markdown: string): string {
  // The title line goes first, so demotion only ever touches headings the
  // author wrote inside the body.
  const withoutTitleLine = markdown.replace(/^# [^\n]*\n+/, "")
  let inFence = false
  return withoutTitleLine
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      const gluedHeading = line.match(/^(#{2,6})(?=[^#\s])(.+)$/)
      if (gluedHeading) return `${gluedHeading[1]} ${gluedHeading[2]}`
      const gluedItem = line.match(/^([-+])(?=[A-Za-z*_![])(.+)$/)
      if (gluedItem) return `${gluedItem[1]} ${gluedItem[2]}`
      return /^# (?!#)/.test(line) ? `##${line.slice(1)}` : line
    })
    .join("\n")
}

/** Strip markdown syntax for excerpts, search indexes and meta fallbacks. */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

interface TocEntry {
  id: string
  text: string
  level: number
}

/** The anchor scheme is shared with the renderer, so an outline link always
 * points at a heading that exists. */
export { headingId } from "@/lib/resources/media"

/**
 * H2/H3 outline used for the table of contents and heading-hierarchy audit.
 *
 * `maxLevel` is raised to 4 by the audit so a skipped level (H2 → H4) is
 * visible; the public table of contents keeps the default two levels so it
 * stays a scannable outline rather than a full document map.
 */
export function markdownToc(markdown: string, maxLevel = 3): TocEntry[] {
  return markdownHeadingEntries(markdown)
    .filter((heading) => heading.level <= maxLevel)
    .map(({ id, text, level }) => ({ id, text, level }))
}

export interface FaqEntry {
  q: string
  a: string
}

/**
 * Split a trailing FAQ section out of the markdown so it renders once as an
 * accessible accordion (and feeds FAQPage structured data) instead of twice.
 *
 * The public page uses the returned body for BOTH the rendered article and
 * the table of contents, so the outline matches the headings on the page.
 */
export function splitFaqSection(markdown: string): { body: string; faqMarkdown: string | null } {
  const match = /^##\s+(?:frequently asked questions|faq)\s*$/im.exec(markdown)
  if (!match) return { body: markdown, faqMarkdown: null }
  const rest = markdown.slice(match.index + match[0].length)
  const nextHeading = rest.search(/^##\s+/m)
  const faqMarkdown = nextHeading === -1 ? rest : rest.slice(0, nextHeading)
  const tail = nextHeading === -1 ? "" : rest.slice(nextHeading)
  return { body: `${markdown.slice(0, match.index)}${tail}`.trim(), faqMarkdown }
}

/** Reads a "## Frequently asked questions" section with **Q:** / A: pairs or
 * ### question headings. Used for FAQ rendering + FAQPage structured data. */
export function extractBlogFaqs(markdown: string): FaqEntry[] {
  const section = /^##\s+(?:frequently asked questions|faq)\s*$/im.exec(markdown)
  if (!section) return []
  const rest = markdown.slice(section.index + section[0].length)
  const nextHeading = rest.search(/^##\s+/m)
  const block = nextHeading === -1 ? rest : rest.slice(0, nextHeading)
  const faqs: FaqEntry[] = []

  const h3Pattern = /^###\s+(.+?)\s*\n([\s\S]*?)(?=^###\s+|\s*$)/gm
  let match: RegExpExecArray | null
  while ((match = h3Pattern.exec(block)) !== null) {
    const answer = match[2].trim()
    if (match[1].trim() && answer) faqs.push({ q: match[1].trim(), a: markdownToText(answer) })
  }
  if (faqs.length) return faqs

  const boldPattern = /\*\*(.+?)\*\*\s*\n+([\s\S]*?)(?=\n\s*\*\*|\s*$)/g
  while ((match = boldPattern.exec(block)) !== null) {
    const answer = match[2].trim()
    if (match[1].trim() && answer) faqs.push({ q: match[1].trim(), a: markdownToText(answer) })
  }
  return faqs
}

/** Internal links point at other Atai pages; used by the audit + linking UI. */
export function extractLinks(markdown: string): { href: string; internal: boolean }[] {
  const links: { href: string; internal: boolean }[] = []
  const pattern = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(markdown)) !== null) {
    const href = match[1]
    links.push({ href, internal: href.startsWith("/") || href.startsWith("#") })
  }
  return links
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The label a subscription is filed under.
 *
 * The subscribe form is public, so the label is NOT taken from the caller
 * verbatim: it is matched against a known set, and anything else is filed as
 * a plain blog subscription. A stored label can never carry a formula or a
 * line break into the admin export.
 */
export function normalizeNewsletterSource(value?: string): string {
  const raw = (value ?? "").trim().toLowerCase()
  if (!raw) return "blog"
  if (raw === "blog" || raw === "blog-index") return raw
  if (raw.startsWith("article:")) {
    const slug = raw.slice("article:".length).replace(/[^a-z0-9-]/g, "").slice(0, 80)
    return slug ? `article:${slug}` : "blog"
  }
  return "blog"
}