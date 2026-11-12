"use client"

import { useState } from "react"
import { Check, ExternalLink, History, Loader2, RefreshCw, ScanSearch, TriangleAlert } from "lucide-react"
import { CofounderMarkdown } from "@/components/cofounder/markdown"
import { postJson } from "@/lib/client/api"

export interface CompetitionSourceView {
  kind: "web" | "news" | "research" | "data_tool"
  title: string
  url?: string
  domain?: string
  snippet?: string
  excerpt?: string
  date?: string
  provider?: string
  queryIndex?: number
}

export interface CompetitionResearchView {
  queries: string[]
  collectedAt: number
  sources: CompetitionSourceView[]
  researchCreditsCharged: number
}

export interface CompetitionSnapshotItem {
  id: string
  title: string
  body: string
  creditsCharged: number
  createdAt: number
  contextHash?: string
  /** Live-research evidence (absent on pre-research drafts — those are plan-only). */
  research?: CompetitionResearchView
}

/** Deterministic UTC day — safe to render on server and client alike. */
function formatDay(ms: number): string {
  return Number.isFinite(ms) && ms > 0 && ms <= 8.64e15 ? new Date(ms).toISOString().slice(0, 10) : "date unknown"
}

const SOURCE_GROUPS: Array<{ kind: CompetitionSourceView["kind"]; label: string }> = [
  { kind: "web", label: "Web pages" },
  { kind: "news", label: "News" },
  { kind: "research", label: "Research & reports" },
  { kind: "data_tool", label: "Data tools & providers" },
]

const KIND_BADGE: Record<CompetitionSourceView["kind"], string> = {
  web: "Web",
  news: "News",
  research: "Research",
  data_tool: "Data tool",
}

/**
 * The competitor snapshot on /competition. The run performs REAL live web
 * research (web, news, research category, Alexandria data tools) and writes
 * the analysis grounded in those sources — every source is shown below the
 * draft with its link and date so the founder can verify each claim. Search
 * results are what the provider returned at query time; they are never
 * presented as verified or current-forever data.
 */
export function CompetitionSnapshotPanel({
  projectId,
  snapshot: initialSnapshot,
  history: initialHistory = [],
  currentContextHash,
  creditsAvailable: initialCredits,
  textReady,
  researchReady,
  hasPlan,
}: {
  projectId: string
  snapshot: CompetitionSnapshotItem | null
  /** Older drafts, newest first — the newest is `snapshot`. */
  history?: CompetitionSnapshotItem[]
  currentContextHash?: string
  creditsAvailable: number | null
  textReady: boolean
  researchReady: boolean
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
      if (item.creditsCharged > 0 || item.research?.researchCreditsCharged) {
        setCreditsAvailable((current) =>
          current === null
            ? null
            : Math.max(0, current - item.creditsCharged - (item.research?.researchCreditsCharged ?? 0)),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The snapshot didn't generate. Please try again.")
    } finally {
      setGenerating(false)
    }
  }

  const research = snapshot?.research
  const blockedReason = !hasPlan
    ? "The snapshot builds on your plan — create one first."
    : !researchReady
      ? "Live web research isn't configured on this deployment yet."
      : !textReady
        ? "Text generation isn't configured on this deployment yet."
        : null

  return (
    <section aria-labelledby="competition-snapshot-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="competition-snapshot-heading" className="text-lg font-semibold tracking-tight">
          Live competitor research
        </h2>
        {creditsAvailable !== null && (
          <span className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {creditsAvailable} credits available
          </span>
        )}
      </div>
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        One click runs live web research — web pages, news, research reports and data-tool sources — with queries
        derived from your plan, then drafts a competitor snapshot grounded in what was actually found. Every source
        is shown below with its link and date: search results are what the provider returned on the day, so{" "}
        <span className="text-foreground">verify before you rely on anything</span>.
      </p>

      {!generating && (
        <div className="flex flex-wrap items-center gap-2">
          {!snapshot ? (
            <button
              type="button"
              onClick={() => void generate()}
              disabled={Boolean(blockedReason)}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ScanSearch className="size-4" aria-hidden />
              Run live competitor research
            </button>
          ) : confirmFresh ? (
            <span className="inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Search the live web again? This snapshot stays in your library.
              <button
                type="button"
                onClick={() => void generate()}
                className="rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Yes, research again
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
              disabled={Boolean(blockedReason)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Research again
            </button>
          )}
          {blockedReason && <span className="text-xs text-muted-foreground">{blockedReason}</span>}
        </div>
      )}

      {generating && (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-4 py-5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          Searching the live web — pages, news, research, data tools — then drafting from what it finds. This
          usually takes under a minute…
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
              <Check className="size-3" aria-hidden /> AI draft · from live sources
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {research
              ? `Live research ${formatDay(research.collectedAt)} · ${research.sources.length} sources${
                  research.researchCreditsCharged > 0 ? ` · ${research.researchCreditsCharged} credits` : ""
                }`
              : `Drafted ${formatDay(snapshot.createdAt)} · from your plan, not market data`}
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

          {research && (
            <details className="mt-3 rounded-xl border border-border bg-transparent px-3 py-2" open>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                <ExternalLink className="size-3.5" aria-hidden />
                Live sources ({research.sources.length}) — everything the analysis drew from
              </summary>
              {research.queries.length > 0 && (
                <p className="mt-2 break-words font-mono text-[10px] leading-5 text-muted-foreground">
                  Searched: {research.queries.map((q, i) => `q${i + 1} “${q}”`).join(" · ")}
                </p>
              )}
              <div className="mt-2 flex flex-col gap-3">
                {SOURCE_GROUPS.map((group) => {
                  const groupSources = research.sources.filter((source) => source.kind === group.kind)
                  if (groupSources.length === 0) return null
                  return (
                    <div key={group.kind} className="flex flex-col gap-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {group.label} ({groupSources.length})
                      </p>
                      <ul className="flex flex-col gap-1.5">
                        {groupSources.map((source, index) => (
                          <li
                            key={`${group.kind}-${index}-${source.url ?? source.title}`}
                            className="rounded-xl border border-border bg-background/50 px-3 py-2"
                          >
                            <div className="flex flex-wrap items-start gap-1.5">
                              {source.url ? (
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="min-w-0 flex-1 break-words text-xs font-medium text-primary hover:underline"
                                >
                                  {source.title}
                                </a>
                              ) : (
                                <span className="min-w-0 flex-1 break-words text-xs font-medium text-foreground">
                                  {source.title}
                                </span>
                              )}
                              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                {KIND_BADGE[source.kind]}
                              </span>
                            </div>
                            {(source.domain || source.date) && (
                              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                {[source.domain, source.date].filter(Boolean).join(" · ")}
                              </p>
                            )}
                            {(source.snippet || source.excerpt) && (
                              <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                                {source.excerpt ?? source.snippet}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-5 text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                Search results reflect what the provider returned on {formatDay(research.collectedAt)} — open the
                links and verify anything you intend to rely on.
              </p>
            </details>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {snapshot.creditsCharged > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground">{snapshot.creditsCharged} credits</span>
            )}
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <TriangleAlert className="size-3" aria-hidden /> AI draft grounded in live sources — verify before you
              rely on it
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
            Recent previous drafts ({history.length}) — AI-generated, from what the sources showed that day
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
                  {item.research && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
                      {item.research.sources.length} sources
                    </span>
                  )}
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
