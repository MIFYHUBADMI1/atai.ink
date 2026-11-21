"use client"

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react"
import Link from "next/link"
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Compass,
  Globe,
  Loader2,
  Lock,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { jsonFetcher, postJson } from "@/lib/client/api"
import type { IntakeView } from "@/lib/existing-business/view"
import { businessSteps, type BusinessStep, type BusinessStepId } from "@/lib/existing-business/steps"
import { intakeStatusLabel } from "@/lib/existing-business/stage-labels"
import { cn } from "@/lib/utils"
import { AssessmentReport } from "./assessment-report"
import { ConnectionCard } from "./connection-card"
import { DomainVerification } from "./domain-verification"

const POLL_MS = 4000

type IconType = ComponentType<{ className?: string }>

/** How each step is presented. The order and the completion rules live in
 * `lib/existing-business/steps.ts` — this is only wording and iconography. */
const STEP_COPY: Record<BusinessStepId, { icon: IconType; purpose: string; whyTitle: string; why: string; minutes: string }> = {
  assessment: {
    icon: Sparkles,
    purpose:
      "Atai reads a few public pages of your site and writes the first assessment: what it saw, what it inferred, and what to do first.",
    whyTitle: "Why this comes first",
    why: "Every section after this — market, ads, finances, lessons — builds on this read. Get it right and the advice stops being generic.",
    minutes: "about a minute",
  },
  domain: {
    icon: ShieldCheck,
    purpose:
      "A typed address proves nothing. One meta tag or file on your site tells Atai the business is really yours — and a proven domain is what makes a connection count.",
    whyTitle: "Why this step exists",
    why: "Without it your app can still call Atai, but the connection stays half-finished. Proof of ownership is the half only you can supply.",
    minutes: "about two minutes",
  },
  connection: {
    icon: PlugZap,
    purpose:
      "Issue a key, keep it on your server, and let your app call Atai once. That single call is the handshake — after it your co-founder works from live signals, not one read.",
    whyTitle: "What the handshake unlocks",
    why: "Until your app calls, Atai is advising a business it can only see from the outside. One authenticated call and it starts seeing what actually happens.",
    minutes: "one line of code",
  },
}

/**
 * The business profile is walked one step at a time. The founder sees the step
 * they are on and nothing past it: a wall of every section at once is what made
 * "what do I do next?" unanswerable.
 */
