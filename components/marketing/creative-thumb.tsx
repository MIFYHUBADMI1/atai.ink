"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { FileText, Image as ImageIcon, Loader2 } from "lucide-react"
import { jsonFetcher } from "@/lib/client/api"

/**
 * One creative preview tile for the Growth Overview gallery. Image creatives
 * store their bytes inline on the content item; list reads omit the blob, so
 * this tile fetches the single item on mount and renders the stored image.
 * Non-image drafts show a typed placeholder. Nothing is fabricated — a missing
 * image renders an honest "open in Studio" fallback, never a stock photo.
 */
export function CreativeThumb({
  projectId,
  contentId,
  title,
  platformLabel,
  kind,
  hasMedia,
}: {
  projectId: string
  contentId: string
  title: string
  platformLabel: string
  kind: string
  hasMedia: boolean
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(hasMedia && kind === "image")

  useEffect(() => {
    if (!hasMedia || kind !== "image") return
    let cancelled = false
    setLoading(true)
    jsonFetcher<{ media?: { dataUrl?: string } }>(
      `/api/projects/${encodeURIComponent(projectId)}/market/studio?contentId=${encodeURIComponent(contentId)}`,
    )
      .then((item) => {
        if (!cancelled) setSrc(item.media?.dataUrl ?? null)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, contentId, hasMedia, kind])

  const isImage = kind === "image"

  return (
    <Link
      href={`/project/${projectId}/studio?tab=library&item=${encodeURIComponent(contentId)}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/40">
        {isImage && loading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        ) : isImage && src ? (
          // Stored creative bytes (data URL), not a remote host — next/image adds nothing here.
          <img src={src} alt={title} loading="lazy" decoding="async" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            {isImage ? <ImageIcon className="size-6" aria-hidden /> : <FileText className="size-6" aria-hidden />}
            <span className="px-3 text-center text-[11px] leading-4">
              {isImage ? "Open in Studio to view" : "Copy draft"}
            </span>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold text-foreground backdrop-blur">
          {platformLabel}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-medium leading-5">{title}</p>
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
            Draft
          </span>
          <span className="text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
            Open Studio →
          </span>
        </div>
      </div>
    </Link>
  )
}
