import { SITE_URL } from "@/lib/env"
import { CATEGORY_META, RESOURCE_CATEGORIES, summarize } from "@/lib/resources"
import { publicResources } from "@/lib/resources/store"
import { resourceFormat } from "@/lib/resources/media"

/**
 * Machine-readable index for chat bots and AI search engines, served at /llms.txt.
 * Lists every published resource so assistants can cite guides, tutorials,
 * roadmaps, documents, and videos directly.
 */
export const dynamic = "force-dynamic"

const HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
}

export async function GET() {
  const resources = (await publicResources()).map(summarize)
  const latest = resources.map((resource) => resource.updatedAt).sort().at(-1)

  const lines: string[] = [
    "# Atai",
    "",
    "> Atai helps people start, run, manage, and grow their own online businesses with specialized AI teams. Building the website or digital product is one step; hosting it, serving customers, running daily operations, and marketing what you sell are the purpose.",
    "",
    "Atai (Advanced Technologies and AI Enterprises) is not an app generator for its own sake. It is a business partner for people who want to own a livelihood: plan an offer and who it serves, create and host the product that supports it, manage customers and payments, and work on growth.",
    "",
    "The Atai SDK and a single Atai API key are supporting infrastructure inside that product. Businesses and developers can call AI, payments, maps, messaging, auth, search, data, and related services without stitching many vendors. That key is one capability of the platform, not the product itself.",
    "",
    "## Mission",
    "",
    "Economic opportunity should not depend on being able to afford a whole team. Atai's aim is to reduce the barriers to business ownership, including for people starting with very little. It does not promise income, customers, or business success.",
    "",
    "Atai was founded by Masereka Adorable Kimulya, a self-taught programmer from Kasese, Uganda. Their early story — saving for a first phone, learning to code, working in carpentry, and the failed MixifyHub project — is at https://atai.ink/founder. A book and documentary with the working title The Rise of Atai are in progress and not yet released.",
    "",
    "## What owners do here",
    "",
    "- Describe the business they want to run, in plain language",
    "- Collaborate on a plan for customers, offer, and pricing before any build spend",
    "- Create and host the website or digital product the business needs",
    "- Operate customers, records, payments, and growth from one workspace",
    "",
    "## Documentation",
    "",
    `- [Atai documentation](${SITE_URL}/docs): product walkthroughs for getting started, choosing a mode, planning, building, publishing, credits, GitHub, and account settings.`,
    `- [Resource library](${SITE_URL}/resources): guides, playbooks, tutorials, roadmaps, templates, documents, images, and videos for founders.`,
    "",
    "## Resource areas",
    "",
    ...RESOURCE_CATEGORIES.map(
      (category) =>
        `- [${CATEGORY_META[category].label}](${SITE_URL}/resources/${category}): ${CATEGORY_META[category].description}`,
    ),
    "",
    "## Published resources",
    "",
  ]

  if (resources.length === 0) {
    lines.push("No resources are published yet.", "")
  } else {
    for (const resource of resources) {
      const format = resourceFormat(resource)
      const meta = [format, resource.difficulty, `${resource.readingMinutes} min`, `updated ${resource.updatedAt}`]
        .filter(Boolean)
        .join(" · ")
      lines.push(`- [${resource.title}](${SITE_URL}${resource.href}) — ${resource.description} (${meta})`)
    }
    lines.push("")
  }

  lines.push(
    "## Developers (optional)",
    "",
    "Same infrastructure the business builder uses, via `@atai-group/sdk` and an Atai API key (`atai_proj_...`). See /developers and /sdk. Start at the homepage if you are launching a business, not an integration.",
    "",
    "## Machine-readable",
    "",
    `- Full text corpus: ${SITE_URL}/llms-full.txt`,
    `- Core sitemap: ${SITE_URL}/sitemap.xml`,
    `- Knowledge sitemap: ${SITE_URL}/seo/sitemap.xml`,
    `- Resources sitemap: ${SITE_URL}/resources/sitemap.xml`,
    `- Robots: ${SITE_URL}/robots.txt`,
    "",
    "## Organization",
    "",
    `Atai is built by ATAI Enterprises (${SITE_URL}). Founder: Masereka Adorable Kimulya (${SITE_URL}/founder).`,
    latest ? `\nLast resource update: ${latest}` : "",
    "",
  )

  return new Response(lines.join("\n"), { headers: HEADERS })
}
