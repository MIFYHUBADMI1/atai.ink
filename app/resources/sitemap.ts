import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/env"
import { RESOURCE_CATEGORIES } from "@/lib/resources"
import { publicSummaries } from "@/lib/resources/store"
import { resourceFormat, youTubeEmbedUrl, youTubeThumbnailUrl } from "@/lib/resources/media"

/**
 * Dedicated resources sitemap served at /resources/sitemap.xml.
 * Includes published admin resources and the editorial catalog, with video and
 * image extensions so crawlers can discover media resources directly.
 */
export const dynamic = "force-dynamic"

function lastModified(value: string | undefined) {
  if (!value) return new Date()
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const resources = await publicSummaries()
  const latest = resources.map((resource) => resource.updatedAt).sort().at(-1)

  const entries: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/resources`,
      lastModified: lastModified(latest),
      changeFrequency: "daily",
      priority: 0.95,
    },
    ...RESOURCE_CATEGORIES.map((category) => {
      const categoryLatest = resources
        .filter((resource) => resource.category === category)
        .map((resource) => resource.updatedAt)
        .sort()
        .at(-1)
      return {
        url: `${SITE_URL}/resources/${category}`,
        lastModified: lastModified(categoryLatest),
        changeFrequency: "weekly" as const,
        priority: 0.8,
      }
    }),
    ...resources.map((resource) => {
      const format = resourceFormat(resource)
      const thumbnail = youTubeThumbnailUrl(resource.youtubeUrl)
      const embed = youTubeEmbedUrl(resource.youtubeUrl)
      const images = resource.imageUrl ? [resource.imageUrl] : undefined
      const videos =
        format === "video" && thumbnail
          ? [
              {
                title: resource.title,
                thumbnail_loc: thumbnail,
                description: resource.description,
                player_loc: embed ?? resource.youtubeUrl,
                publication_date: resource.publishedAt,
              },
            ]
          : undefined
      return {
        url: `${SITE_URL}${resource.href}`,
        lastModified: lastModified(resource.updatedAt),
        changeFrequency: resource.category === "glossary" ? ("monthly" as const) : ("weekly" as const),
        priority: resource.featured ? 0.85 : 0.7,
        images,
        videos,
      }
    }),
  ]

  return entries
}
