/**
 * Shared helpers for the long-form documentation pages (the "extended" docs
 * that live at /docs/<topic>). Extracts a clean Q/A list from a document's
 * "Common problems" / FAQ / Troubleshooting / Error reference section so each
 * page can emit schema.org FAQPage structured data at build time.
 *
 * This is server-only code (imported by force-static page components) and has
 * no React dependency.
 */

/** Strip markdown syntax down to plain, crawlable text. */
export function cleanInline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[-\*]\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Returns up to `limit` question/answer pairs pulled from the first section
 * whose heading matches a "problems / faq / troubleshooting / errors" pattern.
 * Accepts two problem formats already used across the docs:
 *   - `### Problem title` (leaf heading) — question is the heading text
 *   - `**(a) Problem text**` inline sub-items
 * Everything between a question marker and the next marker is the answer.
 */
export function extractFaqs(
  md: string,
  opts?: { section?: RegExp; limit?: number },
): Array<{ q: string; a: string }> {
  // Tolerate optional leading prefixes used across the docs:
  //   "## 8. Common problems"        → numbered section
  //   "## Part 10 — Common problems" → "Part N —" style (onboarding guide)
  // Specific titles are tried before the generic "errors" fallback, so a
  // heading like "## 4. Error message reference" cannot win over the real
  // "## Common problems" section further down the page.
  const patterns: RegExp[] = opts?.section
    ? [opts.section]
    : [
        /^##\s+(?:part\s+\d+[.)]?\s*[—-]\s+)?(?:\d+[.)]\s+)?(?:faqs?|common problems|troubleshooting|error reference)\b/i,
        /^##\s+(?:part\s+\d+[.)]?\s*[—-]\s+)?(?:\d+[.)]\s+)?errors?\s*$/i,
      ]
  const limit = opts?.limit ?? 30

  const lines = md.split(/\r?\n/)
  let start = -1
  for (const re of patterns) {
    start = lines.findIndex((l) => re.test(l))
    if (start !== -1) break
  }
  if (start === -1) return []

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    // Stop at the next top-level section. Matching `##` (not just `#`) keeps
    // later sections such as "Related guides" from being read as questions.
    if (/^#{1,2}\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  const region = lines.slice(start, end)
  const faqs: Array<{ q: string; a: string[] }> = []
  let cur: { q: string; a: string[] } | null = null
  const flush = () => {
    if (cur && cur.a.join(" ").replace(/\s+/g, " ").trim().length > 20) faqs.push(cur)
  }

  for (const line of region) {
    // Leaf heading (## or ###) → a question. Skip the section title itself.
    const h = /^(#{2,3})\s+(.*)$/.exec(line)
    if (h && line !== region[0]) {
      flush()
      cur = { q: cleanInline(h[2]), a: [] }
      continue
    }
    // Inline "(a) Title" sub-item → a question.
    const m = /^\*\*\s*\(([a-z0-9]+)\)\s*([^*]+?)\s*\*\*(.*)$/.exec(line)
    if (m) {
      flush()
      const rest = m[3] ? cleanInline(m[3]) : ""
      const q = cleanInline(m[2]).replace(/^["“”]/, "").replace(/["“”]$/, "")
      cur = { q, a: rest ? [rest] : [] }
      continue
    }
    if (cur) {
      const t = cleanInline(line)
      if (t) cur.a.push(t)
    }
  }
  flush()

  return faqs
    .map((f) => ({ q: f.q, a: f.a.join(" ").replace(/\s+/g, " ").trim().slice(0, 500) }))
    .filter((f) => f.a.length > 20)
    .slice(0, limit)
}
