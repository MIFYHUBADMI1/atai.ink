"use client"

import { useEffect, useRef } from "react"
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react"

import { buildClientErrorReport, reportClientError, type BoundaryScope } from "@/lib/client-error-report"

/**
 * One fallback for every boundary, so the founder sees the same calm copy
 * whether the failure was in a page, the business shell, or the app root.
 *
 * It says what failed, what is unaffected, offers "Try again", gives a way
 * back, and prints the digest. The digest is the join key to the server log
 * line the boundary's report writes — that is the difference between a dead end
 * and a diagnosable failure.
 */

const COPY: Record<BoundaryScope, { title: string; body: string; back: { href: string; label: string } }> = {
  app: {
    title: "This part of the workspace did not load",
    body: "Something went wrong while drawing this page. Nothing you saved was changed, and the rest of Atai keeps working.",
    back: { href: "/projects", label: "Go to your businesses" },
  },
  business: {
    title: "This business workspace did not load",
    body: "The business shell hit an error while loading. Your business, its claims and its credits are untouched — only this view failed.",
    back: { href: "/projects", label: "Back to all businesses" },
  },
  page: {
    title: "This part of the workspace did not load",
    body: "This step hit an error while drawing. Everything you have already saved is safe; the rest of the business still works.",
    back: { href: "/projects", label: "Back to all businesses" },
  },
  global: {
    title: "Atai hit an unexpected error",
    body: "The page could not be drawn. Your account, credits and businesses are unaffected. Try again, or reload the page.",
    back: { href: "/", label: "Go to the home page" },
  },
}

export function ErrorBoundaryView({
  scope,
  error,
  retry,
  backHref,
  backLabel,
  className,
}: {
  scope: BoundaryScope
  error: unknown
  retry: () => void
  backHref?: string
  backLabel?: string
  className?: string
}) {
  const copy = COPY[scope]
  const report = buildClientErrorReport(scope, error)
  // Report once per (scope, message, digest): a boundary can re-render many
  // times, but one failure is one log line.
  const reported = useRef<string | null>(null)
  useEffect(() => {
    const key = `${scope}:${report.message}:${report.digest ?? ""}`
    if (reported.current === key) return
    reported.current = key
    void reportClientError(report)
  }, [scope, report])

  return (
    <div
      role="alert"
      className={
        className ??
        "mx-auto flex w-full max-w-xl flex-col items-start gap-4 rounded-2xl border border-destructive/30 bg-card p-6 shadow-sm"
      }
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight text-balance">{copy.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{copy.body}</p>
      </div>

      {report.digest ? (
        <p className="w-full rounded-lg bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground">
          Reference: <span className="break-all text-foreground">{report.digest}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw className="size-4" aria-hidden />
          Try again
        </button>
        <a
          href={backHref ?? copy.back.href}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {backLabel ?? copy.back.label}
        </a>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        If it keeps happening, quote the reference above to support — it points at the exact failure in our logs.
      </p>
    </div>
  )
}
