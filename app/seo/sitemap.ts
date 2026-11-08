import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/env"

type Freq = MetadataRoute.Sitemap[number]["changeFrequency"]

/**
 * Second sitemap: the knowledge and long-tail surface (docs, developer content,
 * marketing, and legal pages). Resources live in /resources/sitemap.xml so each
 * published resource has exactly one canonical sitemap entry.
 * Served at /seo/sitemap.xml and listed in /robots.txt next to /sitemap.xml.
 * Authenticated product surfaces (admin, api, settings, billing, projects) stay out.
 */

const knowledgePages: Array<{ path: string; changeFrequency: Freq; priority: number }> = [
  { path: "/docs", changeFrequency: "weekly", priority: 0.95 },
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

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...knowledgePages.map((page) => asEntry(page.path, page.changeFrequency, page.priority)),
    ...marketingPages.map((page) => asEntry(page.path, page.changeFrequency, page.priority)),
    ...trustPages.map((page) => asEntry(page.path, page.changeFrequency, page.priority)),
  ]
}
