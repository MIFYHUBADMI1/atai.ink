"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { jsonFetcher } from "@/lib/client/api"
import { AD_REQUEST_STATUS_LABELS } from "@/lib/marketing/ads/request-shared"
import { AD_REQUEST_STATUSES } from "@/lib/types/ads"

type Row = {
  id: string
  projectId: string
  userId: string
  businessName: string
  liveUrl: string
  objective: string
  channels: string[]
  budgetNote: string
  status: keyof typeof AD_REQUEST_STATUS_LABELS
  priority: string
  assignedAdminEmail: string
  submittedAt: number
  creditsCharged: number
}

export default function AdminAdsPage() {
  const [status, setStatus] = useState("submitted")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const listUrl = useMemo(() => {
    const params = new URLSearchParams({ status, page: String(page), pageSize: "25" })
    if (q.trim()) params.set("q", q.trim())
    return `/api/admin/ads?${params}`
  }, [status, q, page])
  const { data, error, isLoading } = useSWR<{ items: Row[]; total: number; page: number }>(listUrl, jsonFetcher)
  const { data: statsData } = useSWR<{ stats: Record<string, number> }>("/api/admin/ads?stats=1", jsonFetcher)

  const stats = statsData?.stats ?? {}

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Advertising</p>
          <h2 className="text-2xl font-semibold tracking-tight">Promotion inbox</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Atai executes campaigns manually. Nothing here publishes ads automatically.
          </p>
        </div>
        <Link href="/admin/ads/packages" className="text-sm font-medium text-primary hover:underline">
          Pricing packages
        </Link>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["New submissions", stats.submitted ?? 0],
          ["Needs review", (stats.under_review ?? 0) + (stats.needs_info ?? 0)],
          ["Awaiting customer", (stats.awaiting_approval ?? 0) + (stats.awaiting_payment ?? 0)],
          ["Credits collected", stats.creditsCollected ?? 0],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{Number(value).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          {AD_REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {AD_REQUEST_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          placeholder="Search name, URL, id"
          className="min-w-48 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-sm text-destructive">Could not load the inbox.</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Campaign</th>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link href={`/admin/ads/${row.id}`} className="text-primary hover:underline">
                    {row.id}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium">{row.businessName}</p>
                  <p className="max-w-xs truncate text-xs text-muted-foreground">{row.liveUrl}</p>
                </td>
                <td className="px-3 py-2">{AD_REQUEST_STATUS_LABELS[row.status] ?? row.status}</td>
                <td className="px-3 py-2">{row.priority}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(row.submittedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>{data?.total ?? 0} requests</span>
        <div className="flex gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-lg border border-border px-2 py-1">
            Previous
          </button>
          <button type="button" onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-border px-2 py-1">
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
