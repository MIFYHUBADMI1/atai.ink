import type { ObjectId } from "mongodb"
import type {
  ResourceCategory,
  ResourceDifficulty,
  ResourceFile,
  ResourceFormat,
  ResourceType,
} from "@/lib/resources/types"

export const RESOURCE_STATUSES = ["draft", "published", "archived"] as const

export type ResourceStatus = (typeof RESOURCE_STATUSES)[number]

/** Admin-managed resource persisted in MongoDB. Static editorial resources
 * keep living in the catalog; a document with the same category/slug overrides
 * one, and an archived document hides it from the public library. */
export interface ResourceDoc {
  _id?: ObjectId
  id: string
  slug: string
  category: ResourceCategory
  type: ResourceType
  format: ResourceFormat
  title: string
  description: string
  topics: string[]
  difficulty: ResourceDifficulty
  readingMinutes: number
  contentMarkdown?: string
  imageUrl?: string
  youtubeUrl?: string
  externalUrl?: string
  file?: ResourceFile
  seoTitle?: string
  seoDescription?: string
  keywords?: string[]
  related: string[]
  featured: boolean
  status: ResourceStatus
  /** ISO date (YYYY-MM-DD) used for the public byline. */
  publishedAt: string
  /** ISO date (YYYY-MM-DD) of the last content edit. */
  updatedAt: string
  createdAt: number
  updatedAtMs: number
  createdBy: string
  updatedBy: string
}

export type AdminResourceInput = Omit<
  ResourceDoc,
  "_id" | "id" | "createdAt" | "updatedAtMs" | "createdBy" | "updatedBy" | "publishedAt" | "updatedAt"
> & {
  publishedAt?: string
  updatedAt?: string
}

/** What the admin list endpoint returns (no Mongo `_id`). */
export type AdminResourceView = Omit<ResourceDoc, "_id"> & {
  href: string
  isOverride: boolean
  /** `editorial` entries ship with the code and are customized by creating a
   * document with the same category/slug; `admin` entries are fully editable. */
  source: "editorial" | "admin"
}
