"use client"

import { useState } from "react"
import { Check, History, Loader2, RefreshCw, ScanSearch, TriangleAlert } from "lucide-react"
import { CofounderMarkdown } from "@/components/cofounder/markdown"
import { postJson } from "@/lib/client/api"

export interface CompetitionSnapshotItem {
  id: string
  title: string
  body: string
  creditsCharged: number
  createdAt: number
  contextHash?: string
}

/** Deterministic UTC day — safe to render on server and client alike. */
function formatDay(ms: number): string {
  return Number.isFinite(ms) && ms > 0 && ms <= 8.64e15 ? new Date(ms).toISOString().slice(0, 10) : "date unknown"
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
  history: initialHistory = [],
  currentContextHash,
  creditsAvailable: initialCredits,
  textReady,
  hasPlan,
}: {
  projectId: string
  snapshot: CompetitionSnapshotItem | null
  /** Older drafts, newest first — the newest is `snapshot`. */
  history?: CompetitionSnapshotItem[]
  currentContextHash?: string
  creditsAvailable: number | null
  textReady: boolean
  hasPlan: boolean
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [history, setHistory] = useState(initialHistory)
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
      if (snapshot) setHistory((current) => [snapshot, ...current])
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
        This snapshot does not collect live market or competitor data. It drafts a landscape written{" "}
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
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Drafted {formatDay(snapshot.createdAt)} · from your plan, not market data
          </p>
          {(!snapshot.contextHash || (currentContextHash && snapshot.contextHash !== currentContextHash)) && (
            <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {snapshot.contextHash
                ? "The planning context has changed since this draft. Generate a new draft to reflect it."
                : "This older draft has no recorded plan version; its freshness is unknown."}
            </p>
          )}
          <div className="mt-3 min-w-0 text-sm leading-6 text-foreground">
            <CofounderMarkdown>{snapshot.body}</CofounderMarkdown>
          </div>
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

      {history.length > 0 && !generating && (
        <details className="rounded-2xl border border-border bg-transparent px-4 py-3">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-muted-foreground">
            <History className="size-3.5" aria-hidden />
            Recent previous drafts ({history.length}) — AI-generated, not current research
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Initially loads the latest 25 snapshots, including the current draft. Older drafts remain in your{" "}
            <a className="text-primary underline" href={`/project/${projectId}/studio`}>Studio library</a>.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {history.map((item) => (
              <details key={item.id} className="rounded-xl border border-border bg-card px-3 py-2">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em]">{formatDay(item.createdAt)}</span>
                  <span className="min-w-0 flex-1 break-words">{item.title}</span>
                </summary>
                <div className="mt-2 min-w-0 text-sm leading-6 text-foreground/90">
                  <CofounderMarkdown>{item.body}</CofounderMarkdown>
                </div>
              </details>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
