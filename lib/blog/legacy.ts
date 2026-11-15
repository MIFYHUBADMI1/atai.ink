/**
 * Blog content + SEO helper.
 *
 * The blog is an independent feature (served at /blog, separate from /docs).
 * Posts live as plain Markdown files in a top-level `blog/<slug>.md` directory
 * with a small YAML-style front matter block. They are read at build time (the
 * blog pages are force-static) so there is no runtime filesystem dependency once
 * deployed.
 *
 * Keeping posts as Markdown files means they can be edited, reviewed, and
 * version-controlled like code, and they ship with the same crawlable JSON-LD
 * treatment as the rest of the site.
 */

import fs from "node:fs"
import path from "node:path"

import type { ComparisonData } from "@/lib/blog/types"

export interface BlogPost {
  slug: string
  title: string
  description: string
  excerpt: string
  date: string
  updated?: string
  tags: string[]
  competitor?: string
  /** Structured, evidence-backed comparison kept beside the post. */
  comparison?: ComparisonData
  body: string
  readingMinutes: number
}

const BLOG_DIR = path.join(process.cwd(), "blog")
const COMPARISON_SUFFIX = ".comparison.json"

const FRONT_MATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/

function parseFrontMatter(raw: string): { data: Record<string, string>; body: string } {
  const match = FRONT_MATTER_RE.exec(raw)
  if (!match) {
    return { data: {}, body: raw }
  }
  const data: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    // Strip matching surrounding quotes so `date: "2026-11-15"` parses as a
    // real date and titles/descriptions don't ship with literal quote marks.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1).trim()
    }
    data[m[1].toLowerCase()] = value
  }
  return { data, body: raw.slice(match[0].length) }
}

function readingTime(body: string): number {
  const words = body.replace(/```[\s\S]*?```/g, " ").split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

function toPost(slug: string, raw: string): BlogPost {
  const { data, body } = parseFrontMatter(raw)
  const title = data.title || slug
  const description = data.description || body.slice(0, 150).replace(/[#>*`]/g, "").trim()
  const excerpt = data.excerpt || description
  const tags = (data.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
  return {
    slug,
    title,
    description,
    excerpt,
    date: data.date || new Date().toISOString().slice(0, 10),
    updated: data.updated || undefined,
    tags,
    competitor: data.competitor || undefined,
    comparison: getPostComparison(slug) ?? undefined,
    body: body.trim(),
    readingMinutes: readingTime(body),
  }
}

/**
 * Structured comparison data for a post, kept in a sidecar JSON file next to
 * the markdown (`blog/<slug>.comparison.json`).
 *
 * Every competitor cell has to carry the source it came from and the date it
 * was last checked — that is what lets the audit tell a verified claim from
 * an opinion, and what stops an unsupported superiority claim from shipping.
 */
function getPostComparison(slug: string): ComparisonData | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(BLOG_DIR, `${slug}${COMPARISON_SUFFIX}`), "utf8"))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const data = parsed as Partial<ComparisonData>
  if (!data.competitorName?.trim()) return null
  if (!Array.isArray(data.rows) || data.rows.length === 0) return null
  const rows = data.rows
    .filter((row) => row && typeof row.dimension === "string" && row.dimension.trim())
    .map((row) => ({
      dimension: row.dimension.trim(),
      atai: typeof row.atai === "string" ? row.atai : "",
      competitor: typeof row.competitor === "string" ? row.competitor : "",
      evidence: row.evidence?.trim() || undefined,
      lastChecked: row.lastChecked?.trim() || undefined,
      note: row.note?.trim() || undefined,
    }))
  if (!rows.length) return null
  return {
    competitorName: data.competitorName.trim(),
    competitorUrl: data.competitorUrl?.trim() || undefined,
    competitorDescription: data.competitorDescription?.trim() || undefined,
    positioning: data.positioning?.trim() || undefined,
    rows,
    lastReviewed: data.lastReviewed?.trim() || undefined,
    limitations: data.limitations?.trim() || undefined,
  }
}

/** All blog post slugs on disk. */
function blogSlugs(): string[] {
  try {
    return fs
      .readdirSync(BLOG_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
  } catch {
    return []
  }
}

/** One post by slug, or null if it doesn't exist. */
function getBlogPost(slug: string): BlogPost | null {
  try {
    const raw = fs.readFileSync(path.join(BLOG_DIR, `${slug}.md`), "utf8")
    return toPost(slug, raw)
  } catch {
    return null
  }
}

/** All posts, newest first. */
export function listBlogPosts(): BlogPost[] {
  return blogSlugs()
    .map((slug) => getBlogPost(slug))
    .filter((p): p is BlogPost => p !== null)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
