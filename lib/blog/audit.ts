import type { BlogArticleDoc, BlogAuditFinding, BlogAuditReport } from "@/lib/blog/types"
import { extractLinks, markdownToc, wordCount } from "@/lib/blog/content"

interface AuditContext {
  /** Other articles, for duplicate detection. */
  others?: { slug: string; title: string; description: string }[]
  /** Known internal paths that should exist (kept cheap: prefix checks). */
  nowMs?: number
}

const DAY_MS = 86_400_000

/** Rule-based content + SEO audit. Produces specific findings with fixes —
 * never a generic green score, and never a ranking promise. */
export function auditArticle(
  article: Pick<
    BlogArticleDoc,
    "id" | "slug" | "title" | "description" | "excerpt" | "body" | "author" | "featuredImage" | "seo" | "competitor" | "comparison" | "publishedAt" | "tags"
  >,
  context: AuditContext = {},
): BlogAuditReport {
  const findings: BlogAuditFinding[] = []
  const add = (code: string, severity: BlogAuditFinding["severity"], message: string, fix: string) =>
    findings.push({ code, severity, message, fix })

  const words = wordCount(article.body)
  const now = context.nowMs ?? Date.now()

  // ---- Content quality -------------------------------------------------
  if (!article.title || article.title.trim().length < 3) {
    add("missing-title", "error", "The article has no usable title.", "Add a descriptive headline.")
  }
  if (words < 300) {
    add("thin-content", "warning", `The article is thin (${words} words).`, "Expand it with genuinely useful detail; avoid publishing filler.")
  }
  if (!article.author?.name?.trim()) {
    add("missing-author", "error", "No author is attached.", "Set an author name (and role/bio) so readers and crawlers see who wrote this.")
  }
  if (!article.excerpt?.trim()) {
    add("missing-excerpt", "warning", "No excerpt for cards and social previews.", "Write a 1–2 sentence excerpt.")
  }
  if (!article.featuredImage?.url) {
    add("missing-featured-image", "warning", "No featured image.", "Upload a featured image with descriptive alt text.")
  } else if (!article.featuredImage.alt?.trim()) {
    add("missing-image-alt", "warning", "The featured image has no alt text.", "Describe the image for accessibility and image search.")
  }

  const links = extractLinks(article.body)
  if (!links.some((link) => link.internal)) {
    add("no-internal-links", "warning", "No internal links to other Atai content.", "Link related articles and relevant product pages (/pricing, /start, /docs…).")
  }
  for (const link of links) {
    if (/^https?:\/\//i.test(link.href) && /\s/.test(link.href)) {
      add("broken-link", "warning", `Link looks malformed: ${link.href}`, "Fix or remove the broken URL.")
    }
  }

  const duplicateTitle = context.others?.find(
    (other) => other.slug !== article.slug && other.title.trim().toLowerCase() === article.title.trim().toLowerCase(),
  )
  if (duplicateTitle) {
    add("duplicate-title", "warning", `Title duplicates "${duplicateTitle.slug}".`, "Differentiate the headline or merge the articles.")
  }
  const duplicateDescription = context.others?.find(
    (other) => other.slug !== article.slug && other.description.trim().toLowerCase() === article.description.trim().toLowerCase(),
  )
  if (duplicateDescription) {
    add("duplicate-meta", "warning", `Meta description duplicates "${duplicateDescription.slug}".`, "Write a unique meta description for this article.")
  }

  // ---- Comparison verification -----------------------------------------
  if (article.competitor || article.comparison) {
    const comparison = article.comparison
    if (!comparison || comparison.rows.length === 0) {
      add("comparison-empty", "warning", "Marked as a comparison but no structured comparison table exists.", "Add evaluated dimensions with evidence, or remove the competitor tag.")
    } else {
      const unsupported = comparison.rows.filter((row) => row.competitor.trim() && !row.evidence?.trim())
      if (unsupported.length) {
        add(
          "unsupported-claims",
          "error",
          `${unsupported.length} comparison row(s) about ${comparison.competitorName} have no evidence: ${unsupported.map((row) => row.dimension).join(", ")}.`,
          "Add a source URL or verification note for every competitor claim. Never publish unsupported superiority claims.",
        )
      }
      const stale = comparison.rows.filter((row) => {
        if (!row.lastChecked) return false
        const checked = Date.parse(row.lastChecked)
        return Number.isFinite(checked) && now - checked > 90 * DAY_MS
      })
      if (stale.length) {
        add("stale-claims", "warning", `${stale.length} comparison row(s) were verified over 90 days ago.`, "Re-check pricing/features on the vendor site and update the verification date.")
      }
      const undated = comparison.rows.filter((row) => row.competitor.trim() && !row.lastChecked)
      if (undated.length) {
        add("undated-claims", "warning", `${undated.length} comparison row(s) have no last-checked date.`, "Record when each claim was verified so readers can judge freshness.")
      }
      if (!comparison.lastReviewed) {
        add("comparison-undated", "info", "The comparison has no overall review date.", "Set the date the comparison was last reviewed.")
      }
    }
    if (!/faq|frequently asked questions/i.test(article.body)) {
      add("comparison-no-faq", "info", "Comparison articles answer searcher questions well with an FAQ.", "Consider a short FAQ section (## Frequently asked questions).")
    }
  }

  // ---- SEO quality ------------------------------------------------------
  const description = article.seo?.description?.trim() || article.description.trim()
  if (!description) {
    add("missing-meta-description", "error", "No meta description.", "Write a unique 50–160 character meta description.")
  } else if (description.length < 50) {
    add("short-meta-description", "warning", `Meta description is short (${description.length} chars).`, "Aim for 50–160 characters so search snippets are useful.")
  } else if (description.length > 160) {
    add("long-meta-description", "warning", `Meta description is long (${description.length} chars) and may be truncated.`, "Trim it to about 160 characters.")
  }
  if (!article.seo?.title?.trim() && !article.title.trim()) {
    add("missing-seo-title", "error", "No SEO title.", "Set a unique SEO title under 70 characters.")
  }
  if (/^#\s+/m.test(article.body)) {
    add("duplicate-h1", "warning", "The body contains an H1; the article title already renders as the page H1.", "Start the body at H2 (##) so there is exactly one H1.")
  }
  // Level 4 is included so a skipped step (H2 → H4) is actually detectable.
  const toc = markdownToc(article.body, 4)
  if (article.body.trim() && toc.length === 0 && words > 400) {
    add("no-headings", "warning", "A long article without H2/H3 sections is hard to scan.", "Break it into descriptive sections; crawlers and readers both use them.")
  }
  const levels = toc.map((entry) => entry.level)
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      add("heading-hierarchy", "info", "Heading levels skip a step (e.g. H2 → H4).", "Keep a logical heading hierarchy for accessibility and structure.")
      break
    }
  }
  const imagesWithoutAlt = [...article.body.matchAll(/!\[\s*\]\([^)]*\)/g)]
  if (imagesWithoutAlt.length) {
    add("body-image-alt", "warning", `${imagesWithoutAlt.length} body image(s) have empty alt text.`, "Describe every image.")
  }
  if (article.seo?.noindex) {
    add("noindex", "info", "This article is marked noindex.", "It will stay out of search results and the sitemap until you clear the flag.")
  }
  if (!article.publishedAt) {
    add("missing-date", "warning", "No publication date.", "Set the publication date; it appears in the byline and structured data.")
  }
  if (article.tags.length === 0) {
    add("no-tags", "info", "No tags.", "Add 2–5 tags so related content and topic pages can surface this article.")
  }

  const penalty = findings.reduce((sum, finding) => sum + (finding.severity === "error" ? 12 : finding.severity === "warning" ? 6 : 2), 0)
  return {
    articleId: article.id,
    slug: article.slug,
    title: article.title,
    findings,
    score: Math.max(0, 100 - penalty),
    wordCount: words,
    generatedAtMs: now,
  }
}