"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, Copy, Download, KeyRound, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { deleteJson, postJson } from "@/lib/client/api"
import type { IntakeView } from "@/lib/existing-business/view"
import { cn } from "@/lib/utils"

interface GuideResponse {
  markdown: string
  keyPrefix?: string
  connection: { status: string }
  domainVerified: boolean
}

/**
 * The founder-facing half of the connection handshake. Atai only calls a
 * business connected once its own application has authenticated at least once,
 * so this card says what is still missing instead of showing a green badge for
 * an address someone typed.
 */
export function ConnectionCard({
  projectId,
  apiBase,
  connection,
  domainVerified,
  hostname,
  onChanged,
}: {
  projectId: string
  apiBase?: string
  connection: IntakeView["connection"]
  domainVerified: boolean
  hostname?: string
  onChanged: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState<"guide" | "download" | "disconnect" | "check" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // The handshake happens outside this page, so the founder can ask Atai to
  // look again instead of reloading the tab to see it.
  const [checkedAt, setCheckedAt] = useState<number | null>(null)

  const snippet = `# server-side only\nATAI_API_KEY=<your connection key>\n\ncurl -sS ${"${ATAI_BASE_URL:-https://atai.ink}"}/api/runtime/v1/health \\\n  -H "Authorization: Bearer $ATAI_API_KEY"`

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("Your browser blocked the clipboard. Select the snippet and copy it manually.")
    }
  }

  async function issueGuide() {
    if (busy) return
    setBusy("download")
    setError(null)
    try {
      const data = await postJson<GuideResponse>(`${apiBase ?? `/api/projects/${projectId}`}/integration-guide`)
      const blob = new Blob([data.markdown], { type: "text/markdown" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `atai-connection-guide-${projectId}.md`
      link.click()
      URL.revokeObjectURL(url)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not issue a connection key. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  async function checkNow() {
    if (busy) return
    setBusy("check")
    setError(null)
    try {
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check the connection. Please try again.")
    } finally {
      setBusy(null)
      setCheckedAt(Date.now())
    }
  }

  async function disconnect() {
    if (busy) return
    setBusy("disconnect")
    setError(null)
    try {
      await deleteJson(`${apiBase ?? `/api/projects/${projectId}`}/integration-guide`)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect this business.")
    } finally {
      setBusy(null)
    }
  }

  const connected = connection.status === "verified"
  const needsDomain = !domainVerified
  const needsApp = !connection.firstSeenAt

  return (
    <div data-atai-tour="existing-business-connection" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={connected ? "default" : "secondary"}>{connection.label}</Badge>
        <p className="text-xs text-muted-foreground">
          {connected
            ? `Your app last called Atai ${connection.lastSeenAt ? new Date(connection.lastSeenAt).toLocaleString() : "recently"}.`
            : "A connection is only counted once your own application has authenticated — a typed address is not a connection."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={issueGuide} disabled={busy !== null}>
          {busy === "download" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {connection.guideIssuedAt ? "Reissue key & download guide" : "Issue key & download guide"}
        </Button>
        <Link
          href={`/project/${projectId}/runtime`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-2"
        >
          <KeyRound className="size-3.5" />
          Runtime keys & usage
        </Link>
        {connection.status === "verified" || connection.status === "stale" ? (
          <Button type="button" variant="ghost" onClick={disconnect} disabled={busy !== null}>
            {busy === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : null}
            Disconnect
          </Button>
        ) : null}
      </div>

      <ol className="flex flex-col gap-2">
        <Step
          index={1}
          done={!needsDomain}
          label="The domain is proven yours"
          detail={
            needsDomain
              ? "Go back a step — the connection cannot verify without it."
              : `${hostname ?? "The domain"} is proven. This half is finished.`
          }
        />
        <Step
          index={2}
          done={connected || Boolean(connection.guideIssuedAt)}
          label="Issue a connection key"
          detail={connection.guideIssuedAt ? "Issued. Reissuing revokes the previous key." : "One key, shown once, server-side only."}
        />
        <Step
          index={3}
          done={!needsApp}
          label="Your application calls Atai once"
          detail={needsApp ? "That first authenticated call is the handshake Atai records." : "Recorded — this is the proof Atai trusts."}
        />
      </ol>

      {connected ? null : (
        <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={checkNow} disabled={busy !== null}>
              {busy === "check" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Check now
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Already ran the call above? Ask Atai to look again — no need to reload the page.
            </p>
          </div>
          {checkedAt !== null ? (
            <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">
              {needsApp
                ? `Checked ${new Date(checkedAt).toLocaleTimeString()} — no authenticated call from your app has reached Atai yet.`
                : `Checked ${new Date(checkedAt).toLocaleTimeString()} — the call is recorded.`}
            </p>
          ) : null}
        </div>
      )}

      <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">The one call that finishes it</p>
          <button
            type="button"
            onClick={copySnippet}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
          {snippet}
        </pre>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Keep the key on your server. There is no browser-safe key, and Atai never asks for your repository.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3 shrink-0 text-primary" />
        Reissuing revokes the previous key, so a business never accumulates live credentials.
      </p>
    </div>
  )
}

function Step({ index, done, label, detail }: { index: number; done: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/60 px-4 py-3">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
          done ? "border-success/40 bg-success/10 text-success" : "border-border bg-card text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3.5" /> : index}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-sm font-medium", done ? "text-foreground" : "text-muted-foreground")}>{label}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{detail}</span>
      </span>
    </li>
  )
}
