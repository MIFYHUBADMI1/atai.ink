"use client"

import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { CheckCircle2, CircleSlash, Loader2, Save, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { jsonFetcher, patchJson, postJson } from "@/lib/client/api"

type SettingsResponse = {
  settings: {
    indexNowEnabled: boolean
    newsletterAutoAnnounce: boolean
    lastIndexedAt?: number
    lastIndexedUrls?: string[]
    lastIndexedStatus?: "submitted" | "failed" | "not-configured"
    lastIndexedError?: string
    gscVerification?: string
    bingVerification?: string
  }
  integrations: {
    indexNow: {
      keyConfigured: boolean
      enabled: boolean
      lastStatus: "submitted" | "failed" | "not-configured"
      lastError?: string
      lastAt?: number
    }
    searchConsole: { connected: boolean; verification: string }
    bingWebmaster: { connected: boolean; verification: string }
  }
}

export function SettingsView() {
  const { data, mutate } = useSWR<SettingsResponse>("/api/admin/blog/settings", jsonFetcher)
  const [indexNowEnabled, setIndexNowEnabled] = useState<boolean | null>(null)
  const [autoAnnounce, setAutoAnnounce] = useState<boolean | null>(null)
  const [gsc, setGsc] = useState<string | null>(null)
  const [bing, setBing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const enabled = indexNowEnabled ?? data?.settings.indexNowEnabled ?? false
  const announceEnabled = autoAnnounce ?? data?.settings.newsletterAutoAnnounce ?? false
  const gscValue = gsc ?? data?.settings.gscVerification ?? ""
  const bingValue = bing ?? data?.settings.bingVerification ?? ""

  async function save() {
    setBusy(true)
    setFlash(null)
    try {
      await patchJson("/api/admin/blog/settings", {
        indexNowEnabled: enabled,
        newsletterAutoAnnounce: announceEnabled,
        gscVerification: gscValue.trim() || undefined,
        bingVerification: bingValue.trim() || undefined,
      })
      await mutate()
      setFlash("Settings saved.")
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not save the settings.")
    } finally {
      setBusy(false)
    }
  }

  async function submitNow() {
    setBusy(true)
    setFlash(null)
    try {
      const response = await postJson<{
        status: string
        urls: string[]
        error?: string
        keyConfigured: boolean
        enabled: boolean
        submittedCount: number
      }>("/api/admin/blog/settings", undefined)
      if (response.status === "submitted") {
        setFlash(
          `Submission ping sent for ${response.submittedCount} URL(s). The engine accepted the ping — that is not a claim that the page is indexed.`,
        )
        await mutate()
        return
      }
      if (response.status === "failed") {
        setFlash(`The submission was not accepted: ${response.error ?? "unknown error"}`)
        await mutate()
        return
      }
      setFlash(
        !response.keyConfigured
          ? "Nothing was sent: INDEXNOW_KEY is not configured in the environment."
          : "Nothing was sent: the IndexNow toggle is off. Turn it on and save first.",
      )
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "The submission could not run.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Discoverability</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each integration reports its real state. A submission is not an indexing guarantee.
        </p>
      </div>

      {flash ? <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{flash}</p> : null}

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">IndexNow</h2>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              Notifies participating engines when an article is published or its URL changes. Requires the
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono">INDEXNOW_KEY</code> environment variable and a
              key file served at <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono">/indexnow/&lt;key&gt;.txt</code>.
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
              data?.integrations.indexNow.keyConfigured ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {data?.integrations.indexNow.keyConfigured ? (
              <CheckCircle2 className="size-3" />
            ) : (
              <CircleSlash className="size-3" />
            )}
            {data?.integrations.indexNow.keyConfigured ? "Key configured" : "Not configured"}
          </span>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={enabled}
            onChange={(event) => setIndexNowEnabled(event.target.checked)}
          />
          Send a submission ping when an article is published
        </label>
        {data?.settings.lastIndexedAt ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Last attempt {new Date(data.settings.lastIndexedAt).toLocaleString()} — status: {data.integrations.indexNow.lastStatus}
            {data.settings.lastIndexedError ? ` (${data.settings.lastIndexedError})` : ""}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Newsletter</h2>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              Announce a newly published article to everyone who asked for guides in their inbox. The message goes out
              through Resend; a reader is never left on the list without an unsubscribe link.
            </p>
          </div>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={announceEnabled}
            onChange={(event) => setAutoAnnounce(event.target.checked)}
          />
          Email newsletter subscribers when an article is published
        </label>
        <p className="mt-2 text-xs text-muted-foreground">
          You can also send an announcement by hand from the{" "}
          <Link href="/admin/blog/newsletter" className="text-primary hover:underline">
            newsletter page
          </Link>
          .
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Google Search Console</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The site verification tag is already deployed in the root layout. The verification token below proves the
            property is claimed; impressions, clicks and queries additionally need service-account credentials in the
            environment.
          </p>
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="gsc">Verification / property token</Label>
            <Input id="gsc" value={gscValue} onChange={(event) => setGsc(event.target.value)} placeholder="google-site-verification=…" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Status: verification token {data?.integrations.searchConsole.verification === "set" ? "saved" : "missing"} ·{" "}
            {data?.integrations.searchConsole.connected
              ? "service account connected — search metrics are available"
              : "service account not connected — search metrics are unavailable"}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Bing Webmaster Tools</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Add the Bing verification token here, or set{" "}
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono">BING_VERIFICATION</code> in the environment to
            emit the meta tag site-wide.
          </p>
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="bing">Verification token</Label>
            <Input id="bing" value={bingValue} onChange={(event) => setBing(event.target.value)} placeholder="msvalidate…" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Status: {data?.integrations.bingWebmaster.connected ? "token saved" : "not connected"}
          </p>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save settings
        </Button>
        <Button variant="outline" onClick={() => void submitNow()} disabled={busy}>
          <Send className="size-4" /> Send submission ping
        </Button>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Search performance data</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Impressions, clicks, queries and average position come from Google Search Console. That connection is not
          active, so those metrics are reported as unavailable rather than as zero. Connect the property to populate
          them, then read them on the{" "}
          <Link href="/admin/blog/performance" className="text-primary hover:underline">
            content performance
          </Link>{" "}
          page.
        </p>
      </section>
    </div>
  )
}
