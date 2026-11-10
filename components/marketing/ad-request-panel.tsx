"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { jsonFetcher, postJson } from "@/lib/client/api"
import { AD_ESTIMATE_DISCLAIMER, AD_PERFORMANCE_SOURCE_LABELS, AD_REQUEST_STATUS_LABELS } from "@/lib/marketing/ads/request-shared"

type PublicRequest = {
  id: string
  status: keyof typeof AD_REQUEST_STATUS_LABELS
  business: { name: string; liveUrl: string; description: string }
  promote: { goals: string[]; pitch: string }
  proposal: null | {
    version: number
    title: string
    description: string
    creditsPrice: number
    platforms: string[]
    duration: string
    estimatedImpressionsMin?: number
    estimatedImpressionsMax?: number
    estimateNote: string
    conditions: string
    expiresAt?: number
    issuedAt: number
  }
  payment: { status: string; creditsCharged: number }
  submittedAt: number
}

type Payload = {
  request: PublicRequest
  events: { id: string; actor: string; action: string; detail: string; createdAt: number }[]
  activities: { id: string; title: string; status: string; publicationUrl: string; channel: string }[]
  performance: { id: string; metric: string; value: number; source: keyof typeof AD_PERFORMANCE_SOURCE_LABELS; reportedAt: number; note: string }[]
  creditsAvailable: number | null
}

export function AdRequestPanel({ projectId, requestId }: { projectId: string; requestId: string }) {
  const key = `/api/projects/${encodeURIComponent(projectId)}/ads/requests/${encodeURIComponent(requestId)}`
  const { data, error, isLoading, mutate } = useSWR<Payload>(key, jsonFetcher)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [payError, setPayError] = useState<string | null>(null)
  const idempotency = useMemo(
    () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `pay-${Date.now()}`),
    [requestId],
  )

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action)
    setPayError(null)
    try {
      const next = await postJson<Payload>(key, { action, ...extra })
      await mutate(next, { revalidate: false })
      setMessage("")
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "That didn't go through.")
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading your request…</p>
  if (error || !data) {
    return <p className="text-sm text-destructive">We couldn't load that campaign request.</p>
  }

  const { request, events, activities, performance, creditsAvailable } = data
  const status = AD_REQUEST_STATUS_LABELS[request.status] ?? request.status
  const canCancel = !["completed", "rejected", "cancelled", "refunded"].includes(request.status)

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{request.id}</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{request.business.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Status: <span className="font-medium text-foreground">{status}</span>
        </p>
        <a href={request.business.liveUrl} className="mt-2 block break-all text-sm text-primary hover:underline" target="_blank" rel="noopener noreferrer">
          {request.business.liveUrl}
        </a>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{request.promote.pitch}</p>
      </div>

      {request.proposal ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-lg font-semibold">Quotation v{request.proposal.version}</h3>
          <p className="mt-1 text-sm font-medium">{request.proposal.title}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{request.proposal.description}</p>
          <p className="mt-3 text-2xl font-semibold tabular-nums">{request.proposal.creditsPrice.toLocaleString()} Atai Credits</p>
          {request.proposal.estimatedImpressionsMin != null && request.proposal.estimatedImpressionsMax != null ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Estimated impressions: {request.proposal.estimatedImpressionsMin.toLocaleString()}–{request.proposal.estimatedImpressionsMax.toLocaleString()}
            </p>
          ) : null}
          <p className="mt-2 text-xs italic leading-5 text-muted-foreground">{request.proposal.estimateNote || AD_ESTIMATE_DISCLAIMER}</p>
          {request.status === "awaiting_approval" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} onClick={() => act("accept_proposal")} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                Accept quotation
              </button>
              <button type="button" disabled={!!busy} onClick={() => act("decline_proposal")} className="rounded-lg border border-border px-3 py-1.5 text-sm">
                Decline
              </button>
            </div>
          ) : null}
          {request.status === "awaiting_payment" ? (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Your balance: {creditsAvailable == null ? "—" : `${creditsAvailable.toLocaleString()} credits`}. You will only be charged when you confirm.
              </p>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => act("pay", { idempotencyKey: idempotency })}
                className="w-fit rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
              >
                {busy === "pay" ? "Charging…" : `Pay ${request.proposal.creditsPrice.toLocaleString()} credits`}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          No quotation yet. Atai's team reviews each request by hand — submitting does not approve or publish anything.
        </p>
      )}

      {payError ? <p className="text-sm text-destructive">{payError}</p> : null}

      {activities.length > 0 ? (
        <section>
          <h3 className="text-lg font-semibold">Execution</h3>
          <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card">
            {activities.map((activity) => (
              <li key={activity.id} className="px-4 py-3 text-sm">
                <span className="font-medium">{activity.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">{activity.status}</span>
                {activity.publicationUrl ? (
                  <a href={activity.publicationUrl} className="mt-1 block break-all text-xs text-primary" target="_blank" rel="noopener noreferrer">
                    {activity.publicationUrl}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {performance.length > 0 ? (
        <section>
          <h3 className="text-lg font-semibold">Recorded results</h3>
          <p className="mt-1 text-xs italic text-muted-foreground">{AD_ESTIMATE_DISCLAIMER}</p>
          <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card">
            {performance.map((row) => (
              <li key={row.id} className="px-4 py-3 text-sm">
                <span className="font-medium">{row.metric}</span>: {row.value.toLocaleString()}
                <span className="ml-2 text-xs text-muted-foreground">{AD_PERFORMANCE_SOURCE_LABELS[row.source]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="text-lg font-semibold">Timeline</h3>
        <ol className="mt-2 flex flex-col gap-2">
          {events.map((event) => (
            <li key={event.id} className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
              <p className="text-xs text-muted-foreground">
                {event.actor} · {new Date(event.createdAt).toLocaleString()}
              </p>
              <p className="mt-1">{event.detail || event.action}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="rounded-2xl border border-border bg-card p-4">
        <label className="text-sm font-medium" htmlFor="ad-request-reply">
          Message Atai
        </label>
        <textarea
          id="ad-request-reply"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          rows={4}
          className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!message.trim() || !!busy}
            onClick={() => act("message", { body: message.trim() })}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Send
          </button>
          {canCancel ? (
            <button type="button" disabled={!!busy} onClick={() => act("cancel")} className="rounded-lg border border-border px-3 py-1.5 text-sm">
              Cancel request
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
