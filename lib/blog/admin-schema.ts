import { z } from "zod"
import { isHttpsUrl } from "@/lib/resources/media"

/**
 * Optional fields are stored either as an absent key or — in documents
 * written before the driver was configured to omit `undefined` — as an
 * explicit `null`. Both are accepted and normalised to `undefined`, so an
 * older document never 422s the next time an admin saves it.
 */
const optionalHttpsUrl = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((value) => value || undefined)
  .refine((value) => value === undefined || isHttpsUrl(value), "Use a secure https:// URL.")

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || undefined)

const optionalNumber = z
  .number()
  .int()
  .min(0)
  .nullish()
  .transform((value) => value ?? undefined)

const tagList = z
  .array(z.string().trim().min(1).max(60))
  .max(24)
  .nullish()
  .transform((value) => value ?? [])

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only.")

const authorSchema = z.object({
  name: z.string().trim().min(2, "Add the author name.").max(120),
  role: optionalText(120),
  bio: optionalText(600),
  url: optionalHttpsUrl,
  imageUrl: optionalHttpsUrl,
})

const comparisonRowSchema = z.object({
  dimension: z.string().trim().min(1).max(160),
  atai: z.string().trim().max(1000),
  competitor: z.string().trim().max(1000),
  evidence: optionalText(2000),
  lastChecked: optionalText(10),
  note: optionalText(600),
})

/** A comparison that says anything at all — a row, a claim, a caveat. */
function hasComparisonContent(value: {
  competitorUrl?: string
  competitorDescription?: string
  positioning?: string
  limitations?: string
  rows: { dimension: string }[]
}): boolean {
  return (
    value.rows.length > 0 ||
    Boolean(
      value.positioning?.trim() ||
        value.limitations?.trim() ||
        value.competitorDescription?.trim() ||
        value.competitorUrl?.trim(),
    )
  )
}

const comparisonSchema = z
  .object({
    competitorName: z.string().trim().max(120),
    competitorUrl: optionalHttpsUrl,
    competitorDescription: optionalText(1000),
    positioning: optionalText(2000),
    rows: z.array(comparisonRowSchema).max(60),
    lastReviewed: optionalText(10),
    limitations: optionalText(2000),
  })
  .nullish()
  .transform((value) => {
    if (!value) return undefined
    const competitorName = value.competitorName.trim()
    // An empty shell is stored as no comparison at all — there is nothing to
    // show and nothing to lose.
    if (!competitorName && !hasComparisonContent(value)) return undefined
    return { ...value, competitorName }
  })
  .superRefine((value, ctx) => {
    if (!value) return
    // A comparison the admin actually filled in is never dropped: without a
    // competitor name it is rejected, so the rows cannot disappear silently
    // on save.
    if (!value.competitorName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["competitorName"],
        message: "Name the competitor, or clear the comparison you started.",
      })
    }
  })

const seoSchema = z
  .object({
    title: optionalText(70),
    description: optionalText(180),
    canonical: optionalHttpsUrl,
    ogTitle: optionalText(120),
    ogDescription: optionalText(300),
    ogImage: optionalHttpsUrl,
    focusKeyword: optionalText(120),
    secondaryKeywords: tagList,
    noindex: z.boolean().nullish().transform((value) => value ?? undefined),
  })
  .nullish()
  .transform((value) => value ?? {})

export const blogArticleInputSchema = z.object({
  title: z.string().trim().min(3, "Give the article a title.").max(200),
  slug: optionalText(120).refine(
    (value) => value === undefined || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
    "Use lowercase letters, numbers and hyphens only.",
  ),
  description: z.string().trim().min(20, "Write a meta description of at least 20 characters.").max(320),
  excerpt: optionalText(500),
  body: z.string().max(400_000).nullish().transform((value) => value ?? ""),
  category: z.string().trim().min(1).max(80),
  tags: tagList,
  author: authorSchema,
  competitor: optionalText(120),
  comparison: comparisonSchema,
  featuredImage: z
    .object({
      url: z.string().trim().max(2000).refine(isHttpsUrl, "Use a secure https:// image URL."),
      alt: z.string().trim().min(1, "Describe the image for accessibility.").max(300),
    })
    .nullish()
    .transform((value) => value ?? undefined),
  seo: seoSchema,
  status: z.enum(["draft", "review", "scheduled", "published", "archived"]),
  featured: z.boolean().nullish().transform((value) => value ?? false),
  relatedSlugs: z.array(z.string().trim().max(120)).max(12).nullish().transform((value) => value ?? []),
  publishedAt: optionalText(10),
  scheduledFor: optionalNumber,
})

export const blogCategoryInputSchema = z.object({
  name: z.string().trim().min(2, "Give the category a name.").max(80),
  slug: optionalText(80).refine(
    (value) => value === undefined || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
    "Use lowercase letters, numbers and hyphens only.",
  ),
  description: optionalText(400),
  seoTitle: optionalText(70),
  seoDescription: optionalText(180),
  order: z.number().int().min(0).max(1000).nullish().transform((value) => value ?? undefined),
})

export const blogRedirectInputSchema = z.object({
  from: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value.startsWith("/blog/"), "Redirects must start with /blog/."),
  toSlug: slugSchema,
  reason: optionalText(300),
})

export const blogSettingsInputSchema = z.object({
  indexNowEnabled: z.boolean().optional(),
  newsletterAutoAnnounce: z.boolean().optional(),
  gscVerification: optionalText(200),
  bingVerification: optionalText(200),
})

export const blogPublishInputSchema = z.object({
  action: z.enum(["publish", "schedule", "unpublish", "archive", "restore", "review"]),
  scheduledFor: optionalNumber,
})

export const blogNewsletterInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  // The source names where the signup came from — `article:<slug>` is the
  // longest form, so the cap has to fit a full slug plus its prefix.
  source: optionalText(200),
})

export const blogAnnouncementInputSchema = z.object({
  articleId: z.string().trim().min(1, "Choose an article to announce.").max(120),
})

export const blogViewInputSchema = z.object({
  slug: z.string().trim().min(1).max(120),
})