import { SITE_URL } from "@/lib/env"
import fs from "node:fs"
import path from "node:path"
import { CATEGORY_META, FORMAT_LABEL, TYPE_LABEL } from "@/lib/resources"
import { publicResources } from "@/lib/resources/store"
import { resourceBlocksToMarkdown, resourceFormat, formatFileSize } from "@/lib/resources/media"
import type { Resource } from "@/lib/resources/types"
import { publicArticles } from "@/lib/blog/store"

/**
 * Full machine-readable corpus served at /llms-full.txt. Every published
 * resource is included in full so AI assistants and search engines can read
 * and cite the guidance without scraping individual pages.
 */
export const dynamic = "force-dynamic"

const HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
}

const DOC_SECTIONS = [
  ["getting-started", "Getting Started"],
  ["how-it-works", "How It Works"],
  ["pipeline-modes", "Atai Standard & Pro"],
  ["website-mode", "Website Mode"],
  ["idea-mode", "Idea Mode"],
  ["collaborate", "Collaborate & Refine Plan"],
  ["understanding", "Understanding & Planning"],
  ["editing-your-plan", "Editing Your Plan"],
  ["building", "Building Your Application"],
  ["database-manager", "Database Manager"],
  ["workspace", "Working With Your App"],
  ["publishing", "Publishing & Domains"],
  ["github", "GitHub Integration"],
  ["credits", "Credits & Billing"],
  ["appearance", "Themes & Appearance"],
  ["account", "Account & Settings"],
  ["faq", "Frequently Asked Questions"],
] as const

function resourceBody(resource: Resource): string {
  if (resource.contentMarkdown) return resource.contentMarkdown.trim()
  if (resource.body.length > 0) return resourceBlocksToMarkdown(resource.body)
  const lines: string[] = []
  if (resource.youtubeUrl) lines.push(`Video: ${resource.youtubeUrl}`)
  if (resource.externalUrl) lines.push(`External resource: ${resource.externalUrl}`)
  if (resource.file) {
    lines.push(
      `Download: ${resource.file.url} (${resource.file.name}, ${resource.file.mimeType}${resource.file.size ? `, ${formatFileSize(resource.file.size)}` : ""})`,
    )
  }
  if (resource.imageUrl) lines.push(`Image: ${resource.imageUrl}`)
  return lines.join("\n")
}

