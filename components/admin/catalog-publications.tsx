"use client"

import useSWR from "swr"
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  RefreshCw,
  ShieldAlert,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { jsonFetcher } from "@/lib/client/api"
import type {
  CatalogPublicationPreview,
  CatalogPublicationSummary,
} from "@/lib/billing/catalog/publication-preview"

const PREVIEW_URL = "/api/admin/billing/catalog/publications/preview"

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  const json = JSON.stringify(value)
  return json.length > 120 ? `${json.slice(0, 117)}…` : json
}

function PublicationSummary({ label, value }: { label: string; value: CatalogPublicationSummary | null }) {
  if (!value) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        {label}: none
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Badge variant={value.status === "active" ? "default" : "secondary"}>{value.status}</Badge>
      </div>
      <p className="mt-1 font-mono text-sm">{value.version}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {value.productCount} products · {new Date(value.publishedAt).toLocaleString()}
      </p>
    </div>
  )
}

export function CatalogPublications() {
  const { data, error, isLoading, mutate } = useSWR<CatalogPublicationPreview>(
    PREVIEW_URL,
    jsonFetcher,
  )

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <Eye className="size-3.5" /> Publication preview
          </p>
          <h2 className="mt-1 text-lg font-semibold">Candidate vs active</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Read-only. The preview uses the same validation as activation and customer reads. It never
            activates a publication or changes checkout.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => mutate()} className="gap-1">
          <RefreshCw className={isLoading ? "size-4 animate-spin" : "size-4"} /> Refresh
        </Button>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load the publication preview."}
        </p>
      ) : null}

      {!data && isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading candidate preview…</p>
      ) : null}

      {data ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <PublicationSummary label="Candidate" value={data.candidate} />
            <PublicationSummary label="Active" value={data.active} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {data.ready ? (
              <Badge className="gap-1">
                <CheckCircle2 className="size-3" /> Ready to activate
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <ShieldAlert className="size-3" /> Activation blocked
              </Badge>
            )}
            <Badge variant={data.checkoutCompatible ? "outline" : "destructive"}>
              {data.checkoutCompatible ? "Checkout-compatible" : "Checkout mismatch"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {data.diff.added.length} added · {data.diff.removed.length} removed ·{" "}
              {data.diff.changed.length} changed
            </span>
          </div>

          {data.errors.length > 0 ? (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-xs font-medium text-destructive">Validation errors</p>
              <ul className="mt-1 space-y-1 text-xs text-destructive">
                {data.errors.map((entry) => (
                  <li key={entry.reason}>
                    <span className="font-mono">{entry.reason}</span>
                    {entry.detail ? ` · ${formatValue(entry.detail)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.warnings.length > 0 ? (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <p className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3.5" /> Warnings
              </p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium">
              Differences
            </div>
            {data.diff.added.length === 0 &&
            data.diff.removed.length === 0 &&
            data.diff.changed.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">
                No product changes against the active publication.
              </p>
            ) : (
              <ul className="divide-y divide-border text-xs">
                {data.diff.added.map((productId) => (
                  <li key={`added:${productId}`} className="flex gap-2 px-4 py-2">
                    <Badge variant="secondary">Added</Badge>
                    <span className="font-mono">{productId}</span>
                  </li>
                ))}
                {data.diff.removed.map((productId) => (
                  <li key={`removed:${productId}`} className="flex gap-2 px-4 py-2">
                    <Badge variant="outline">Removed</Badge>
                    <span className="font-mono">{productId}</span>
                  </li>
                ))}
                {data.diff.changed.map((change) => (
                  <li key={`${change.productId}:${change.path}`} className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">Changed</Badge>
                      <span className="font-mono">{change.productId}</span>
                      <span className="text-muted-foreground">{change.path}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      <span className="line-through">{formatValue(change.before)}</span>
                      {" → "}
                      <span className="text-foreground">{formatValue(change.after)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}
