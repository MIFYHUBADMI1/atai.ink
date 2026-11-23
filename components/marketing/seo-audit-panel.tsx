"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Loader2,
  SearchCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chip, EmptyPanel, SectionCard } from "@/components/connected-business/page-ui"
import type { SeoAuditScore, SeoFinding } from "@/lib/types/db"

/**
 * SEO visibility panel (Phase 3 — W2). Client surface on the Growth Overview.
 * Renders the latest stored audit and can trigger a fresh, credit-charged
 * audit of the site's own address via the ownership-gated endpoint. The URL is
 * never supplied here — the server audits the address it is allowed to audit.
 * All figures are deterministic on-page findings; nothing about rankings or
 * traffic is claimed.
 */

export interface SeoAuditView {
  url: string
  status: "completed" | "failed"
  score: { pass: number; fail: number; notObserved: number }
  auditScore?: SeoAuditScore | null
  pagesCrawled: number
  findings: SeoFinding[]
  fromCache: boolean
  createdAt: number
}

export interface SeoPanelState {
  enabled: boolean
  /** True when the server has an address it is allowed to audit for this surface. */
  ready: boolean
  /** What to do when it does not — surface-specific, never assumed. */
  notReadyMessage: string
  cost: number
  available: number
  /** Destination of the full SEO & Visibility workspace, when one exists. */
  href?: string
  latest: SeoAuditView | null
}

function statusIcon(status: SeoFinding["status"]) {
  if (status === "pass") return <CircleCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="pass" />
  if (status === "fail") return <CircleX className="h-4 w-4 text-red-600 dark:text-red-400" aria-label="fail" />
  return <CircleDashed className="h-4 w-4 text-muted-foreground" aria-label="not observed" />
}

/**
 * The one number the audit produces, as a ring. It is drawn only when a stored
 * score exists, so an audit with no score never looks like a perfect one.
 */
function ScoreRing({ value, caption }: { value: number; caption: string }) {
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value))
  const offset = circumference - (clamped / 100) * circumference
  const tone = clamped >= 80 ? "text-emerald-500" : clamped >= 50 ? "text-amber-500" : "text-red-500"

  return (
    <div className="flex shrink-0 items-center gap-3">
      <div className="relative grid size-20 place-items-center">
        <svg viewBox="0 0 80 80" className="size-20 -rotate-90" role="img" aria-label={`${clamped} out of 100`}>
          <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="8" className="stroke-muted" />
          <circle
            cx="40"
            cy="40"
            r={radius}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`${tone} stroke-current transition-[stroke-dashoffset] duration-500`}
          />
        </svg>
        <span className="absolute text-lg font-semibold tabular-nums">{clamped}</span>
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Score</p>
        <p className="text-xs leading-5 text-muted-foreground">{caption}</p>
      </div>
    </div>
  )
}

