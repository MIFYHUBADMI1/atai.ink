import { z } from "zod"
import {
  RESOURCE_CATEGORIES,
  RESOURCE_FORMATS,
  RESOURCE_TYPES,
} from "@/lib/resources/types"
import { isHttpsUrl, youTubeVideoId } from "@/lib/resources/media"

const optionalHttpsUrl = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => value || undefined)
  .refine((value) => value === undefined || isHttpsUrl(value), "Use a secure https:// URL.")

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined)

const tagList = z
  .array(z.string().trim().min(1).max(60))
  .max(20)
  .optional()
  .transform((value) => value ?? [])

const fileSchema = z.object({
  url: z.string().trim().max(2000).refine(isHttpsUrl, "Use a secure https:// file URL."),
  name: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(120),
  size: z.number().int().min(0).max(25 * 1024 * 1024),
  provider: z.enum(["imagekit", "external"]),
})

export const resourceInputSchema = z.object({
  title: z.string().trim().min(3, "Give the resource a title.").max(160),
  slug: optionalText(80),
  category: z.enum(RESOURCE_CATEGORIES),
  type: z.enum(RESOURCE_TYPES),
  format: z.enum(RESOURCE_FORMATS),
  description: z.string().trim().min(20, "Describe the resource in at least 20 characters.").max(400),
  topics: tagList,
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  readingMinutes: z.number().int().min(1).max(180),
  contentMarkdown: optionalText(200_000),
  imageUrl: optionalHttpsUrl,
  youtubeUrl: optionalHttpsUrl.refine(
    (value) => value === undefined || youTubeVideoId(value) !== null,
    "Use a YouTube, YouTube Shorts, or youtu.be video URL.",
  ),
  externalUrl: optionalHttpsUrl,
  file: fileSchema.optional(),
  seoTitle: optionalText(70),
  seoDescription: optionalText(180),
  keywords: tagList,
  related: tagList,
  featured: z.boolean(),
  status: z.enum(["draft", "published", "archived"]),
  publishedAt: optionalText(10),
})

export type ResourceInput = z.infer<typeof resourceInputSchema>
