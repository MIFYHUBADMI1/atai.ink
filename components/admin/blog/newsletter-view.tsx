"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { AlertTriangle, CheckCircle2, CircleSlash, Download, Loader2, Mail, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { jsonFetcher, postJson } from "@/lib/client/api"
import type { BlogArticleView } from "@/lib/blog/types"

type Subscriber = {
  id: string
  email: string
  source: string
  createdAtMs: number
  unsubscribedAt?: number
}

type Campaign = {
  id: string
  articleId: string
  slug: string
  title: string
  subject: string
  status: "sending" | "sent" | "partial" | "failed" | "not-configured"
  recipients: number
  sentCount: number
  failedCount: number
  skippedCount: number
  error?: string
  trigger: "publish" | "manual"
  createdAtMs: number
}

type NewsletterResponse = {
  items: Subscriber[]
  total: number
  subscribers: number
  campaigns: Campaign[]
  autoAnnounce: boolean
  integration: { configured: boolean; from: string | null }
}

type AnnouncementResponse = {
  announcement: {
    status: "sent" | "partial" | "failed" | "not-configured" | "skipped"
    recipients: number
    sentCount: number
    failedCount: number
    skippedCount: number
    reason?: string
    error?: string
  }
}

const CAMPAIGN_LABEL: Record<Campaign["status"], string> = {
  sending: "Sending",
  sent: "Sent",
  partial: "Partly sent",
  failed: "Failed",
  "not-configured": "Not configured",
}

export function NewsletterView() {
  const { data, isLoading, mutate } = useSWR<NewsletterResponse>("/api/admin/blog/newsletter", jsonFetcher)
  const { data: articleData } = useSWR<{ items: BlogArticleView[] }>("/api/admin/blog?status=published", jsonFetcher)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState("")
  const [sending, setSending] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const items = useMemo(
    () =>
      (data?.items ?? []).filter((entry) =>
        query.trim() ? entry.email.toLowerCase().includes(query.trim().toLowerCase()) : true,
      ),
    [data?.items, query],
  )

  const published = useMemo(
    () => (articleData?.items ?? []).filter((article) => article.status === "published"),
    [articleData?.items],
  )

  async function announce() {
    if (!selected) return
    setSending(true)
    setFlash(null)
    try {
      const response = await postJson<AnnouncementResponse>("/api/admin/blog/newsletter", { articleId: selected })
      const result = response.announcement
      setFlash(
        result.status === "sent"
          ? `The provider accepted ${result.sentCount} of ${result.recipients} message(s). Delivery to an inbox is not a claim that the message was read.`
          : result.status === "partial"
            ? `${result.sentCount} of ${result.recipients} message(s) were accepted; ${result.failedCount} failed.`
            : result.status === "not-configured"
              ? "Nothing was sent: the mail provider is not configured."
              : result.status === "skipped"
                ? (result.reason ?? "Nothing was sent.")
                : `The announcement failed: ${result.error ?? "unknown error"}`,
      )
      await mutate()
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "The announcement could not run.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Newsletter</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone who asked for new guides in their inbox, and every announcement that went out.
        </p>
      </div>

      {flash ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{flash}</p>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Delivery</h2>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              Announcements are sent with Resend. A configured provider means a key and a sender are set — it is never a
              claim that a message was delivered.
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
              data?.integration.configured ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {data?.integration.configured ? (
              <CheckCircle2 className="size-3" />
            ) : (
              <CircleSlash className="size-3" />
            )}
            {data?.integration.configured ? `Resend · ${data.integration.from}` : "Not configured"}
          </span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Automatic announcements on publish:{" "}
          <span className="font-medium text-foreground">{data?.autoAnnounce ? "on" : "off"}</span> —{" "}
          <Link href="/admin/blog/settings" className="text-primary hover:underline">
            change it in settings
          </Link>
          .
        </p>
        {!data?.integration.configured ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            Set <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono">RESEND_API_KEY</code> and{" "}
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono">RESEND_FROM_EMAIL</code> in the environment to
            send announcements.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-56">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Announce a published article</span>
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
            >
              <option value="">Choose an article…</option>
              {published.map((article) => (
                <option key={article.id} value={article.id}>
                  {article.title}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" onClick={() => void announce()} disabled={sending || !selected}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send announcement
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Subscribers</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {data ? `${data.subscribers} receiving · ${data.total - data.subscribers} unsubscribed` : "—"}
            </p>
          </div>
          <Button variant="outline" size="sm" render={<a href="/api/admin/blog/newsletter?format=csv" download="atai-newsletter.csv" />}>
            <Download className="size-4" /> Export CSV
          </Button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by email"
            className="h-9 w-full max-w-xs rounded-lg border border-border bg-background px-3 text-sm"
            aria-label="Filter subscribers by email"
          />
          <span className="text-xs text-muted-foreground">
            {data ? `${items.length} of ${data.total}` : "—"}
          </span>
        </div>

        {isLoading ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading subscribers…
          </p>
        ) : items.length ? (
          <ul className="mt-3 max-h-96 space-y-1.5 overflow-y-auto">
            {items.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <span className="inline-flex min-w-0 items-center gap-2 text-sm">
                  <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{entry.email}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {entry.unsubscribedAt ? "unsubscribed" : entry.source} ·{" "}
                  {new Date(entry.createdAtMs).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {data?.total ? "No subscriber matches that filter." : "No subscribers yet."}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Announcement history</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          What the mail provider accepted — not evidence that a reader opened anything.
        </p>
        {data?.campaigns.length ? (
          <ul className="mt-3 space-y-2">
            {data.campaigns.map((campaign) => (
              <li key={campaign.id} className="rounded-lg border border-border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {campaign.title}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{campaign.trigger}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {CAMPAIGN_LABEL[campaign.status]} · {campaign.sentCount}/{campaign.recipients} accepted ·{" "}
                    {new Date(campaign.createdAtMs).toLocaleString()}
                  </span>
                </div>
                {campaign.error ? <p className="mt-1 text-xs text-muted-foreground">{campaign.error}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No announcements have been sent yet.</p>
        )}
      </section>
    </div>
  )
}