export function SeoAuditPanel({ apiBase, state }: { apiBase: string; state: SeoPanelState }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [latest, setLatest] = useState<SeoAuditView | null>(state.latest)
  /**
   * Phase 3 (Workstream C): one stable intent id per audit *attempt*. It is
   * kept across a network-level failure so retrying an audit whose outcome we
   * never saw cannot charge twice; it is replaced as soon as the server gives
   * a definitive answer, so the next audit is a genuinely new operation.
   * Idempotency identity only — the server scopes it by user + project and it
   * grants nothing.
   */
  const intentRef = useRef<string | null>(null)

  if (!state.enabled) {
    return (
      <SectionCard
        icon={SearchCheck}
        title="SEO visibility"
        description="A bounded crawl of your own site, checked against on-page fundamentals. No rankings, traffic or conversions are claimed."
      >
        <p className="text-sm leading-6 text-muted-foreground">
          SEO visibility audits are switched off. You choose which features live in your workspace —{" "}
          <Link href="/settings/features" className="font-medium text-primary hover:underline">
            turn them on in Settings
          </Link>
          .
        </p>
      </SectionCard>
    )
  }

  const shortfall = Math.max(0, state.cost - state.available)
  const affordable = shortfall === 0
  const canRun = state.ready && affordable && !running

  async function runAudit() {
    setRunning(true)
    if (!intentRef.current) {
      const randomId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `seo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      intentRef.current = randomId
    }
    try {
      const response = await fetch(`${apiBase}/seo-audit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: intentRef.current }),
      })
      const json = await response.json()
      // The server answered definitively — this attempt is settled, so the
      // next click is a new operation with its own intent id.
      intentRef.current = null
      if (!response.ok || !json.ok) {
        const code = json?.error?.code
        const msg = json?.error?.message ?? "The audit couldn't run."
        toast.error(code === "INSUFFICIENT_CREDITS" ? "Not enough credits for this audit." : msg)
        return
      }
      const d = json.data
      setLatest({
        url: d.url,
        status: "completed",
        score: d.score,
        auditScore: d.auditScore ?? null,
        pagesCrawled: d.pagesCrawled,
        findings: d.findings,
        fromCache: false,
        createdAt: d.completedAt,
      })
      toast.success(`Audit complete — ${d.score.pass} passed, ${d.score.fail} to improve.`)
      router.refresh()
    } catch {
      toast.error("The audit couldn't run. Please try again.")
    } finally {
      setRunning(false)
    }
  }

  const action = (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      {state.href ? (
        <Link
          href={state.href}
          className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Open SEO &amp; Visibility →
        </Link>
      ) : null}
      <Button size="sm" variant={latest ? "outline" : "default"} onClick={runAudit} disabled={!canRun} className="w-full sm:w-auto">
        {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
        {latest ? "Re-run audit" : "Run audit"}
        {state.cost > 0 ? <span className="ml-1 opacity-80">· {state.cost} credits</span> : null}
      </Button>
    </div>
  )

  return (
    <SectionCard
      icon={SearchCheck}
      title="SEO visibility"
      description="A bounded crawl of your own site, checked against on-page fundamentals. No rankings, traffic or conversions are claimed."
      actions={state.ready ? action : undefined}
    >
      {!state.ready ? (
        <p className="text-sm leading-6 text-muted-foreground">{state.notReadyMessage}</p>
      ) : !affordable ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
            <span>
              This audit costs {state.cost} credits and your balance is {state.available}. You need {shortfall} more.
            </span>
          </p>
          <Link href="/settings/billing" className="text-sm font-medium text-primary hover:underline">
            Top up credits →
          </Link>
        </div>
      ) : running ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
          <p className="text-sm text-muted-foreground">Crawling your site and checking on-page fundamentals…</p>
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="h-4 w-full animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
      ) : !latest ? (
        <EmptyPanel
          icon={SearchCheck}
          title="No audit yet"
          description={
            state.cost > 0
              ? `Checks the title, description, headings, links and HTTPS of the address you proved. Costs ${state.cost} credits, refunded if the crawl fails.`
              : "Checks the title, description, headings, links and HTTPS of the address you proved."
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
            {latest.auditScore?.value != null ? (
              <ScoreRing
                value={latest.auditScore.value}
                caption={`${latest.pagesCrawled} page${latest.pagesCrawled === 1 ? "" : "s"} crawled`}
              />
            ) : null}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Chip tone="success">{latest.score.pass} pass</Chip>
              <Chip tone={latest.score.fail > 0 ? "danger" : "muted"}>{latest.score.fail} to improve</Chip>
              <Chip>{latest.score.notObserved} not observed</Chip>
              {latest.fromCache ? <Chip>recent cache</Chip> : null}
            </div>
          </div>

          <p className="min-w-0 break-all font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {latest.url}
          </p>

          <ul className="flex flex-col gap-2">
            {latest.findings.map((f) => (
              <li
                key={f.id}
                className="flex min-w-0 items-start gap-2 border-t border-border/60 pt-2 text-sm first:border-0 first:pt-0"
              >
                <span className="mt-0.5 shrink-0">{statusIcon(f.status)}</span>
                <span className="min-w-0 break-words">
                  <span className="font-medium">{f.label}</span>
                  {f.observed ? <span className="text-muted-foreground"> — {f.observed}</span> : null}
                  {f.note ? <span className="block text-xs italic text-muted-foreground">{f.note}</span> : null}
                </span>
              </li>
            ))}
          </ul>

          <p className="border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
            Deterministic on-page findings from a bounded crawl of your own site. Atai does not measure search rankings,
            traffic, or conversions — these are configuration checks only.
          </p>
        </div>
      )}
    </SectionCard>
  )
}
