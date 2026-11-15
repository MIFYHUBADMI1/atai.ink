"use client"

import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  AlertTriangle, Bug, CheckCircle2, ChevronLeft, ChevronRight, Clock,
  Coins, Filter, Loader2, RefreshCw, Search, Shield, XCircle,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AdminNav } from "@/components/admin-nav"
import { jsonFetcher } from "@/lib/client/api"
import { cn } from "@/lib/utils"
import type { FeedbackCategory, FeedbackSeverity, FeedbackStatus } from "@/lib/feedback/types"

interface Stats {
  total: number; new: number; reviewing: number; verified: number; inProgress: number
  resolved: number; rejected: number; duplicates: number; critical: number
  openIncidents: number; creditsAwarded: number; rewardsIssued: number
  byCategory: { category: string; count: number }[]
  topRoutes: { route: string; count: number }[]
}

interface ListItem {
  id: string; reference: string; userId: string; userName?: string; userEmail?: string
  category: FeedbackCategory; categoryLabel: string; description: string
  status: FeedbackStatus; severity: FeedbackSeverity; fingerprint?: string
  route?: string; section?: string; projectId?: string; incidentId?: string
  hasReward: boolean; rewardAmount?: number; attachmentCount: number
  createdAt: number; updatedAt: number
}

interface ListResponse { page: number; pageSize: number; total: number; items: ListItem[] }

const STATUS_STYLE: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  reviewing: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  verified: "bg-green-500/15 text-green-500 border-green-500/30",
  in_progress: "bg-purple-500/15 text-purple-500 border-purple-500/30",
  resolved: "bg-emerald-600/15 text-emerald-600 border-emerald-600/30",
  rejected: "bg-red-500/15 text-red-500 border-red-500/30",
  duplicate: "bg-muted text-muted-foreground border-border",
}
const SEV_STYLE: Record<string, string> = {
  P0: "text-red-500 border-red-500/40",
  P1: "text-orange-500 border-orange-500/40",
  P2: "text-amber-500 border-amber-500/40",
  P3: "text-sky-500 border-sky-500/40",
  P4: "text-muted-foreground border-border",
}
const STATUS_LABELS: Record<string, string> = {
  new: "New", reviewing: "Reviewing", verified: "Verified", in_progress: "In progress",
  resolved: "Resolved", rejected: "Rejected", duplicate: "Duplicate",
}
const CATEGORIES = [
  ["", "All categories"], ["broken", "Broken"], ["error", "Error"], ["page_load", "Page load"],
  ["performance", "Performance"], ["incorrect", "Incorrect"], ["security", "Security"],
  ["improvement", "Improvement"], ["other", "Other"],
] as const

function qs(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ""
}

export default function AdminBugReportsPage() {
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("needs_review")
  const [category, setCategory] = useState("")
  const [severity, setSeverity] = useState("")
  const [reward, setReward] = useState("")
  const [page, setPage] = useState(1)

  const statsUrl = "/api/admin/feedback/reports?stats=1"
  const listUrl = `/api/admin/feedback/reports${qs({ q, status, category, severity, rewardStatus: reward, page })}`
  const { data: stats, mutate: mutateStats } = useSWR<Stats>(statsUrl, jsonFetcher, { refreshInterval: 60000 })
  const { data: list, isLoading, mutate } = useSWR<ListResponse>(listUrl, jsonFetcher)

  const refresh = () => { void mutate(); void mutateStats() }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AdminNav />
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Admin</p>
              <Badge variant="secondary" className="gap-1 text-xs"><Shield className="size-3" />Bug reports</Badge>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Atai Feedback Hub</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Production bug reports, diagnostics, incidents, and contributor rewards.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5">
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
        </header>

        {/* Stats */}
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {[
            { label: "Total", value: stats?.total ?? 0, icon: Bug },
            { label: "New", value: stats?.new ?? 0, icon: Clock },
            { label: "Verified", value: (stats?.verified ?? 0) + (stats?.inProgress ?? 0), icon: CheckCircle2 },
            { label: "Resolved", value: stats?.resolved ?? 0, icon: CheckCircle2 },
            { label: "Critical P0", value: stats?.critical ?? 0, icon: AlertTriangle },
            { label: "Credits awarded", value: (stats?.creditsAwarded ?? 0).toLocaleString(), icon: Coins },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {(stats?.byCategory.length || stats?.topRoutes.length) ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="py-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">By category</p>
                <div className="flex flex-wrap gap-2">
                  {(stats?.byCategory ?? []).map((c) => (
                    <Badge key={c.category} variant="outline" className="gap-1">
                      {CATEGORIES.find(([id]) => id === c.category)?.[1] ?? c.category} · {c.count}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">Top affected routes</p>
                <div className="space-y-1.5">
                  {(stats?.topRoutes ?? []).slice(0, 6).map((r) => (
                    <div key={r.route} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate font-mono text-muted-foreground">{r.route}</span>
                      <span className="shrink-0 tabular-nums">{r.count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* Filters */}
        <div className="mt-8 flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Search reference, description, user…" className="pl-8" />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="h-8 rounded-lg border border-border bg-background px-2 text-xs">
            <option value="needs_review">Needs review</option>
            <option value="all">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }} className="h-8 rounded-lg border border-border bg-background px-2 text-xs">
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1) }} className="h-8 rounded-lg border border-border bg-background px-2 text-xs">
            <option value="">All severities</option>
            {["P0", "P1", "P2", "P3", "P4"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={reward} onChange={(e) => { setReward(e.target.value); setPage(1) }} className="h-8 rounded-lg border border-border bg-background px-2 text-xs">
            <option value="">Any reward</option>
            <option value="rewarded">Rewarded</option>
            <option value="unrewarded">Unrewarded</option>
          </select>
          <Filter className="size-3.5 text-muted-foreground" />
        </div>

        {/* Table */}
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Report</th>
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Severity</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Route</th>
                <th className="px-4 py-2.5 font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center"><Loader2 className="mx-auto size-5 animate-spin text-primary" /></td></tr>
              ) : (list?.items ?? []).length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">No reports match these filters.</td></tr>
              ) : (
                (list?.items ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <Link href={`/admin/bug-reports/${r.id}`} className="font-mono text-xs text-primary hover:underline">{r.reference}</Link>
                      <p className="mt-0.5 max-w-56 truncate text-xs text-muted-foreground">{r.description}</p>
                      {r.incidentId ? <Badge variant="outline" className="mt-1 text-[10px]">incident</Badge> : null}
                      {r.hasReward ? <Badge variant="outline" className="mt-1 ml-1 gap-1 text-[10px] text-green-500"><Coins className="size-2.5" />{r.rewardAmount?.toLocaleString()}</Badge> : null}
                    </td>
                    <td className="px-4 py-3 text-xs">{r.userName ?? r.userId}<span className="block text-muted-foreground">{r.userEmail}</span></td>
                    <td className="px-4 py-3 text-xs">{r.categoryLabel}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className={cn("font-mono text-[10px]", SEV_STYLE[r.severity])}>{r.severity}</Badge></td>
                    <td className="px-4 py-3"><Badge variant="outline" className={cn("text-[10px]", STATUS_STYLE[r.status])}>{STATUS_LABELS[r.status]}</Badge></td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{r.route ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {list ? (
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>{list.total} report{list.total === 1 ? "" : "s"} · page {list.page}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="gap-1"><ChevronLeft className="size-3.5" /> Prev</Button>
              <Button variant="outline" size="sm" disabled={page * list.pageSize >= list.total} onClick={() => setPage(page + 1)} className="gap-1">Next <ChevronRight className="size-3.5" /></Button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}
