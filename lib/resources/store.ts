import "server-only"

import { RESOURCES } from "@/lib/resources/catalog"
import { resourcesCol } from "@/lib/db/collections"
import { summarize } from "@/lib/resources/index"
import { resourceBlocksToMarkdown, resourceFormat } from "@/lib/resources/media"
import { AppError } from "@/lib/errors"
import type { AdminResourceInput, AdminResourceView, ResourceDoc, ResourceStatus } from "@/lib/resources/admin-types"
import type { Resource, ResourceCategory, ResourceSummary } from "@/lib/resources/types"
import { logger } from "@/lib/logging/logger"
import { cryptoId } from "@/lib/store/id"

const CACHE_TTL_MS = 60_000
const FAILURE_BACKOFF_MS = 60_000

type Cache = {
  at: number
  docs: ResourceDoc[]
}

type Failure = {
  until: number
}

const globalForResources = globalThis as unknown as {
  __ataiResourceCache?: Cache
  __ataiResourceFailure?: Failure
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build"
}

function mapDoc(doc: ResourceDoc): Resource {
  return {
    slug: doc.slug,
    category: doc.category,
    type: doc.type,
    title: doc.title,
    description: doc.description,
    topics: doc.topics,
    difficulty: doc.difficulty,
    readingMinutes: doc.readingMinutes,
    publishedAt: doc.publishedAt,
    updatedAt: doc.updatedAt,
    featured: doc.featured,
    related: doc.related,
    body: [],
    format: doc.format,
    contentMarkdown: doc.contentMarkdown,
    file: doc.file,
    imageUrl: doc.imageUrl,
    youtubeUrl: doc.youtubeUrl,
    externalUrl: doc.externalUrl,
    seoTitle: doc.seoTitle,
    seoDescription: doc.seoDescription,
    keywords: doc.keywords,
    source: "admin",
  }
}

function resourceId(resource: Pick<Resource, "category" | "slug">) {
  return `${resource.category}/${resource.slug}`
}

/** Editorial catalog plus published admin documents. Archived admin documents
 * with an editorial slug hide that editorial resource from the public library. */
export function mergeResourceCatalog(docs: ResourceDoc[]): Resource[] {
  const byId = new Map<string, Resource>()
  for (const resource of RESOURCES) byId.set(resourceId(resource), resource)

  for (const doc of docs) {
    const id = `${doc.category}/${doc.slug}`
    if (doc.status === "archived") {
      byId.delete(id)
      continue
    }
    if (doc.status !== "published") continue
    byId.set(id, mapDoc(doc))
  }

  return Array.from(byId.values())
}

