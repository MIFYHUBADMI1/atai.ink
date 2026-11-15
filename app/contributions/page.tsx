"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  AlertTriangle, Bug, CheckCircle2, ChevronDown, Coins, ExternalLink,
  Loader2, Paperclip, Shield, XCircle,
} from "lucide-react"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { jsonFetcher } from "@/lib/client/api"
import { cn } from "@/lib/utils"
import type { PublicFeedbackReport } from "@/lib/feedback/types"
import { STATUS_LABEL } from "@/lib/feedback/types"

interface MineResponse {
  page: number; pageSize: number; total: number
  stats: {
    total: number; awaitingReview: number; verified: number; resolved: number
    rejected: number; totalRewards: number; rewardCount: number
  }
  items: PublicFeedbackReport[]
}

const TONE: Record<string, string> = {
  new: "border-blue-500/40 text-blue-500",
  reviewing: "border-amber-500/40 text-amber-500",
  verified: "border-green-500/40 text-green-500",
  in_progress: "border-purple-500/40 text-purple-500",
  resolved: "border-emerald-600/40 text-emerald-600",
  rejected: "border-red-500/40 text-red-500",
  duplicate: "border-border text-muted-foreground",
}

export default function ContributionsPage() {
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)
  const { data, isLoading, mutate } = useSWR<MineResponse>(`/api/feedback/reports?page=${page}`, jsonFetcher)
  const { data: detail } = useSWR<PublicFeedbackReport>(
    openId ? `/api/feedback/reports/${openId}` : null,
    jsonFetcher,
  )

  const stats = data?.stats

  return (
    <DashboardShell title="My Contributions">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Atai Feedback Hub</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">My Contributions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track the bugs and issues you&apos;ve reported and the rewards you&apos;ve earned.
          </p>
        </header>

        {stats ? (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Submitted", value: stats.total, icon: Bug },
              { label: "Awaiting review", value: stats.awaitingReview, icon: Loader2 },
              { label: "Verified", value: stats.verified, icon: CheckCircle2 },
              { label: "Resolved", value: stats.resolved, icon: CheckCircle2 },
              { label: "Not accepted", value: stats.rejected, icon: XCircle },
              { label: "Credits earned", value: stats.totalRewards.toLocaleString(), icon: Coins },
            ].map(({ label, value, icon: Icon }) => (
              <Card key={label}>
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <Icon className="size-3.5 text-muted-foreground" />
                  </div>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        <div className="mt-6 space-y-2">
          {isLoading ? <Loader2 className="mx-auto mt-10 size-5 animate-spin text-primary" /> : null}
          {(data?.items ?? []).length === 0 && !isLoading ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Bug className="mx-auto mb-3 size-8 text-muted-foreground" />
                <p className="font-medium">No reports yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Found something broken? Use the feedback button in the corner of any page to report it.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {(data?.items ?? []).map((r) => {
            const expanded = openId === r.id
            return (
              <Card key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(expanded ? null : r.id)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                  aria-expanded={expanded}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{r.reference}</span>
                      <Badge variant="outline" className={cn("text-[10px]", TONE[r.status])}>{STATUS_LABEL[r.status]}</Badge>
                      {r.reward ? <Badge variant="outline" className="gap-1 text-[10px] text-green-500"><Coins className="size-2.5" />+{r.reward.amount.toLocaleString()}</Badge> : null}
                    </div>
                    <p className="mt-1 truncate text-sm">{r.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.categoryLabel} · {new Date(r.createdAt).toLocaleDateString()}
                      {r.attachments.length ? ` · ${r.attachments.length} attachment${r.attachments.length > 1 ? "s" : ""}` : ""}
                    </p>
                  </div>
                  <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                </button>

                {expanded ? (
                  <div className="border-t border-border px-5 py-4">
                    {detail && detail.id === r.id ? (
                      <div className="space-y-3 text-sm">
                        <p className="whitespace-pre-wrap">{detail.description}</p>
                        {detail.reward ? (
                          <p className="rounded-md bg-green-500/10 px-3 py-2 text-xs text-green-600">
                            Reward: {detail.reward.amount.toLocaleString()} permanent Atai Credits
                            {detail.reward.note ? ` — ${detail.reward.note}` : ""}
                          </p>
                        ) : null}
                        {detail.responses.length ? (
                          <div className="space-y-2">
                            {detail.responses.map((c) => (
                              <div key={c.id} className="rounded-md border border-border bg-muted/40 px-3 py-2">
                                <p className="whitespace-pre-wrap text-xs">{c.body}</p>
                                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No updates yet — the team will respond here when they review your report.</p>
                        )}
                        {detail.attachments.some((a) => a.kind === "audio") ? (
                          <div className="space-y-1.5">
                            {detail.attachments.filter((a) => a.kind === "audio").map((a) => (
                              <audio key={a.id} controls preload="none" src={`/api/feedback/attachments/${a.id}`} className="h-8 w-full max-w-sm" />
                            ))}
                          </div>
                        ) : null}
                        {detail.attachments.some((a) => a.kind === "image") ? (
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Paperclip className="size-3.5" /> Image attachment included.</p>
                        ) : null}
                      </div>
                    ) : (
                      <Loader2 className="size-4 animate-spin text-primary" />
                    )}
                  </div>
                ) : null}
              </Card>
            )
          })}
        </div>

        {data && data.total > data.pageSize ? (
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>{data.total} report{data.total === 1 ? "" : "s"}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        ) : null}

        <p className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Shield className="size-3.5" /> Genuine, verified reports can earn permanent Atai Credits through the contributor rewards programme.
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-primary hover:underline">Back to dashboard <ExternalLink className="size-3" /></Link>
        </p>
      </div>
    </DashboardShell>
  )
}