export async function GET() {
  const resources = await publicResources()
  const latest = resources.map((resource) => resource.updatedAt).sort().at(-1)
  const posts = await publicArticles()

  // The extended onboarding guide is the canonical end-to-end manual. Include
  // it in full so AI assistants and search engines get the complete picture
  // of how Atai works without scraping individual product pages.
  let onboardingGuide = ""
  try {
    onboardingGuide = fs
      .readFileSync(path.join(process.cwd(), "docs", "ONBOARDING_GUIDE.md"), "utf8")
      .trim()
  } catch {
    onboardingGuide = `(The extended onboarding guide could not be loaded here. Read it at ${SITE_URL}/docs/onboarding.)`
  }
  const onboardingLines = onboardingGuide.split(/\r?\n/)

  const loadDoc = (file: string, fallbackUrl: string): string[] => {
    try {
      return fs.readFileSync(path.join(process.cwd(), "docs", file), "utf8").trim().split(/\r?\n/)
    } catch {
      return [`(The guide at ${fallbackUrl} could not be loaded here. Read it at ${fallbackUrl}.)`]
    }
  }
  const runtimeLines = loadDoc("RUNTIME_API_SDK_KEYS.md", `${SITE_URL}/docs/runtime-api`)
  const dbLines = loadDoc("DATABASE_MANAGER.md", `${SITE_URL}/docs/database-manager`)
  const growthLines = loadDoc("GROWTH_MARKETING_PLAYBOOK.md", `${SITE_URL}/docs/growth-marketing`)
  const troubleshootingLines = loadDoc("TROUBLESHOOTING_USER.md", `${SITE_URL}/docs/troubleshooting`)

  const lines: string[] = [
    "# Atai — full knowledge corpus",
    "",
    "> Atai helps people start, run, manage, and grow their own online businesses with specialized AI teams. This file is the complete text of the public documentation and resource library for people and AI assistants.",
    "",
    `Canonical site: ${SITE_URL}`,
    `Founder: Masereka Adorable Kimulya (${SITE_URL}/founder)`,
    latest ? `Latest resource update: ${latest}` : "",
    "",
    "## Documentation",
    "",
    `The Atai documentation is one page with anchored sections: ${SITE_URL}/docs`,
    "",
    ...DOC_SECTIONS.map(([id, label]) => `- ${label}: ${SITE_URL}/docs#${id}`),
    "",
    "## Extended onboarding guide (canonical end-to-end manual)",
    "",
    `The most complete, authoritative guide to using Atai is the extended onboarding guide. Canonical URL: ${SITE_URL}/docs/onboarding`,
    "It covers what Atai is, how to start, plan, build, publish, operate, grow and scale a business, plus checklists, a glossary, and solutions to common problems.",
    "",
    "### Full text of the onboarding guide",
    "",
    ...onboardingLines,
    "",
    "## Runtime API, SDK & API Keys (extended doc)",
    "",
    `Canonical URL: ${SITE_URL}/docs/runtime-api`,
    "",
    ...runtimeLines,
    "",
    "## Database Manager handbook (extended doc)",
    "",
    `Canonical URL: ${SITE_URL}/docs/database-manager`,
    "",
    ...dbLines,
    "",
    "## Growth & marketing playbook (extended doc)",
    "",
    `Canonical URL: ${SITE_URL}/docs/growth-marketing`,
    "",
    ...growthLines,
    "",
    "## Troubleshooting & error reference (extended doc)",
    "",
    `Canonical URL: ${SITE_URL}/docs/troubleshooting`,
    "",
    ...troubleshootingLines,
    "",
    "## Blog & comparisons",
    "",
    `The Atai blog publishes independent comparisons of Atai with other AI app builders, plus founder guides. Canonical index: ${SITE_URL}/blog`,
    "",
    ...posts.flatMap((post) => [
      "---",
      "",
      `### ${post.title}`,
      "",
      `URL: ${SITE_URL}/blog/${post.slug}`,
      `Published: ${post.publishedAt}${post.updatedAt && post.updatedAt !== post.publishedAt ? ` · Updated: ${post.updatedAt}` : ""} · Reading time: ${post.readingMinutes} min`,
      post.tags.length ? `Topics: ${post.tags.join(", ")}` : "",
      "",
      post.description,
      "",
      post.body,
      "",
    ]),
    "## Resources",
    "",
  ]

  if (resources.length === 0) {
    lines.push("No resources are published yet.", "")
  }

  for (const resource of resources) {
    const format = resourceFormat(resource)
    lines.push(
      "---",
      "",
      `### ${resource.title}`,
      "",
      `URL: ${SITE_URL}/resources/${resource.category}/${resource.slug}`,
      `Category: ${CATEGORY_META[resource.category].label} · Type: ${TYPE_LABEL[resource.type]} · Format: ${FORMAT_LABEL[format]}`,
      `Difficulty: ${resource.difficulty} · Reading time: ${resource.readingMinutes} min · Published: ${resource.publishedAt} · Updated: ${resource.updatedAt}`,
      resource.topics.length > 0 ? `Topics: ${resource.topics.join(", ")}` : "",
      resource.keywords && resource.keywords.length > 0 ? `Keywords: ${resource.keywords.join(", ")}` : "",
      "",
      resource.description,
      "",
    )
    const body = resourceBody(resource)
    if (body) lines.push(body, "")
  }

  lines.push(
    "## Machine-readable",
    "",
    `- Machine index: ${SITE_URL}/llms.txt`,
    `- Core sitemap: ${SITE_URL}/sitemap.xml`,
    `- Knowledge sitemap: ${SITE_URL}/seo/sitemap.xml`,
    `- Resources sitemap: ${SITE_URL}/resources/sitemap.xml`,
    `- Robots: ${SITE_URL}/robots.txt`,
    "",
  )

  return new Response(lines.filter((line) => line !== undefined).join("\n"), { headers: HEADERS })
}