async function readPublishedDocs(): Promise<ResourceDoc[]> {
  if (isBuildPhase()) return []
  const now = Date.now()
  const cached = globalForResources.__ataiResourceCache
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.docs

  const failure = globalForResources.__ataiResourceFailure
  if (failure && now < failure.until) return []

  try {
    const col = await resourcesCol()
    const docs = (await col
      .find({ status: "published" })
      .sort({ featured: -1, updatedAtMs: -1 })
      .toArray()) as ResourceDoc[]
    globalForResources.__ataiResourceCache = { at: now, docs }
    globalForResources.__ataiResourceFailure = undefined
    return docs
  } catch (error) {
    globalForResources.__ataiResourceFailure = { until: now + FAILURE_BACKOFF_MS }
    logger.warn("resources.store", "Could not load admin resources", {
      message: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export function invalidateResourceCache() {
  globalForResources.__ataiResourceCache = undefined
  globalForResources.__ataiResourceFailure = undefined
}

export async function publicResources(): Promise<Resource[]> {
  const docs = await readPublishedDocs()
  return mergeResourceCatalog(docs)
}

export async function publicSummaries(): Promise<ResourceSummary[]> {
  return (await publicResources()).map(summarize)
}

export async function featuredPublicResource(): Promise<Resource> {
  const resources = await publicResources()
  return resources.find((resource) => resource.featured) ?? resources[0] ?? RESOURCES[0]
}

export async function publicResourcesByCategory(category: ResourceCategory): Promise<Resource[]> {
  return (await publicResources()).filter((resource) => resource.category === category)
}

export async function getPublicResource(category: string, slug: string): Promise<Resource | null> {
  return (await publicResources()).find((resource) => resource.category === category && resource.slug === slug) ?? null
}

export async function relatedPublicResources(resource: Resource): Promise<Resource[]> {
  if (resource.related.length === 0) return []
  const all = await publicResources()
  return resource.related
    .map((id) => {
      const [category, slug] = id.split("/")
      return all.find((item) => item.category === category && item.slug === slug) ?? null
    })
    .filter((item): item is Resource => Boolean(item))
}

// ─── Admin operations ────────────────────────────────────────────────────────

export async function listAdminResourceDocs(): Promise<ResourceDoc[]> {
  const col = await resourcesCol()
  return (await col.find({}).sort({ updatedAtMs: -1 }).toArray()) as ResourceDoc[]
}

export async function getAdminResourceDoc(id: string): Promise<ResourceDoc | null> {
  const col = await resourcesCol()
  return (await col.findOne({ id })) as ResourceDoc | null
}

export function toAdminView(doc: ResourceDoc): AdminResourceView {
  const editorial = RESOURCES.some((resource) => resource.category === doc.category && resource.slug === doc.slug)
  return {
    id: doc.id,
    slug: doc.slug,
    category: doc.category,
    type: doc.type,
    format: doc.format,
    title: doc.title,
    description: doc.description,
    topics: doc.topics,
    difficulty: doc.difficulty,
    readingMinutes: doc.readingMinutes,
    contentMarkdown: doc.contentMarkdown,
    imageUrl: doc.imageUrl,
    youtubeUrl: doc.youtubeUrl,
    externalUrl: doc.externalUrl,
    file: doc.file,
    seoTitle: doc.seoTitle,
    seoDescription: doc.seoDescription,
    keywords: doc.keywords,
    related: doc.related,
    featured: doc.featured,
    status: doc.status,
    publishedAt: doc.publishedAt,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
    updatedAtMs: doc.updatedAtMs,
    createdBy: doc.createdBy,
    updatedBy: doc.updatedBy,
    href: `/resources/${doc.category}/${doc.slug}`,
    isOverride: editorial,
    source: "admin",
  }
}

function toEditorialView(resource: Resource): AdminResourceView {
  return {
    id: `editorial:${resource.category}/${resource.slug}`,
    slug: resource.slug,
    category: resource.category,
    type: resource.type,
    format: resourceFormat(resource),
    title: resource.title,
    description: resource.description,
    topics: resource.topics,
    difficulty: resource.difficulty,
    readingMinutes: resource.readingMinutes,
    contentMarkdown:
      resource.contentMarkdown ?? (resource.body.length > 0 ? resourceBlocksToMarkdown(resource.body) : undefined),
    imageUrl: resource.imageUrl,
    youtubeUrl: resource.youtubeUrl,
    externalUrl: resource.externalUrl,
    file: resource.file,
    seoTitle: resource.seoTitle,
    seoDescription: resource.seoDescription,
    keywords: resource.keywords,
    related: resource.related,
    featured: Boolean(resource.featured),
    status: "published",
    publishedAt: resource.publishedAt,
    updatedAt: resource.updatedAt,
    createdAt: 0,
    updatedAtMs: 0,
    createdBy: "editorial",
    updatedBy: "editorial",
    href: `/resources/${resource.category}/${resource.slug}`,
    isOverride: false,
    source: "editorial",
  }
}

/** Everything visible in the public library: admin documents first, then the
 * editorial catalog entries that no document overrides yet. */
export async function listAdminLibrary(): Promise<AdminResourceView[]> {
  const docs = await listAdminResourceDocs()
  const overridden = new Set(docs.map((doc) => `${doc.category}/${doc.slug}`))
  const editorial = RESOURCES.filter((resource) => !overridden.has(`${resource.category}/${resource.slug}`)).map(
    toEditorialView,
  )
  return [...docs.map(toAdminView), ...editorial]
}

async function assertUniqueSlug(category: ResourceDoc["category"], slug: string, exceptId?: string) {
  const col = await resourcesCol()
  const existing = await col.findOne({ category, slug })
  if (existing && (existing as ResourceDoc).id !== exceptId) {
    throw new AppError("VALIDATION", "A resource with that category and slug already exists.", 409)
  }
}

export async function createAdminResource(input: AdminResourceInput, actorId: string): Promise<ResourceDoc> {
  await assertUniqueSlug(input.category, input.slug)
  const now = Date.now()
  const date = today()
  const doc: ResourceDoc = {
    ...input,
    id: `res_${cryptoId()}`,
    status: input.status,
    publishedAt: input.publishedAt || date,
    updatedAt: input.updatedAt || date,
    createdAt: now,
    updatedAtMs: now,
    createdBy: actorId,
    updatedBy: actorId,
  }
  const col = await resourcesCol()
  await col.insertOne(doc)
  invalidateResourceCache()
  return doc
}

export async function updateAdminResource(
  id: string,
  patch: Partial<AdminResourceInput>,
  actorId: string,
): Promise<ResourceDoc | null> {
  const existing = await getAdminResourceDoc(id)
  if (!existing) return null
  const category = patch.category ?? existing.category
  const slug = patch.slug ?? existing.slug
  if (category !== existing.category || slug !== existing.slug) {
    await assertUniqueSlug(category, slug, id)
  }
  const date = today()
  const update: Partial<ResourceDoc> = {
    ...patch,
    updatedAt: date,
    updatedAtMs: Date.now(),
    updatedBy: actorId,
  }
  if (patch.status === "published" && !existing.publishedAt) update.publishedAt = date
  if (patch.publishedAt === "") update.publishedAt = date
  const col = await resourcesCol()
  await col.updateOne({ id }, { $set: update })
  invalidateResourceCache()
  return { ...existing, ...update }
}

export async function setAdminResourceStatus(
  id: string,
  status: ResourceStatus,
  actorId: string,
): Promise<ResourceDoc | null> {
  return updateAdminResource(id, { status }, actorId)
}

export async function deleteAdminResource(id: string): Promise<boolean> {
  const col = await resourcesCol()
  const result = await col.deleteOne({ id })
  invalidateResourceCache()
  return result.deletedCount > 0
}
