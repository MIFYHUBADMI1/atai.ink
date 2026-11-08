import Link from "next/link"
import { ArrowRight, Clock } from "lucide-react"
import { CATEGORY_META, FORMAT_LABEL, TYPE_LABEL, type ResourceSummary } from "@/lib/resources"
import { formatFileSize, resourceFormat, youTubeThumbnailUrl } from "@/lib/resources/media"
import { ResourceFormatIcon } from "@/components/resources/format-icon"
import { CATEGORY_ACCENT, DIFFICULTY_ACCENT } from "@/components/resources/accents"
import { cn } from "@/lib/utils"

export function ResourceCard({
  resource,
  className,
}: {
  resource: ResourceSummary
  className?: string
}) {
  const format = resourceFormat(resource)
  const accent = CATEGORY_ACCENT[resource.category]
  const thumbnail =
    format === "video" ? youTubeThumbnailUrl(resource.youtubeUrl) : resource.imageUrl ?? null
  const meta =
    format === "video"
      ? "Watch video"
      : resource.file
        ? formatFileSize(resource.file.size) || "Download"
        : format === "link"
          ? "External resource"
          : `${resource.readingMinutes} min read`

  return (
    <article>
      <Link
        href={resource.href}
        className={cn(
          "group flex h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          accent.hoverBorder,
          className,
        )}
      >
        {thumbnail ? (
          <div className="relative overflow-hidden border-b border-border">
            {/* Admin and editorial images are remote; next/image optimization is off in this app. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnail}
              alt=""
              loading="lazy"
              className="aspect-[16/9] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
            <span
              className={cn(
                "absolute left-3 top-3 inline-flex items-center rounded-full border bg-background/85 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] backdrop-blur",
                accent.chip,
              )}
            >
              {CATEGORY_META[resource.category].label}
            </span>
          </div>
        ) : (
          <div className={cn("border-b border-border bg-gradient-to-br px-5 py-3.5", accent.glow)}>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]",
                accent.chip,
              )}
            >
              {CATEGORY_META[resource.category].label}
            </span>
          </div>
        )}
        <div className="flex flex-1 flex-col p-5">
          <div className="flex items-center gap-2.5">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", accent.iconTile)}>
              <ResourceFormatIcon format={format} className="size-4" />
            </span>
            <div className="min-w-0">
              <p className={cn("font-mono text-[10px] uppercase tracking-[0.14em]", accent.text)}>
                {TYPE_LABEL[resource.type]} · {FORMAT_LABEL[format]}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" /> {meta}
              </p>
            </div>
            <span
              className={cn(
                "ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                DIFFICULTY_ACCENT[resource.difficulty],
              )}
            >
              {resource.difficulty}
            </span>
          </div>
          <h3 className={cn("mt-3 text-base font-semibold tracking-tight transition-colors", accent.hoverTitle)}>
            {resource.title}
          </h3>
          <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{resource.description}</p>
          {resource.file ? (
            <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{resource.file.name}</p>
          ) : null}
          <div className="mt-4 flex items-center justify-end border-t border-border/60 pt-3">
            <span className={cn("inline-flex items-center gap-1 text-xs font-medium", accent.text)}>
              Open <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </Link>
    </article>
  )
}
