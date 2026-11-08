"use client"

import { useState } from "react"
import { Check, Loader2, RefreshCw, ScanSearch, TriangleAlert } from "lucide-react"
import { postJson } from "@/lib/client/api"

export interface CompetitionSnapshotItem {
  id: string
  title: string
  body: string
  creditsCharged: number
  createdAt: number
}

/**
 * The one-click competitor-landscape DRAFT on /competition. Strict honesty:
 * the snapshot is written from the founder's own plan — Atai does not collect
 * live market or competitor data, so the panel says exactly that before,
 * during, and after generation.
 */
export function CompetitionSnapshotPanel({
  projectId,
  snapshot: initialSnapshot,
  creditsAvailable: initialCredits,
  textReady,
  hasPlan,
}: {
  projectId: string
  snapshot: CompetitionSnapshotItem | null
  creditsAvailable: number | null
  textReady: boolean
  hasPlan: boolean
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [confirmFresh, setConfirmFresh] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creditsAvailable, setCreditsAvailable] = useState(initialCredits)

  async function generate() {
    if (generating) return
    setGenerating(true)
    setError(null)
    setConfirmFresh(false)
    try {
      const item = await postJson<CompetitionSnapshotItem>(
        `/api/projects/${encodeURIComponent(projectId)}/market/competition-snapshot`,
        {},
      )
      setSnapshot(item)
      if (item.creditsCharged > 0) {
        setCreditsAvailable((current) => (current === null ? null : Math.max(0, current - item.creditsCharged)))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The snapshot didn't generate. Please try again.")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <section aria-labelledby="competition-snapshot-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="competition-snapshot-heading" className="text-lg font-semibold tracking-tight">
          Competitor landscape draft
        </h2>
        {creditsAvailable !== null && (
          <span className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {creditsAvailable} credits available
          </span>
        )}
      </div>
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        Atai does not collect live market or competitor data. What it can draft is a landscape written{" "}
        <span className="text-foreground">strictly from your own plan</span> — competitor types, how your plan says
        you&apos;re positioned, what&apos;s unproven, and what to check. Verify every line before you rely on it.
      </p>

      {!generating && (
        <div className="flex flex-wrap items-center gap-2">
          {!snapshot ? (
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!textReady || !hasPlan}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ScanSearch className="size-4" aria-hidden />
              Draft the competitor snapshot
            </button>
          ) : confirmFresh ? (
            <span className="inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Generate a fresh draft? This one stays in your library.
              <button
                type="button"
                onClick={() => void generate()}
                className="rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Yes, new draft
              </button>
              <button
                type="button"
                onClick={() => setConfirmFresh(false)}
                className="rounded-full border border-border px-3 py-1 font-medium hover:bg-muted"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmFresh(true)}
              disabled={!textReady || !hasPlan}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              New draft
            </button>
          )}
          {!hasPlan && (
            <span className="text-xs text-muted-foreground">The snapshot drafts from your plan — create one first.</span>
          )}
          {!textReady && (
            <span className="text-xs text-muted-foreground">Text generation isn&apos;t configured on this deployment yet.</span>
          )}
        </div>
      )}

      {generating && (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-4 py-5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          Drafting from your plan — this usually takes a few seconds…
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
          {error}
        </p>
      )}

      {snapshot && !generating && (
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-sm font-semibold tracking-tight">{snapshot.title}</span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <Check className="size-3" aria-hidden /> AI draft · not verified
            </span>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{snapshot.body}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {snapshot.creditsCharged > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground">{snapshot.creditsCharged} credits</span>
            )}
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <TriangleAlert className="size-3" aria-hidden /> Drafted from your plan, not market data — verify before you rely on it
            </span>
            <a
              href={`/project/${projectId}/studio`}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Open in Studio <span aria-hidden>→</span>
            </a>
          </div>
        </div>
      )}
    </section>
  )
}
