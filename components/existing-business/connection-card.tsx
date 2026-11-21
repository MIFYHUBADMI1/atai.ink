"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, Copy, Download, KeyRound, Loader2, PlugZap, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  connection,
  domainVerified,
  hostname,
  onChanged,
}: {
  projectId: string
  connection: IntakeView["connection"]
  domainVerified: boolean
  hostname?: string
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<"guide" | "download" | "disconnect" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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
      const data = await postJson<GuideResponse>(`/api/projects/${projectId}/integration-guide`)
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

  async function disconnect() {
    if (busy) return
    setBusy("disconnect")
    setError(null)
    try {
      await deleteJson(`/api/projects/${projectId}/integration-guide`)
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
    <Card data-atai-tour="existing-business-connection">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <PlugZap className="size-4 text-primary" />
          Your application
          <Badge variant={connected ? "default" : "secondary"}>{connection.label}</Badge>
        </CardTitle>
        <CardDescription>
          {connected
            ? `Your app last called Atai ${connection.lastSeenAt ? new Date(connection.lastSeenAt).toLocaleString() : "recently"}. Nothing in Atai builds, hosts or edits it.`
            : "Atai calls this connected once your application has authenticated at least once and the domain is proven yours. Both halves are required — either alone is a half-finished connection."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ol className="flex flex-col gap-2">
          <Step done={!needsDomain} label="Prove the domain is yours" detail={hostname ? hostname : "Add the address where your app runs"} />
          <Step done={Boolean(connection.guideIssuedAt)} label="Issue a connection key and download the guide" detail="Shown once, server-side only, revocable" />
          <Step done={!needsApp} label="Your application calls Atai once" detail={needsApp ? "The first authenticated call is the handshake" : "Recorded — this is the proof Atai trusts"} />
        </ol>

        <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Handshake check</p>
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
        </div>

        {error ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={issueGuide} disabled={busy !== null}>
            {busy === "download" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
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
            <Button type="button" size="sm" variant="ghost" onClick={disconnect} disabled={busy !== null}>
              {busy === "disconnect" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Disconnect
            </Button>
          ) : null}
        </div>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3 shrink-0 text-primary" />
          Reissuing revokes the previous key, so a business never accumulates live credentials.
        </p>
      </CardContent>
    </Card>
  )
}

function Step({ done, label, detail }: { done: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
          done ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-xs font-medium", done ? "text-foreground" : "text-muted-foreground")}>{label}</span>
        <span className="block text-[11px] leading-relaxed text-muted-foreground">{detail}</span>
      </span>
    </li>
  )
}
