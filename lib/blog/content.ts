/** Pure content helpers shared by the store, audits, editor and public pages.
 * No server-only imports — safe in client components and tests. */

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

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
}

/**
 * H2/H3 outline used for the table of contents and heading-hierarchy audit.
 *
 * `maxLevel` is raised to 4 by the audit so a skipped level (H2 → H4) is
 * visible; the public table of contents keeps the default two levels so it
 * stays a scannable outline rather than a full document map.
 */
export function markdownToc(markdown: string, maxLevel = 3): TocEntry[] {
  const entries: TocEntry[] = []
  const seen = new Map<string, number>()
  let inFence = false
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) continue
    if (match[1].length > maxLevel) continue
    const text = match[2].replace(/[*_`]/g, "").trim()
    if (!text) continue
    const base = headingId(text) || "section"
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    entries.push({ id: count === 0 ? base : `${base}-${count}`, text, level: match[1].length })
  }
  return entries
}

export interface FaqEntry {
  q: string
  a: string
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