export function BusinessProfile({ projectId, initialView }: { projectId: string; initialView: IntakeView }) {
  const [view, setView] = useState<IntakeView>(initialView)
  const [busy, setBusy] = useState<"retry" | "reassess" | null>(null)
  const [error, setError] = useState<string | null>(null)
  // `null` means "follow the current step"; a number means the founder opened
  // an earlier step to re-read it and should not be moved off it.
  const [pinned, setPinned] = useState<number | null>(null)
  const [finished, setFinished] = useState<BusinessStep | null>(null)

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
  const doneCount = steps.filter((step) => step.done).length
  const allDone = current === -1
  const activeIndex = pinned ?? (allDone ? steps.length - 1 : current)
  const active = steps[activeIndex]
  const nextStep = steps[activeIndex + 1]
  const copy = STEP_COPY[active.id]

  // Announce a step the moment it becomes true, and move the founder on. The
  // initial signature means arriving on an already-finished step says nothing.
  const signature = steps.map((step) => (step.done ? "1" : "0")).join("")
  const previous = useRef(signature)
  useEffect(() => {
    if (previous.current === signature) return
    const before = previous.current.split("")
    const newlyDone = steps.filter((step, index) => step.done && before[index] !== "1")
    previous.current = signature
    if (!newlyDone.length) return
    const step = newlyDone[newlyDone.length - 1]
    setFinished(step)
    setPinned(null)
    const remaining = steps.filter((candidate) => !candidate.done)
    toast.success(`${step.title} — done.`, {
      description: remaining.length
        ? `One step left: ${remaining[0].title.toLowerCase()}.`
        : "Your business is connected. Your co-founder can start working from it.",
    })
  }, [signature, steps])

  const hostname = view.domain.hostname ?? view.website.url?.replace(/^https?:\/\//, "").replace(/\/$/, "")

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4" data-atai-tour="existing-business-status">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
            <Globe className="size-3" />
            Connected business
          </span>
          <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
            Atai advises this business — it never rebuilds or redeploys it
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {view.displayName || "Your existing business"}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {allDone
              ? "All three steps are done. Your co-founder can see this business now — ask it anything, or pick the section that matches your goal."
              : `${doneCount} of ${steps.length} steps done. Finish the one below and the next opens on its own — nothing else on this page needs your attention yet.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {view.website.url ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              <Globe className="size-3" />
              {hostname}
            </span>
          ) : null}
          {view.objectives.map((objective) => (
            <Badge key={objective.id} variant="secondary">
              {objective.label}
            </Badge>
          ))}
          {view.assessment.result && active.id !== "assessment" ? (
            <button
              type="button"
              onClick={() => setPinned(0)}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Sparkles className="size-3" />
              Your first read is ready
              <ChevronRight className="size-3" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          {finished ? (
            <div className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success/10 px-4 py-3 text-success">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <p className="min-w-0 flex-1 text-sm leading-6">
                <span className="font-semibold">{finished.title} — done.</span>{" "}
                <span className="text-success/90">
                  {nextStep ? `Next: ${nextStep.title.toLowerCase()}.` : "Every step is finished."}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setFinished(null)}
                className="rounded-md p-1 text-success/70 transition-colors hover:bg-success/10 hover:text-success"
                aria-label="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}

          <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-7">
            <header className="flex items-start gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary [&_svg]:size-5">
                <copy.icon />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Step {activeIndex + 1} of {steps.length}
                  <span className="text-muted-foreground/60"> · </span>
                  {active.done ? "done" : copy.minutes}
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-balance sm:text-2xl">{active.title}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.purpose}</p>
              </div>
            </header>

            <div className="mt-6 border-t border-border/70 pt-6">
              {active.id === "assessment" ? (
                <AssessmentStep view={view} running={running} busy={busy} error={error} onStart={startRun} />
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

            <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                {active.done ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-success" />
                    This step is finished.
                  </>
                ) : (
                  <>
                    <Lock className="size-3.5" />
                    The next step stays closed until this one is verified.
                  </>
                )}
              </p>
              {nextStep ? (
                <Button
                  type="button"
                  onClick={() => setPinned(activeIndex + 1 === current ? null : activeIndex + 1)}
                  disabled={!active.done}
                >
                  Next: {nextStep.title}
                  <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Link href={`/project/${projectId}/collaborate`} className={buttonVariants({ size: "default" })}>
                  <Sparkles className="size-4" />
                  Ask your co-founder
                </Link>
              )}
            </footer>
          </section>

          {allDone ? <NextBestActions projectId={projectId} /> : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-28">
          <nav aria-label="Your connection path" className="rounded-2xl border border-border/80 bg-card p-5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Your path</p>
              <p className="font-mono text-[10px] text-muted-foreground">
                {doneCount}/{steps.length}
              </p>
            </div>
            <ol className="relative mt-4 flex flex-col gap-4">
              <span aria-hidden className="absolute left-[15px] top-3 bottom-3 w-px bg-border" />
              {steps.map((step, index) => {
                const isActive = index === activeIndex
                const locked = !allDone && index > current
                const Icon = STEP_COPY[step.id].icon
                return (
                  <li key={step.id} className="relative flex items-start gap-3" data-atai-tour={step.tour}>
                    <button
                      type="button"
                      onClick={() => setPinned(index === current ? null : index)}
                      disabled={locked}
                      aria-current={isActive ? "step" : undefined}
                      className={cn(
                        "relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs transition-colors",
                        step.done && "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
                        isActive && "border-primary bg-primary text-primary-foreground hover:bg-primary",
                        !step.done && !isActive && "border-border bg-card text-muted-foreground",
                        locked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                      )}
                    >
                      {step.done ? <Check className="size-3.5" /> : index + 1}
                    </button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Icon className={cn("size-3.5", isActive ? "text-primary" : "text-muted-foreground/70")} />
                        <p className={cn("text-sm", isActive ? "font-semibold" : "font-medium text-muted-foreground")}>
                          {step.title}
                        </p>
                        {isActive && !step.done ? (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-primary">
                            Now
                          </span>
                        ) : null}
                        {locked ? <Lock className="size-3 text-muted-foreground/60" /> : null}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{step.requirement}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </nav>

          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <Compass className="size-3.5 text-primary" />
              {copy.whyTitle}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.why}</p>
          </div>

          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">What Atai never does</p>
            <ul className="mt-3 flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">
              <li className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                Never edits your code, database or hosting.
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                Never rebuilds or redeploys your application.
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                Never asks for your repository to advise you.
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}

function NextBestActions({ projectId }: { projectId: string }) {
  const actions = [
    { href: `/project/${projectId}/collaborate`, label: "Ask your co-founder", detail: "What to fix first, in your words." },
    { href: `/project/${projectId}/market`, label: "Market & grow", detail: "Turn the read into customers." },
    { href: `/project/${projectId}/finances`, label: "Business finances", detail: "See what the numbers say." },
  ]
  return (
    <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Where to go next</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">You are connected. Pick the next move.</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {actions.map((action) => (
          <li key={action.href}>
            <Link
              href={action.href}
              className="flex h-full flex-col justify-between gap-3 rounded-xl border border-border/70 bg-background/60 p-4 transition-colors hover:border-primary/40"
            >
              <span>
                <span className="block text-sm font-medium">{action.label}</span>
                <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{action.detail}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
      <div className="flex flex-col gap-5">
        <AssessmentReport assessment={assessment.result} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => onStart("reassess")} disabled={busy !== null || running}>
            {busy === "reassess" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Write it again
          </Button>
          {assessment.generatedAt ? (
            <p className="text-[11px] text-muted-foreground">Written {new Date(assessment.generatedAt).toLocaleString()}.</p>
          ) : null}
        </div>
        {error ? <Alert>{error}</Alert> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-col gap-2">
        <StageLine
          label={website.url ? `Reading ${website.url.replace(/^https?:\/\//, "")}` : "Reading your website"}
          status={website.status}
          detail={
            website.analyzed
              ? `${website.pagesCrawled ?? 0} page${website.pagesCrawled === 1 ? "" : "s"} read${website.fromCache ? " — cached, no new spend" : ""}`
              : website.error?.message
          }
        />
        <StageLine
          label="Writing your first read"
          status={assessment.status}
          detail={assessment.status === "processing" ? "Your co-founder is writing it now" : assessment.error?.message}
        />
      </ul>

      {error ? <Alert>{error}</Alert> : null}

      {running ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          This page updates itself. Nothing is marked done until it really is.
        </p>
      ) : (
        <Button type="button" onClick={() => onStart()} disabled={busy !== null}>
          {busy === "retry" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {assessment.status === "failed" ? "Try again" : "Write my first read"}
        </Button>
      )}
    </div>
  )
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
    >
      {children}
    </p>
  )
}

function StageLine({
  label,
  status,
  detail,
}: {
  label: string
  status: IntakeView["assessment"]["status"]
  detail?: string
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-background/60 px-4 py-3">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{label}</span>
        {detail ? <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{detail}</span> : null}
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
          status === "completed"
            ? "bg-success/10 text-success"
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
