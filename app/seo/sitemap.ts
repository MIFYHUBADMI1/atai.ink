import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/env"
import { publicArticles, publicCategories } from "@/lib/blog/store"

type Freq = MetadataRoute.Sitemap[number]["changeFrequency"]

/**
 * Second sitemap: the knowledge and long-tail surface (docs, developer content,
 * marketing, and legal pages). Resources live in /resources/sitemap.xml so each
 * published resource has exactly one canonical sitemap entry.
 * Served at /seo/sitemap.xml and listed in /robots.txt next to /sitemap.xml.
 * Authenticated product surfaces (admin, api, settings, billing, projects) stay out.
 *
 * Blog articles and category pages are enumerated from the published set, so
 * drafts, archived and noindex articles never appear here.
 */

const knowledgePages: Array<{ path: string; changeFrequency: Freq; priority: number }> = [
  { path: "/docs", changeFrequency: "weekly", priority: 0.95 },
  { path: "/docs/onboarding", changeFrequency: "weekly", priority: 0.95 },
  { path: "/docs/runtime-api", changeFrequency: "weekly", priority: 0.85 },
  { path: "/docs/database-manager", changeFrequency: "weekly", priority: 0.85 },
  { path: "/docs/growth-marketing", changeFrequency: "weekly", priority: 0.8 },
  { path: "/docs/troubleshooting", changeFrequency: "weekly", priority: 0.9 },
  { path: "/developers", changeFrequency: "weekly", priority: 0.85 },
  { path: "/sdk", changeFrequency: "weekly", priority: 0.8 },
  { path: "/lessons", changeFrequency: "weekly", priority: 0.6 },
]

const marketingPages: Array<{ path: string; changeFrequency: Freq; priority: number }> = [
  { path: "/start", changeFrequency: "weekly", priority: 0.7 },
  { path: "/new", changeFrequency: "monthly", priority: 0.6 },
  { path: "/new/idea", changeFrequency: "monthly", priority: 0.6 },
  { path: "/new/github", changeFrequency: "monthly", priority: 0.6 },
  { path: "/new/website", changeFrequency: "monthly", priority: 0.6 },
  { path: "/explore", changeFrequency: "daily", priority: 0.65 },
  { path: "/modes-comparison", changeFrequency: "monthly", priority: 0.6 },
  { path: "/pricing", changeFrequency: "weekly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.55 },
  { path: "/founder", changeFrequency: "monthly", priority: 0.55 },
  { path: "/feature-requests", changeFrequency: "weekly", priority: 0.5 },
]

const trustPages: Array<{ path: string; changeFrequency: Freq; priority: number }> = [
  { path: "/terms", changeFrequency: "monthly", priority: 0.35 },
  { path: "/privacy", changeFrequency: "monthly", priority: 0.35 },
  { path: "/refund-policy", changeFrequency: "monthly", priority: 0.3 },
  { path: "/database-terms", changeFrequency: "monthly", priority: 0.3 },
  { path: "/login", changeFrequency: "yearly", priority: 0.25 },
  { path: "/register", changeFrequency: "yearly", priority: 0.3 },
]

function asEntry(path: string, changeFrequency: Freq, priority: number, lastModified?: Date) {
  return {
    url: path === "/" ? SITE_URL : `${SITE_URL}${path}`,
    lastModified: lastModified ?? new Date(),
    changeFrequency,
    priority,
  } satisfies MetadataRoute.Sitemap[number]
}

/** The article's last edit date, when it has a usable one. */
function articleDate(article: { updatedAt?: string; publishedAt?: string }): Date | undefined {
  const raw = article.updatedAt || article.publishedAt
  if (!raw) return undefined
  const parsed = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, categories] = await Promise.all([publicArticles(), publicCategories()])

  // Only published, indexable articles are listed — one canonical entry each.
  const blogPosts = articles
    .filter((article) => !article.seo?.noindex)
    .map((article) =>
      asEntry(
        `/blog/${article.slug}`,
        "monthly",
        0.75,
        articleDate(article),
      ),
    )

  const categoryPages = categories.map((category) =>
    asEntry(`/blog/category/${category.slug}`, "weekly", 0.6),
  )

  return [
    ...knowledgePages.map((page) => asEntry(page.path, page.changeFrequency, page.priority)),
    ...marketingPages.map((page) => asEntry(page.path, page.changeFrequency, page.priority)),
    ...trustPages.map((page) => asEntry(page.path, page.changeFrequency, page.priority)),
    ...categoryPages,
    ...blogPosts,
  ]
}
