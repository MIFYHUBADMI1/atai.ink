"use client"

import { useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import useSWR from "swr"
import { jsonFetcher, patchJson } from "@/lib/client/api"
import {
  AD_ACTIVITY_STATUS_LABELS,
  AD_ESTIMATE_DISCLAIMER,
  AD_PERFORMANCE_SOURCE_LABELS,
  AD_REQUEST_PRIORITY_LABELS,
  AD_REQUEST_STATUS_LABELS,
} from "@/lib/marketing/ads/request-shared"
import { AD_ACTIVITY_STATUSES, AD_PERFORMANCE_SOURCES, AD_REQUEST_PRIORITIES, AD_REQUEST_STATUSES } from "@/lib/types/ads"

type AdminPayload = {
  request: {
    id: string
    status: keyof typeof AD_REQUEST_STATUS_LABELS
    priority?: keyof typeof AD_REQUEST_PRIORITY_LABELS
    business: Record<string, unknown>
    promote: Record<string, unknown>
    audience: Record<string, unknown>
    preferences: Record<string, unknown>
    assets: { url: string; label: string; kind: string }[]
    creation: Record<string, unknown>
    proposal?: { version: number; title: string; creditsPrice: number }
    payment?: { status: string; creditsCharged: number }
  }
  dossier: {
    founder: { name: string; email: string }
    project: Record<string, unknown>
    application: { valueProposition: string; marketingPlan: string }
    founderStrategy: Record<string, unknown> | null
    generatedAds: { id: string; title: string }[]
  }
  events: { id: string; actor: string; action: string; detail?: string; visibility?: string; createdAt: number }[]
  activities: { id: string; title: string; status: string; channel: string; publicationUrl: string }[]
  performance: { id: string; metric: string; value: number; source: string; reportedAt: number }[]
  packages: { id: string; name: string; creditsPrice: number; durationDays: number; estimatedImpressionsMin: number; estimatedImpressionsMax: number; channels: string[] }[]
}

export default function AdminAdsDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const key = `/api/admin/ads/${encodeURIComponent(id)}`
  const { data, error, isLoading, mutate } = useSWR<AdminPayload>(key, jsonFetcher)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  const [message, setMessage] = useState("")
  const [info, setInfo] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [proposal, setProposal] = useState({
    title: "",
    description: "",
    creditsPrice: 1500,
    duration: "7 days",
    estimatedImpressionsMin: 3000,
    estimatedImpressionsMax: 10000,
    platforms: "Instagram, Facebook",
    packageId: "",
  })
  const [activityTitle, setActivityTitle] = useState("")
  const [metric, setMetric] = useState({ metric: "impressions", value: 0, source: "manual" as const, note: "" })

  async function act(body: Record<string, unknown>) {
    setBusy(true)
    setErr(null)
    try {
      const next = await patchJson<AdminPayload>(key, body)
      await mutate(next, { revalidate: false })
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through.")
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading request…</p>
  if (error || !data) return <p className="p-6 text-sm text-destructive">Could not load this campaign.</p>

  const { request, dossier, events, activities, performance, packages } = data
  const business = request.business as { name?: string; liveUrl?: string; description?: string }

  function applyPackage(packageId: string) {
    const pkg = packages.find((p) => p.id === packageId)
    if (!pkg) return
    setProposal((current) => ({
      ...current,
      packageId,
      title: pkg.name,
      creditsPrice: pkg.creditsPrice,
      duration: `${pkg.durationDays} days`,
      estimatedImpressionsMin: pkg.estimatedImpressionsMin,
      estimatedImpressionsMax: pkg.estimatedImpressionsMax,
      platforms: pkg.channels.join(", "),
      description: current.description || pkg.name,
    }))
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <Link href="/admin/ads" className="text-sm text-muted-foreground hover:text-foreground">
        ← Inbox
      </Link>
      <header className="mt-3 mb-6">
        <p className="font-mono text-xs text-muted-foreground">{request.id}</p>
        <h2 className="text-2xl font-semibold">{business.name}</h2>
        <p className="text-sm text-muted-foreground">
          {AD_REQUEST_STATUS_LABELS[request.status]} · {dossier.founder.name} ({dossier.founder.email})
        </p>
        {business.liveUrl ? (
          <a href={String(business.liveUrl)} className="text-sm text-primary hover:underline" target="_blank" rel="noopener noreferrer">
            {String(business.liveUrl)}
          </a>
        ) : null}
      </header>

      {err ? <p className="mb-4 text-sm text-destructive">{err}</p> : null}

      <div className="mb-6 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => act({ action: "assign" })} className="rounded-lg border border-border px-3 py-1.5 text-sm">
          Assign to me
        </button>
        <select
          disabled={busy}
          defaultValue={request.priority ?? "normal"}
          onChange={(e) => act({ action: "priority", priority: e.target.value })}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
        >
          {AD_REQUEST_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {AD_REQUEST_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select
          disabled={busy}
          value={request.status}
          onChange={(e) => act({ action: "status", status: e.target.value })}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
        >
          {AD_REQUEST_STATUSES.map((status) => (
            <option key={status} value={status}>
              {AD_REQUEST_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <a href={`/api/admin/ads/${id}/export?format=json`} className="rounded-lg border border-border px-3 py-1.5 text-sm">
          Download JSON
        </a>
        <a href={`/api/admin/ads/${id}/export?format=html`} className="rounded-lg border border-border px-3 py-1.5 text-sm">
          Download brief (HTML/PDF print)
        </a>
        {request.payment?.status === "paid" ? (
          <button type="button" disabled={busy} onClick={() => act({ action: "refund", reason: "Campaign could not be delivered." })} className="rounded-lg border border-border px-3 py-1.5 text-sm">
            Refund credits
          </button>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="font-semibold">Founder submission</h3>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5">
            {JSON.stringify(
              {
                business: request.business,
                promote: request.promote,
                audience: request.audience,
                preferences: request.preferences,
                creation: request.creation,
                assets: request.assets,
              },
              null,
              2,
            )}
          </pre>
        </section>
        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="font-semibold">Application intelligence</h3>
          <p className="mt-1 text-xs italic text-muted-foreground">Saved project data — not verified facts. Secrets are never included.</p>
          <p className="mt-3 text-sm whitespace-pre-wrap">{dossier.application.valueProposition || "No value proposition on file."}</p>
          <p className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{dossier.application.marketingPlan.slice(0, 2000)}</p>
          {dossier.generatedAds.length > 0 ? (
            <ul className="mt-3 text-sm">
              {dossier.generatedAds.map((ad) => (
                <li key={ad.id}>{ad.title}</li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-card p-4">
        <h3 className="font-semibold">Quotation builder</h3>
        <p className="mt-1 text-xs italic text-muted-foreground">{AD_ESTIMATE_DISCLAIMER}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <select
            value={proposal.packageId}
            onChange={(e) => applyPackage(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2"
          >
            <option value="">Custom quotation</option>
            {packages.map((pkg) => (
              <option key={pkg.id} value={pkg.id}>
                {pkg.name} · {pkg.creditsPrice} credits
              </option>
            ))}
          </select>
          <input value={proposal.title} onChange={(e) => setProposal({ ...proposal, title: e.target.value })} placeholder="Title" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <input type="number" value={proposal.creditsPrice} onChange={(e) => setProposal({ ...proposal, creditsPrice: Number(e.target.value) })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <textarea value={proposal.description} onChange={(e) => setProposal({ ...proposal, description: e.target.value })} placeholder="Description" className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2" />
          <input type="number" value={proposal.estimatedImpressionsMin} onChange={(e) => setProposal({ ...proposal, estimatedImpressionsMin: Number(e.target.value) })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <input type="number" value={proposal.estimatedImpressionsMax} onChange={(e) => setProposal({ ...proposal, estimatedImpressionsMax: Number(e.target.value) })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            act({
              action: "proposal",
              draft: {
                ...proposal,
                platforms: proposal.platforms.split(",").map((s) => s.trim()).filter(Boolean),
                estimateNote: AD_ESTIMATE_DISCLAIMER,
              },
            })
          }
          className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Send quotation
        </button>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="font-semibold">Messages</h3>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" rows={3} placeholder="Visible to the founder" />
          <button type="button" disabled={busy || !message.trim()} onClick={() => { void act({ action: "message", body: message.trim() }); setMessage("") }} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm">
            Send to founder
          </button>
          <textarea value={info} onChange={(e) => setInfo(e.target.value)} className="mt-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" rows={3} placeholder="Ask for more information" />
          <button type="button" disabled={busy || !info.trim()} onClick={() => { void act({ action: "request_info", body: info.trim() }); setInfo("") }} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm">
            Request more information
          </button>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} className="mt-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" rows={3} placeholder="Internal note (hidden from founder)" />
          <button type="button" disabled={busy || !note.trim()} onClick={() => { void act({ action: "internal_note", body: note.trim() }); setNote("") }} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm">
            Save internal note
          </button>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="font-semibold">Manual execution</h3>
          <div className="mt-2 flex gap-2">
            <input value={activityTitle} onChange={(e) => setActivityTitle(e.target.value)} placeholder="Activity title" className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <button type="button" disabled={busy || !activityTitle.trim()} onClick={() => { void act({ action: "add_activity", title: activityTitle.trim() }); setActivityTitle("") }} className="rounded-lg border border-border px-3 py-1.5 text-sm">
              Add
            </button>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {activities.map((activity) => (
              <li key={activity.id} className="rounded-lg border border-border p-2">
                <p className="font-medium">{activity.title}</p>
                <select
                  value={activity.status}
                  onChange={(e) => act({ action: "update_activity", activityId: activity.id, status: e.target.value })}
                  className="mt-1 rounded border border-border bg-background px-2 py-1 text-xs"
                >
                  {AD_ACTIVITY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {AD_ACTIVITY_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
                {activity.publicationUrl ? <p className="mt-1 break-all text-xs">{activity.publicationUrl}</p> : null}
              </li>
            ))}
          </ul>
          <div className="mt-4 grid gap-2">
            <input value={metric.metric} onChange={(e) => setMetric({ ...metric, metric: e.target.value })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <input type="number" value={metric.value} onChange={(e) => setMetric({ ...metric, value: Number(e.target.value) })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <select value={metric.source} onChange={(e) => setMetric({ ...metric, source: e.target.value as typeof metric.source })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              {AD_PERFORMANCE_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {AD_PERFORMANCE_SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy} onClick={() => act({ action: "add_performance", ...metric })} className="rounded-lg border border-border px-3 py-1.5 text-sm">
              Record result
            </button>
          </div>
        </div>
      </section>

      <ol className="mt-6 space-y-2">
        {events.map((event) => (
          <li key={event.id} className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
            <p className="text-xs text-muted-foreground">
              {event.actor} · {event.visibility ?? "founder"} · {new Date(event.createdAt).toLocaleString()}
            </p>
            <p className="mt-1">{event.detail || event.action}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
