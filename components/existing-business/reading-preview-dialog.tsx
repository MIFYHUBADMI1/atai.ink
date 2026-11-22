"use client"

import { useEffect, useState } from "react"
import { ArrowRight, FileText, Globe, Loader2, ShieldCheck } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { jsonFetcher } from "@/lib/client/api"
import { relativeTime } from "@/lib/client/format"
import type { IntakeWebsiteReading } from "@/lib/types/business-intake"

interface ReadingPayload {
  url: string | null
  pagesCrawled: number
  fromCache: boolean
  completedAt: number | null
  reading: IntakeWebsiteReading | null
}

/**
 * What the read actually returned. A founder who is told "1 page read" has no
 * way to judge that sentence, so this shows the pages, their headings, the
 * opening of the text, and the exact evidence block the co-founder was given.
 */
export function ReadingPreviewDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [payload, setPayload] = useState<ReadingPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    jsonFetcher<ReadingPayload>(`/api/projects/${projectId}/intake/reading`)
      .then((data) => {
        if (!cancelled) setPayload(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "We couldn't load what was read.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  const reading = payload?.reading ?? null
  const host = payload?.url?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? "your website"
  const servedHost = reading?.finalUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "")
  const redirected = Boolean(reading?.redirectedFrom && servedHost && servedHost !== host)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl" showCloseButton>
        <DialogHeader className="flex-shrink-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">What was read</p>
          <DialogTitle className="text-xl font-semibold">{host}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {reading
              ? `${reading.pagesRead} page${reading.pagesRead === 1 ? "" : "s"} · ${reading.charsRead.toLocaleString()} characters of text · read ${relativeTime(reading.capturedAt)}${payload?.fromCache ? " (cached)" : ""}`
              : "Public pages only. Nothing was copied into your application."}
          </p>
          {redirected ? (
            <p className="flex flex-wrap items-center gap-1.5 rounded-lg bg-secondary/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-mono">{host}</span>
              <ArrowRight className="size-3 shrink-0" />
              <span className="font-mono text-foreground">{servedHost}</span>
              <span>— this address redirects, so Atai read the live site at the second address.</span>
            </p>
          ) : null}
        </DialogHeader>

        <div className="-mr-2 flex-1 overflow-y-auto pr-2">
          {loading ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading the read…
            </p>
          ) : error ? (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : !reading ? (
            <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-secondary/30 px-4 py-6">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Atai did not keep a copy of this particular read — it ran before we started saving one. The read still
                informed your co-founder; there is simply nothing stored to show you now.
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Every read from now on keeps its copy, so this view fills in next time the site is read.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <section className="flex flex-col gap-3">
                {reading.pages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    The crawl returned no page text — only the address. Your co-founder worked from your own words.
                  </p>
                ) : null}
                {reading.pages.map((page) => (
                  <article key={page.url} className="rounded-xl border border-border/70 bg-background/60 p-4">
                    <div className="flex items-start gap-2">
                      <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[11px] text-muted-foreground">{page.url}</p>
                        {page.title ? <p className="mt-0.5 truncate text-sm font-medium">{page.title}</p> : null}
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {page.chars.toLocaleString()} chars
                      </span>
                    </div>
                    {page.headings.length ? (
                      <p className="mt-2 flex flex-wrap gap-1.5">
                        {page.headings.slice(0, 8).map((heading, index) => (
                          <span
                            key={`${heading}-${index}`}
                            className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
                          >
                            {heading}
                          </span>
                        ))}
                      </p>
                    ) : null}
                    {page.excerpt ? (
                      <>
                        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                          Text Atai read
                        </p>
                        <p className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-secondary/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                          {page.excerpt}
                          {page.chars > page.excerpt.length ? "…" : ""}
                        </p>
                        {page.chars > page.excerpt.length ? (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Showing the first {page.excerpt.length.toLocaleString()} of {page.chars.toLocaleString()}{" "}
                            characters.
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </article>
                ))}
              </section>

              <section className="flex flex-col gap-2 border-t border-border/60 pt-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  The evidence block your co-founder was given
                </p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-secondary/30 px-3 py-2 font-mono text-[11px] leading-relaxed">
                  {reading.digest}
                </pre>
                <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <span>
                    This is everything Atai took from your site for this read. Nothing else was fetched, and nothing
                    from these pages was copied into your application.
                  </span>
                </p>
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The one-line affordance used where the read is reported. */
export function ReadingPreviewButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Globe className="size-3" />
      See what was read
    </button>
  )
}
