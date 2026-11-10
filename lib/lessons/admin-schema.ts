import { z } from "zod"
import { LESSON_FORMATS, LESSON_STAGES } from "@/lib/lessons/types"
import { LESSON_CATEGORY_FALLBACK, LESSON_CATEGORY_SEED } from "@/lib/lessons/taxonomy"
import { isHttpsUrl, youTubeVideoId } from "@/lib/resources/media"

const lessonCategoryIds = LESSON_CATEGORY_SEED.map((category) => category.id) as [string, ...string[]]

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

export const lessonObjectSchema = z.object({
  title: z.string().trim().min(3, "Give the lesson a title.").max(160),
  slug: optionalText(80),
  stage: z.enum(LESSON_STAGES),
  categoryId: z.enum(lessonCategoryIds).default(LESSON_CATEGORY_FALLBACK),
  format: z.enum(LESSON_FORMATS),
  summary: z.string().trim().min(20, "Describe the lesson in at least 20 characters.").max(400),
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
  featured: z.boolean(),
  status: z.enum(["draft", "published", "archived"]),
  publishedAt: optionalText(10),
})

export const lessonInputSchema = lessonObjectSchema
  .refine(
    (value) =>
      value.format !== "article" || Boolean(value.contentMarkdown),
    "Write the lesson content or paste a document for article lessons.",
  )
  .refine(
    (value) => value.format !== "video" || Boolean(value.youtubeUrl),
    "Add a YouTube URL for video lessons.",
  )
  .refine(
    (value) => value.format !== "file" || Boolean(value.file),
    "Upload a document or PDF for file lessons.",
  )
  .refine(
    (value) => value.format !== "image" || Boolean(value.imageUrl),
    "Add an image URL or upload an image for image lessons.",
  )

export type LessonInput = z.infer<typeof lessonInputSchema>
