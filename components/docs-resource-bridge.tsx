"use client"

import Link from "next/link"
import useSWR from "swr"
import { ArrowRight } from "lucide-react"
import { jsonFetcher } from "@/lib/client/api"
import {
  CATEGORY_META,
  FORMAT_LABEL,
  RESOURCE_CATEGORIES,
  RESOURCE_FORMATS,
  type ResourceFormat,
  type ResourceSummary,
} from "@/lib/resources"
import { resourceFormat } from "@/lib/resources/media"
import { ResourceFormatIcon } from "@/components/resources/format-icon"
import { CATEGORY_ACCENT } from "@/components/resources/accents"
import { cn } from "@/lib/utils"

type ResourcesPayload = { items: ResourceSummary[]; updatedAt: string }

/** Connects the documentation to the published resource library: tutorials,
 * roadmaps, documents, images, and videos are referenced from the docs rather
 * than living in a separate silo. */
export function DocsResourceBridge() {
  const { data } = useSWR<ResourcesPayload>("/api/public/resources", jsonFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
  })

  const resources = data?.items ?? []
  const latest = [...resources]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 4)

  const categoryCounts = new Map<string, number>()
  for (const resource of resources) {
    categoryCounts.set(resource.category, (categoryCounts.get(resource.category) ?? 0) + 1)
  }

  const formatCounts = RESOURCE_FORMATS.reduce(
    (counts, format) => {
      counts[format] = 0
      return counts
    },
    {} as Record<ResourceFormat, number>,
  )
  for (const resource of resources) {
    formatCounts[resourceFormat(resource)] += 1
  }

  return (
    <section className="not-prose" aria-labelledby="docs-resource-bridge">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">From the resource library</p>
          <h2 id="docs-resource-bridge" className="mt-2 text-xl font-bold tracking-tight">
            Continue in the guides, tutorials, and videos
          </h2>
        </div>
        <Link
          href="/resources"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          All resources <ArrowRight className="size-4" />
        </Link>
      </div>

      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        Tutorials, roadmaps, and uploaded documents in the library feed back into these docs. Browse by goal area,
        open a format, or start with one of the latest updates.
      </p>

      {latest.length > 0 ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {latest.map((resource) => {
            const format = resourceFormat(resource)
            const accent = CATEGORY_ACCENT[resource.category]
            return (
              <Link
                key={resource.href}
                href={resource.href}
                className={cn(
                  "group flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/40",
                  accent.hoverBorder,
                )}
              >
                <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", accent.iconTile)}>
                  <ResourceFormatIcon format={format} className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm font-semibold text-foreground transition-colors", accent.hoverTitle)}>
                    {resource.title}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                    {resource.description}
                  </span>
                  <span className="mt-1.5 block font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {FORMAT_LABEL[format]} · <span className={accent.text}>{CATEGORY_META[resource.category].label}</span>
                  </span>
                </span>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2" aria-hidden>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-[92px] animate-pulse rounded-xl border border-border bg-card/60" />
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Goal areas</span>
        {RESOURCE_CATEGORIES.map((category) => (
          <Link
            key={category}
            href={`/resources/${category}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", CATEGORY_ACCENT[category].dot)} />
            {CATEGORY_META[category].label}
            {categoryCounts.get(category) ? (
              <span className="font-mono text-[10px] text-muted-foreground/70">{categoryCounts.get(category)}</span>
            ) : null}
          </Link>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Formats</span>
        {RESOURCE_FORMATS.filter((format) => formatCounts[format] > 0).map((format) => (
          <Link
            key={format}
            href="/resources"
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ResourceFormatIcon format={format} className="size-3.5" />
            {FORMAT_LABEL[format]}
            <span className="font-mono text-[10px] text-muted-foreground/70">{formatCounts[format]}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
