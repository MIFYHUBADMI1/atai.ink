import type { BlogArticleDoc, BlogRedirectDoc, BlogStatus } from "@/lib/blog/types"

/** Allowed manual transitions. Publishing always goes through the store so
 * scheduled dates, redirects and revalidation stay consistent. */
const TRANSITIONS: Record<BlogStatus, BlogStatus[]> = {
  draft: ["review", "scheduled", "published", "archived"],
  review: ["draft", "scheduled", "published", "archived"],
  scheduled: ["draft", "published", "archived"],
  published: ["draft", "archived"],
  archived: ["draft", "published"],
}

export function canTransition(from: BlogStatus, to: BlogStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to)
}

export function transitionError(from: BlogStatus, to: BlogStatus): string | null {
  if (canTransition(from, to)) return null
  return `Cannot move an article from ${from} to ${to}.`
}

/** Scheduled articles whose time has come are published lazily on read, so
 * scheduling works without an external cron. Returns the ids that flipped. */
export function dueScheduledArticles(docs: BlogArticleDoc[], nowMs: number): BlogArticleDoc[] {
  return docs.filter(
    (doc) => doc.status === "scheduled" && typeof doc.scheduledFor === "number" && doc.scheduledFor <= nowMs,
  )
}

/** A scheduled article with no future timestamp is invalid input. */
export function validateSchedule(status: BlogStatus, scheduledFor: number | undefined, nowMs: number): string | null {
  if (status !== "scheduled") return null
  if (typeof scheduledFor !== "number" || !Number.isFinite(scheduledFor)) {
    return "Pick a publication date and time for the scheduled article."
  }
  if (scheduledFor <= nowMs) return "The scheduled time must be in the future."
  return null
}

interface RedirectResolution {
  /** Final article slug to render, or null when the redirect is unusable. */
  toSlug: string | null
  /** True when the chain was cut to avoid a loop. */
  loop: boolean
}

/** Resolve a redirect chain with a hard hop limit. Chains are flattened at
 * write time, but this guard keeps old data safe too. */
export function resolveRedirect(
  from: string,
  redirects: Pick<BlogRedirectDoc, "from" | "toSlug">[],
  maxHops = 5,
): RedirectResolution {
  const byFrom = new Map(redirects.map((redirect) => [redirect.from, redirect.toSlug]))
  let current = from
  const seen = new Set<string>()
  for (let hop = 0; hop < maxHops; hop++) {
    if (seen.has(current)) return { toSlug: null, loop: true }
    seen.add(current)
    const next = byFrom.get(current)
    if (!next) return { toSlug: current === from ? null : current.replace(/^\/blog\//, ""), loop: false }
    // Redirects point at slugs; a chained entry stores the next path.
    current = next.startsWith("/blog/") ? next : `/blog/${next}`
  }
  return { toSlug: null, loop: true }
}

/** When a published slug changes, keep the old URL alive with a permanent
 * redirect. Refuses self-loops and overwrites any existing chain entry. */
export function buildSlugRedirect(oldSlug: string, newSlug: string): { from: string; toSlug: string } | null {
  if (!oldSlug || oldSlug === newSlug) return null
  return { from: `/blog/${oldSlug}`, toSlug: newSlug }
}

/** Normalize a redirect path so lookups are exact-match. */
export function normalizeRedirectPath(value: string): string {
  const trimmed = value.trim().toLowerCase()
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return withSlash.replace(/\/+$/, "")
}