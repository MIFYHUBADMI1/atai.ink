"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Building2, Check, ChevronRight, Loader2, Lock, RefreshCw, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { jsonFetcher, postJson } from "@/lib/client/api"
import type { IntakeView } from "@/lib/existing-business/view"
import { businessSteps, type BusinessStep } from "@/lib/existing-business/steps"
import { intakeStatusLabel } from "@/lib/existing-business/stage-labels"
import { cn } from "@/lib/utils"
import { AssessmentReport } from "./assessment-report"
import { ConnectionCard } from "./connection-card"
import { DomainVerification } from "./domain-verification"

const POLL_MS = 4000

/**
 * One step at a time. The founder sees the step they are on and nothing past
 * it: a wall of every section at once is what makes "what do I do next?"
 * unanswerable. Steps unlock only when the previous one is finished and
 * verified, and a finished step stays open for review.
 */
export function BusinessProfile({ projectId, initialView }: { projectId: string; initialView: IntakeView }) {
  const [view, setView] = useState<IntakeView>(initialView)
  const [busy, setBusy] = useState<"retry" | "reassess" | null>(null)
  const [error, setError] = useState<string | null>(null)
  // `null` means "follow the current step"; a number means the founder opened
  // an earlier step to re-read it, and should not be moved off it.
  const [pinned, setPinned] = useState<number | null>(null)

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
      const data = await postJson<{ started: boolean; view: IntakeView }>(
        `/api/projects/${projectId}/intake`,
        action ? { action } : {},
      )
      setView(data.view)
      if (!data.started && action !== "reassess") await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the run. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  const { steps, current } = businessSteps(view)
  const lastIndex = steps.length - 1
  const activeIndex = pinned ?? (current === -1 ? lastIndex : current)
  const active = steps[activeIndex]
  const next = steps[activeIndex + 1]
  const allDone = current === -1

  return (
    <div className="flex flex-col gap-4">
      <Card data-atai-tour="existing-business-status">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4 text-primary" />
              {view.displayName || "Your existing business"}
            </CardTitle>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Step {activeIndex + 1} of {steps.length}
            </span>
          </div>
          <CardDescription>
            {allDone
              ? "All three steps are done. Your business is connected and your co-founder can work from it."
              : "One step at a time — the next one opens as soon as this one is done and verified."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {view.objectives.length ? (
            <div className="flex flex-wrap gap-1.5">
              {view.objectives.map((objective) => (
                <Badge key={objective.id} variant="secondary">
                  {objective.label}
                </Badge>
              ))}
            </div>
          ) : null}

          <ol className="flex flex-col gap-1.5">
            {steps.map((step, index) => (
              <StepRow
                key={step.id}
                step={step}
                index={index}
                active={index === activeIndex}
                locked={current !== -1 && index > current}
                onOpen={() => setPinned(index === current ? null : index)}
              />
            ))}
          </ol>
        </CardContent>
      </Card>

      <div data-step={active.id}>
        {active.id === "assessment" ? (
          <AssessmentStep
            view={view}
            running={running}
            busy={busy}
            error={error}
            onStart={startRun}
          />
        ) : null}

        {active.id === "domain" ? (
          <DomainVerification
            projectId={projectId}
            initialDomains={view.domain.records}
            defaultUrl={view.website.url}
            onChanged={refresh}
          />
        ) : null}

        {active.id === "connection" ? (
          <ConnectionCard
            projectId={projectId}
            connection={view.connection}
            domainVerified={view.domain.verified}
            hostname={view.domain.hostname}
            onChanged={refresh}
          />
        ) : null}
      </div>

      {error && active.id !== "assessment" ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {next ? (
          <Button type="button" size="sm" onClick={() => setPinned(null)} disabled={!active.done}>
            Next: {next.title}
            <ArrowRight className="size-3.5" />
          </Button>
        ) : (
          <Link href={`/project/${projectId}/collaborate`} className={buttonVariants({ size: "sm", variant: "outline" })}>
            <Sparkles className="size-3.5" />
            Ask your co-founder
          </Link>
        )}
        {!active.done && next ? (
          <p className="text-xs text-muted-foreground">
            {active.id === "assessment" ? "Finish the read first." : "This step has to be verified before the next one opens."}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function StepRow({
  step,
  index,
  active,
  locked,
  onOpen,
}: {
  step: BusinessStep
  index: number
  active: boolean
  locked: boolean
  onOpen: () => void
}) {
  return (
    <li data-atai-tour={step.tour}>
      <button
        type="button"
        onClick={onOpen}
        disabled={locked}
        aria-current={active ? "step" : undefined}
        className={cn(
          "flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
          active ? "border-primary/40 bg-primary/5" : "border-border/70 bg-card",
          locked ? "cursor-not-allowed opacity-60" : "hover:border-primary/30",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
            step.done
              ? "border-primary/40 bg-primary/10 text-primary"
              : active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground",
          )}
        >
          {step.done ? <Check className="size-3" /> : index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-xs font-medium", step.done || active ? "text-foreground" : "text-muted-foreground")}>
            {step.title}
          </span>
          {!step.done ? (
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{step.requirement}</span>
          ) : null}
        </span>
        {locked ? (
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : active ? null : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
    </li>
  )
}

function AssessmentStep({
  view,
  running,
  busy,
  error,
  onStart,
}: {
  view: IntakeView
  running: boolean
  busy: "retry" | "reassess" | null
  error: string | null
  onStart: (action?: "reassess") => void
}) {
  const assessment = view.assessment
  const website = view.website

  if (assessment.result) {
    return (
      <div className="flex flex-col gap-3">
        <AssessmentReport assessment={assessment.result} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onStart("reassess")} disabled={busy !== null || running}>
            {busy === "reassess" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Refresh the assessment
          </Button>
          {assessment.generatedAt ? (
            <p className="text-[11px] text-muted-foreground">
              Written {new Date(assessment.generatedAt).toLocaleString()}.
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" />
          {running ? "Reading your business" : assessment.status === "failed" ? "The read did not finish" : "Your first read"}
        </CardTitle>
        <CardDescription>
          {running
            ? "This page updates itself. Nothing is marked done until it really is."
            : assessment.status === "failed"
              ? "Your answers and whatever was already read are saved. Trying again does not re-ask anything."
              : "Two stages run in order: your website's public pages, then the assessment written from them."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          <StageLine
            label={website.url ? `Website — ${website.url}` : "Website"}
            status={website.status}
            detail={
              website.analyzed
                ? `${website.pagesCrawled ?? 0} page(s) read${website.fromCache ? " (cached, no new spend)" : ""}`
                : website.error?.message
            }
          />
          <StageLine
            label="Co-founder assessment"
            status={assessment.status}
            detail={assessment.status === "processing" ? "Writing the first read" : assessment.error?.message}
          />
        </ul>

        {error ? (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        {!running ? (
          <div className="flex flex-wrap items-center gap-2">
            {assessment.status !== "completed" ? (
              <Button type="button" size="sm" onClick={() => onStart()} disabled={busy !== null}>
                {busy === "retry" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {assessment.status === "failed" ? "Try again" : "Continue reading my business"}
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="outline" onClick={() => onStart("reassess")} disabled={busy !== null}>
              {busy === "reassess" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Run the assessment
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            This page updates itself as each stage finishes.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function StageLine({ label, status, detail }: { label: string; status: IntakeView["assessment"]["status"]; detail?: string }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-card px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{label}</span>
        {detail ? <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{detail}</span> : null}
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
          status === "completed"
            ? "bg-primary/10 text-primary"
            : status === "failed"
              ? "bg-destructive/10 text-destructive"
              : status === "processing" || status === "pending"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "bg-secondary text-secondary-foreground",
        )}
      >
        {intakeStatusLabel(status)}
      </span>
    </li>
  )
}
