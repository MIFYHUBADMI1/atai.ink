import type { ObjectId } from "mongodb"

/** Publishing lifecycle for platform blog articles (Atai Insights). */
export const BLOG_STATUSES = ["draft", "review", "scheduled", "published", "archived"] as const
export type BlogStatus = (typeof BLOG_STATUSES)[number]

/** Default editorial pillars. Admins can add more from the Content Studio. */
export const DEFAULT_BLOG_CATEGORIES = [
  { slug: "business-building", name: "Business Building", description: "Ideas, validation, launching and entrepreneurship." },
  { slug: "ai-technology", name: "AI & Technology", description: "AI builders, software development and automation." },
  { slug: "comparisons", name: "Comparisons & Alternatives", description: "Atai vs Lovable, Bolt, Replit and other platforms." },
  { slug: "business-management", name: "Business Management", description: "Operations, finances and running the business." },
  { slug: "marketing-growth", name: "Marketing & Growth", description: "Customer acquisition, advertising and scaling." },
  { slug: "entrepreneurship", name: "Entrepreneurship", description: "Startup mistakes, validation and business models." },
  { slug: "product-education", name: "Product Education", description: "How Atai works — features and capabilities." },
  { slug: "tutorials-guides", name: "Tutorials & Guides", description: "Step-by-step guides for founders." },
  { slug: "industry-insights", name: "Industry Insights", description: "Trends and analysis across the industry." },
  { slug: "atai-updates", name: "Atai Updates", description: "Product releases, improvements and announcements." },
] as const

export interface BlogAuthor {
  name: string
  role?: string
  bio?: string
  url?: string
  imageUrl?: string
}

/** One evaluated dimension in a comparison article. Every claim about a
 * competitor must carry evidence; the audit flags rows that lack it. */
export interface ComparisonRow {
  dimension: string
  atai: string
  competitor: string
  /** Source URL or note backing the competitor cell. */
  evidence?: string
  /** ISO date the claim was last verified. */
  lastChecked?: string
  /** Honest limitation of the comparison itself. */
  note?: string
}

export interface ComparisonData {
  competitorName: string
  competitorUrl?: string
  competitorDescription?: string
  positioning?: string
  rows: ComparisonRow[]
  /** ISO date the overall comparison was last reviewed. */
  lastReviewed?: string
  limitations?: string
}

export interface BlogSeo {
  title?: string
  description?: string
  canonical?: string
  ogTitle?: string
  ogDescription?: string
  ogImage?: string
  focusKeyword?: string
  secondaryKeywords?: string[]
  noindex?: boolean
}

interface BlogFeaturedImage {
  url: string
  alt: string
}

export interface BlogArticleDoc {
  _id?: ObjectId
  id: string
  slug: string
  title: string
  /** Meta description / social summary. */
  description: string
  /** Short card excerpt. */
  excerpt: string
  /** Markdown body (headings, tables, callouts, FAQ blocks). */
  body: string
  category: string
  tags: string[]
  author: BlogAuthor
  competitor?: string
  comparison?: ComparisonData
  featuredImage?: BlogFeaturedImage
  seo: BlogSeo
  status: BlogStatus
  featured: boolean
  relatedSlugs: string[]
  /** ISO date (YYYY-MM-DD) shown publicly. */
  publishedAt: string
  /** ISO date of the last content edit, shown as "Updated". */
  updatedAt: string
  /** Epoch ms when a scheduled article goes live. */
  scheduledFor?: number
  readingMinutes: number
  views: number
  createdAtMs: number
  updatedAtMs: number
  createdBy: string
  updatedBy: string
}

/** What an admin form may set. The server owns the identity, the counters and
 * the "last edited" date, so they are not part of the input. */
export type BlogArticleInput = Omit<
  BlogArticleDoc,
  | "_id"
  | "id"
  | "createdAtMs"
  | "updatedAtMs"
  | "createdBy"
  | "updatedBy"
  | "views"
  | "readingMinutes"
  | "updatedAt"
> & {
  publishedAt?: string
}

/** Admin list/detail view (no Mongo `_id`). */
export type BlogArticleView = Omit<BlogArticleDoc, "_id"> & {
  href: string
  publicUrl: string
}

export interface BlogCategoryDoc {
  _id?: ObjectId
  id: string
  slug: string
  name: string
  description: string
  seoTitle?: string
  seoDescription?: string
  order: number
  createdAtMs: number
  updatedAtMs: number
  /** True for the pillars that ship with the blog. They can be renamed, but
   * not deleted — the code needs them to keep working. */
  builtIn?: boolean
}

/** Permanent redirect kept when a published slug changes. */
export interface BlogRedirectDoc {
  _id?: ObjectId
  id: string
  /** Old path, always starting with /blog/. */
  from: string
  /** Target article slug (resolved at request time). */
  toSlug: string
  reason?: string
  createdAtMs: number
  createdBy: string
}

export interface BlogRevisionDoc {
  _id?: ObjectId
  id: string
  articleId: string
  /** Full snapshot of the editable fields at save time. */
  snapshot: Pick<
    BlogArticleDoc,
    "title" | "description" | "excerpt" | "body" | "category" | "tags" | "author" | "competitor" | "comparison" | "featuredImage" | "seo" | "relatedSlugs"
  >
  note?: string
  createdAtMs: number
  createdBy: string
}

/** One row per article per UTC day — real engagement data only. */
export interface BlogStatDoc {
  _id?: ObjectId
  /** YYYY-MM-DD (UTC). */
  date: string
  slug: string
  views: number
}

export interface BlogNewsletterDoc {
  _id?: ObjectId
  id: string
  email: string
  source: string
  createdAtMs: number
  /** Set when the reader unsubscribed. Unsubscribed addresses are never
   * included in an announcement. */
  unsubscribedAt?: number
}

/**
 * One announcement of a published article to the newsletter list.
 *
 * The status is deliberately literal: "sent" means the provider accepted every
 * message, "not-configured" means nothing was attempted because the mail
 * provider has no credentials. It is never a claim that a reader read it.
 */
export interface BlogCampaignDoc {
  _id?: ObjectId
  id: string
  articleId: string
  slug: string
  title: string
  subject: string
  status: "sending" | "sent" | "partial" | "failed" | "not-configured"
  recipients: number
  sentCount: number
  failedCount: number
  skippedCount: number
  error?: string
  /** What triggered the announcement. */
  trigger: "publish" | "manual"
  createdAtMs: number
  createdBy: string
}

/** Discoverability settings. Every integration reports its real state; an
 * absent credential means "not connected", never a fake success. */
export interface BlogSettingsDoc {
  _id?: ObjectId
  id: "blog-settings"
  indexNowEnabled: boolean
  /** Announce a newly published article to the newsletter list automatically. */
  newsletterAutoAnnounce: boolean
  /** Last IndexNow submission result, for honest status reporting. */
  lastIndexedAt?: number
  lastIndexedUrls?: string[]
  lastIndexedStatus?: "submitted" | "failed" | "not-configured"
  lastIndexedError?: string
  gscVerification?: string
  bingVerification?: string
  updatedAtMs: number
}

export interface BlogAuditFinding {
  code: string
  severity: "error" | "warning" | "info"
  message: string
  fix: string
}

export interface BlogAuditReport {
  articleId: string
  slug: string
  title: string
  findings: BlogAuditFinding[]
  /** 0–100 heuristic completeness score. Never a ranking promise. */
  score: number
  wordCount: number
  generatedAtMs: number
}