"use client"

import { useState } from "react"
import useSWR from "swr"
import { AlertTriangle, CheckCircle2, Globe, Loader2, RefreshCw, ShieldCheck, Unlock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { AdminNav } from "@/components/admin-nav"
import { jsonFetcher, postJson } from "@/lib/client/api"
import { relativeDeadline, relativeTime } from "@/lib/client/format"
import { toast } from "sonner"

type ClaimRow = {
  canonicalHostname: string
  hostnames: string[]
  state: "verified" | "pending"
  projectId: string
  projectName: string | null
  ownerId: string
  ownerEmail: string | null
  verifiedAt: number | null
  claimExpiresAt: number | null
  lastCheckedAt: number | null
  needsAttention: boolean
  createdAt: number
}

/**
 * Who holds each connected business — and the support release.
 *
 * This is the exception path to "one business, one account": an owner who lost
 * access to the account holding their site. A release is auditable (operator +
 * reason land in the record's history) and never deletes the business.
 */
export default function AdminBusinessClaimsPage() {
  const { data, error, isLoading, mutate } = useSWR<{ claims: ClaimRow[] }>(
    "/api/admin/domains/claims",
    jsonFetcher,
    { refreshInterval: 60_000 },
  )
  const [hostname, setHostname] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  const claims = data?.claims ?? []
  const verified = claims.filter((claim) => claim.state === "verified").length

  async function release() {
    if (!hostname.trim() || reason.trim().length < 8) {
      toast.error("Enter a hostname and a reason of at least 8 characters.")
      return
    }
    setBusy(true)
    try {
      const result = await postJson<{ canonicalHostname: string; released: unknown[] }>(
        "/api/admin/domains/claims",
        { hostname: hostname.trim(), reason: reason.trim() },
      )
      toast.success(`Released ${result.released.length} claim(s) for ${result.canonicalHostname}.`)
      setHostname("")
      setReason("")
      await mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The release did not go through.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <AdminNav />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <Globe className="size-3.5" /> Connected businesses
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Business claims</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            One business belongs to one account. This is the audited exception: release a claim when the owner lost
            access to the account that holds it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{claims.length} active</Badge>
          <Badge variant="secondary">{verified} verified</Badge>
          <Button variant="outline" size="sm" onClick={() => mutate()} disabled={isLoading}>
            {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
        </div>
      </header>

      <Card className="mt-6">
        <CardContent className="p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Unlock className="size-4 text-amber-600" /> Release a claim
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The website becomes connectable by any account. Nothing is deleted, and the operator plus reason are kept
            in the record&apos;s history.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto]">
            <Input
              value={hostname}
              onChange={(e) => setHostname(e.target.value.slice(0, 253))}
              placeholder="bakery.example"
              aria-label="Hostname to release"
            />
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 300))}
              placeholder="Why: e.g. owner lost access to the old account"
              aria-label="Reason for the release"
            />
            <Button onClick={release} disabled={busy} variant="destructive">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Release
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load claims."}
        </p>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-xl border border-border">
        <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 border-b border-border bg-secondary/40 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:grid">
          <span>Business</span>
          <span>Account</span>
          <span>State</span>
          <span>Last check</span>
        </div>
        {isLoading && claims.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading claims…</p>
        ) : null}
        {!isLoading && claims.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No active claims yet.</p>
        ) : null}
        {claims.map((claim) => (
          <div
            key={claim.canonicalHostname}
            className="grid gap-1 border-b border-border/60 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)] sm:items-center sm:gap-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{claim.canonicalHostname}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {claim.projectName ?? claim.projectId}
                {claim.hostnames.length > 1 ? ` · ${claim.hostnames.length} hosts` : ""}
              </p>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">{claim.ownerEmail ?? claim.ownerId}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {claim.state === "verified" ? (
                <Badge variant="secondary" className="gap-1">
                  <ShieldCheck className="size-3" /> Verified
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <CheckCircle2 className="size-3" /> Pending
                </Badge>
              )}
              {claim.needsAttention ? (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="size-3" /> Attention
                </Badge>
              ) : null}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {claim.lastCheckedAt ? relativeTime(claim.lastCheckedAt) : "Never"}
              {claim.state === "pending" && claim.claimExpiresAt ? (
                <span className="block text-amber-700 dark:text-amber-400">
                  expires {relativeDeadline(claim.claimExpiresAt)}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
