"use client"

import { AlertTriangle, CheckCircle2, Info } from "lucide-react"
import type { BlogAuditFinding } from "@/lib/blog/types"

const SEVERITY_STYLE: Record<BlogAuditFinding["severity"], string> = {
  error: "border-destructive/40 bg-destructive/5",
  warning: "border-amber-500/40 bg-amber-500/5",
  info: "border-border bg-card",
}

export function AuditPanel({
  findings,
  score,
  wordCount,
  loading,
}: {
  findings: BlogAuditFinding[]
  score?: number
  wordCount?: number
  loading?: boolean
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Running the content audit…</p>
  }
  if (!findings.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CheckCircle2 className="size-4 text-primary" /> No content or SEO issues found.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          This is a completeness check, not a ranking promise — search engines decide placement.
        </p>
      </div>
    )
  }
  const errors = findings.filter((finding) => finding.severity === "error").length
  const warnings = findings.filter((finding) => finding.severity === "warning").length
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Content score</p>
          <p className="text-2xl font-semibold tracking-tight">{score ?? "—"}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Words</p>
          <p className="text-2xl font-semibold tracking-tight">{wordCount ?? "—"}</p>
        </div>
        <div className="text-sm text-muted-foreground">
          <p>
            {errors} error{errors === 1 ? "" : "s"}
          </p>
          <p>
            {warnings} warning{warnings === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {findings.map((finding) => (
          <li key={finding.code} className={`rounded-xl border p-3 ${SEVERITY_STYLE[finding.severity]}`}>
            <p className="flex items-start gap-2 text-sm font-medium">
              {finding.severity === "error" ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              ) : finding.severity === "warning" ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span>{finding.message}</span>
            </p>
            <p className="mt-1 pl-6 text-xs text-muted-foreground">{finding.fix}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
