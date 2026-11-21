"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Building2, Globe, Loader2, PlugZap, RefreshCw, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { jsonFetcher, postJson } from "@/lib/client/api"
import type { IntakeView } from "@/lib/existing-business/view"
import type { IntakeStageStatus } from "@/lib/types/business-intake"
import { AssessmentReport } from "./assessment-report"
import { ConnectionCard } from "./connection-card"
import { DomainVerification } from "./domain-verification"
import { cn } from "@/lib/utils"

const STAGE_LABEL: Record<IntakeStageStatus, string> = {
  pending: "Waiting to start",
  processing: "Reading…",
  completed: "Done",
  partially_completed: "Done, with gaps",
  failed: "Could not complete",
  skipped: "Not provided",
}

function stageTone(status: IntakeStageStatus): string {
  if (status === "completed") return "bg-primary/10 text-primary"
  if (status === "failed") return "bg-destructive/10 text-destructive"
  if (status === "processing" || status === "pending") return "bg-amber-500/15 text-amber-700 dark:text-amber-400"
  if (status === "partially_completed") return "bg-amber-500/15 text-amber-700 dark:text-amber-400"
  return "bg-secondary text-secondary-foreground"
}

function StageChip({ status }: { status: IntakeStageStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium", stageTone(status))}>
      {status === "processing" ? <Loader2 className="size-3 animate-spin" /> : null}
      {STAGE_LABEL[status]}
    </span>
  )
}

const POLL_MS = 4000

export function BusinessProfile({ projectId, initialView }: { projectId: string; initialView: IntakeView }) {
  const [view, setView] = useState<IntakeView>(initialView)
  const [busy, setBusy] = useState<"retry" | "reassess" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await jsonFetcher<IntakeView>(`/api/projects/${projectId}/intake`)
      setView(next)
    } catch {
      // A failed poll is not a failed intake — keep the last honest state.
    }
  }, [projectId])

  const running = view.overall === "pending" || view.overall === "processing"

  useEffect(() => {
    if (!running) return
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [running, refresh])

  async function startRun(action?: "reassess") {
    setBusy(action === "reassess" ? "reassess" : "retry")
    setError(null)
    try {
      const data = await postJson<{ started: boolean; view: IntakeView }>(`/api/projects/${projectId}/intake`, action ? { action } : {})
      setView(data.view)
      if (!data.started && action !== "reassess") {
        await refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the run. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  const website = view.website
  const connection = view.connection
  const assessment = view.assessment

  return (
    <div className="flex flex-col gap-4">
      <Card data-atai-tour="existing-business-status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4 text-primary" />
            {view.displayName || "Your existing business"}
          </CardTitle>
          <CardDescription>
            {running
              ? "Atai is reading the sources you shared. Each step below reports its own real outcome — nothing is marked done until it is."
              : view.overall === "partially_completed"
                ? "Atai read what it could. The steps that failed say why, and everything learned is kept."
                : view.overall === "failed"
                  ? "This run could not complete. Your answers are saved — try again when ready."
                  : "This is the honest record of what Atai read and what your co-founder made of it."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {view.description ? (
            <p className="whitespace-pre-wrap rounded-xl border border-border/70 bg-secondary/30 p-3 text-xs leading-relaxed text-muted-foreground">
              {view.description}
            </p>
          ) : null}
          {view.objectives.length ? (
            <div className="flex flex-wrap gap-1.5">
              {view.objectives.map((objective) => (
                <Badge key={objective.id} variant="secondary">
                  {objective.label}
                </Badge>
              ))}
            </div>
          ) : null}

          <ul className="grid gap-2 lg:grid-cols-3">
            <li className="rounded-xl border border-border/70 bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Globe className="size-3.5 text-muted-foreground" />
                  Website
                </span>
                <StageChip status={website.status} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {website.submitted ? website.url : "No website provided."}
                {website.analyzed ? ` · ${website.pagesCrawled ?? 0} page(s) read${website.fromCache ? " (cached, no new spend)" : ""}.` : ""}
              </p>
              {website.error ? <p className="mt-1.5 text-[11px] leading-relaxed text-destructive">{website.error.message}</p> : null}
            </li>
            <li className="rounded-xl border border-border/70 bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <PlugZap className="size-3.5 text-muted-foreground" />
                  Your application
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
                    connection.status === "verified"
                      ? "bg-primary/10 text-primary"
                      : connection.status === "revoked" || connection.status === "stale"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                  )}
                >
                  {connection.label}
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {connection.lastSeenAt
                  ? `Your app last called Atai on ${new Date(connection.lastSeenAt).toLocaleString()}.`
                  : "No call from your app has reached Atai yet."}
                {connection.status === "awaiting_domain"
                  ? " Prove the domain is yours to finish the connection."
                  : connection.status === "awaiting_app"
                    ? " The domain is yours — the connection completes when your app calls Atai once."
                    : ""}
              </p>
              <Link
                href={`/project/${projectId}/runtime`}
                className="mt-1.5 inline-flex text-[11px] font-medium text-primary underline underline-offset-2"
              >
                Connect your application
              </Link>
            </li>
            <li className="rounded-xl border border-border/70 bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Sparkles className="size-3.5 text-muted-foreground" />
                  Co-founder assessment
                </span>
                <StageChip status={assessment.status} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {assessment.status === "completed" && assessment.generatedAt
                  ? `Written ${new Date(assessment.generatedAt).toLocaleString()}.`
                  : assessment.status === "processing"
                    ? "Your co-founder is writing the first read of your business."
                    : assessment.status === "failed"
                      ? "The assessment could not be produced. Your evidence is saved."
                      : "Runs after the sources are read."}
              </p>
              {assessment.error ? <p className="mt-1.5 text-[11px] leading-relaxed text-destructive">{assessment.error.message}</p> : null}
            </li>
          </ul>

          {error ? (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {!running && view.overall !== "completed" ? (
              <Button type="button" size="sm" onClick={() => startRun()} disabled={busy !== null}>
                {busy === "retry" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {view.overall === "failed" ? "Try again" : "Continue reading my business"}
              </Button>
            ) : null}
            {!running && assessment.status !== "processing" ? (
              <Button type="button" size="sm" variant="outline" onClick={() => startRun("reassess")} disabled={busy !== null}>
                {busy === "reassess" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {assessment.result ? "Refresh the assessment" : "Run the assessment"}
              </Button>
            ) : null}
            {running ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                This page updates itself as each step finishes.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {assessment.result ? <AssessmentReport assessment={assessment.result} /> : null}

      <ConnectionCard
        projectId={projectId}
        connection={connection}
        domainVerified={view.domain.verified}
        hostname={view.domain.hostname}
        onChanged={refresh}
      />

      <DomainVerification
        projectId={projectId}
        initialDomains={view.domain.records}
        defaultUrl={website.url}
        onChanged={refresh}
      />
    </div>
  )
}