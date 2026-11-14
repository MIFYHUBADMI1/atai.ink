"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, ArrowUpDown, Clock, Megaphone, Sparkles } from "lucide-react"
import { LifecycleMini, StatusGroupBadge } from "@/components/marketing/request-lifecycle"
import { REQUEST_GROUP_LABELS, requestStatusGroup, type RequestStatusGroup } from "@/lib/marketing/ads/center-model"
import type { AdRequestStatus } from "@/lib/types/ads"
import { cn } from "@/lib/utils"

/**
 * "My promotion requests" — the founder's lifecycle tracker (brief §9). A live
 * status filter and sort over the requests the founder already submitted; each
 * card shows a compact eight-stage progress bar, the quotation summary when one
 * exists, and a clear next action. Nothing is fabricated: a request with no
 * quotation says so, and estimates are always labeled as estimates.
 */

export interface RequestCardView {
  id: string
  name: string
  status: AdRequestStatus
  submittedAt: number
  goals: string[]
  objective: string
  proposalCredits: number | null
  estimatedImpressionsMin?: number
  estimatedImpressionsMax?: number
}

const FILTER_ORDER: RequestStatusGroup[] = ["needs_action", "in_review", "running", "completed", "closed"]

const ACTION_HINT: Partial<Record<AdRequestStatus, string>> = {
  awaiting_approval: "Review and accept the quotation to proceed.",
  awaiting_payment: "Confirm payment to start the promotion.",
  needs_info: "Atai's team asked a question — reply to keep moving.",
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
}

export function AdsRequestsView({ projectId, requests }: { projectId: string; requests: RequestCardView[] }) {
  const [filter, setFilter] = useState<RequestStatusGroup | "all">("all")
  const [sort, setSort] = useState<"newest" | "oldest">("newest")

  const counts = useMemo(() => {
    const map: Record<RequestStatusGroup, number> = { needs_action: 0, in_review: 0, running: 0, completed: 0, closed: 0 }
    for (const request of requests) map[requestStatusGroup(request.status)] += 1
    return map
  }, [requests])

  const visible = useMemo(() => {
    const filtered = filter === "all" ? requests : requests.filter((request) => requestStatusGroup(request.status) === filter)
    return [...filtered].sort((a, b) => (sort === "newest" ? b.submittedAt - a.submittedAt : a.submittedAt - b.submittedAt))
  }, [requests, filter, sort])

  if (requests.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-12 text-center">
        <Megaphone className="mx-auto size-7 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-base font-semibold tracking-tight">No promotion requests yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
          Ask Atai&apos;s team to review your live business and send a quotation. Submitting is free — you only pay if you
          later approve a quotation, and execution is always manual.
        </p>
        <Link
          href={`/project/${projectId}/ads?tab=promote`}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Megaphone className="size-4" aria-hidden /> Promote my business
        </Link>
      </div>
    )
  }

  const activeFilters: Array<{ key: RequestStatusGroup | "all"; label: string; count: number }> = [
    { key: "all", label: "All", count: requests.length },
    ...FILTER_ORDER.filter((group) => counts[group] > 0).map((group) => ({
      key: group,
      label: REQUEST_GROUP_LABELS[group],
      count: counts[group],
    })),
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter requests by status">
          {activeFilters.map((entry) => {
            const active = filter === entry.key
            return (
              <button
                key={entry.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(entry.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {entry.label}
                <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active ? "bg-primary/20" : "bg-muted")}>
                  {entry.count}
                </span>
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => setSort((value) => (value === "newest" ? "oldest" : "newest"))}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted sm:self-auto"
        >
          <ArrowUpDown className="size-3.5" aria-hidden /> {sort === "newest" ? "Newest first" : "Oldest first"}
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          No requests in this view. Clear the filter to see all {requests.length}.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((request) => {
            const hint = ACTION_HINT[request.status]
            return (
              <li key={request.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/project/${projectId}/ads?tab=requests&request=${encodeURIComponent(request.id)}`}
                      className="break-words text-sm font-semibold tracking-tight hover:text-primary hover:underline"
                    >
                      {request.name}
                    </Link>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="size-3" aria-hidden /> Submitted {formatDate(request.submittedAt)}
                    </p>
                  </div>
                  <StatusGroupBadge status={request.status} />
                </div>

                <div className="mt-3">
                  <LifecycleMini status={request.status} />
                </div>

                {request.objective || request.goals.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(request.objective ? [request.objective] : request.goals).slice(0, 3).map((goal) => (
                      <span key={goal} className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
                        {goal}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs">
                  {request.proposalCredits !== null ? (
                    <span className="font-medium">
                      {request.proposalCredits.toLocaleString("en-US")} Atai Credits
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No quotation yet</span>
                  )}
                  {request.estimatedImpressionsMin !== undefined && request.estimatedImpressionsMax !== undefined ? (
                    <span className="text-muted-foreground">
                      Est. {request.estimatedImpressionsMin.toLocaleString("en-US")}–{request.estimatedImpressionsMax.toLocaleString("en-US")} impressions
                      <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        estimate
                      </span>
                    </span>
                  ) : null}
                  <Link
                    href={`/project/${projectId}/ads?tab=requests&request=${encodeURIComponent(request.id)}`}
                    className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    Track request <ArrowRight className="size-3" aria-hidden />
                  </Link>
                </div>

                {hint ? (
                  <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {hint}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-xs leading-5 text-muted-foreground">
        Atai&apos;s team reviews and executes every promotion by hand. Estimated visibility is a planning range, never a
        guaranteed result, and nothing publishes automatically.
      </p>
    </div>
  )
}