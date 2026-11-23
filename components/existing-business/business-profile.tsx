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
import { jsonFetcher, postJson, type ApiError } from "@/lib/client/api"
import { BUSINESS_CLAIM_SUPPORT_HREF } from "@/lib/domain/claim-copy"
import type { IntakeView } from "@/lib/existing-business/view"
import { projectBase, type WorkspaceBase } from "@/lib/connected-business/surface"
import { businessSteps, type BusinessStep, type BusinessStepId } from "@/lib/existing-business/steps"
import { intakeStatusLabel } from "@/lib/existing-business/stage-labels"
import { cn } from "@/lib/utils"
import { AssessmentReport } from "./assessment-report"
import { trackConnectCompleted, trackConnectReadCompleted } from "@/lib/analytics/connect-funnel"
import { ConnectionCard } from "./connection-card"
import { DomainVerification } from "./domain-verification"
import { ReadingPreviewButton, ReadingPreviewDialog } from "./reading-preview-dialog"
import { EngineTroublePanel } from "./engine-trouble-panel"
import { CreditsShortfallDialog, type JourneyCost } from "./credits-shortfall-dialog"

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
export function BusinessProfile({
  projectId,
  initialView,
  base,
}: {
  projectId: string
  initialView: IntakeView
  /** Where this stepper's links point. Defaults to the project workspace; a
   *  connected business passes its own base so nothing leaks into /project. */
  base?: WorkspaceBase
}) {
  const routeBase = base ?? projectBase(projectId)
  const [readingOpen, setReadingOpen] = useState(false)
  const [view, setView] = useState<IntakeView>(initialView)
  const [busy, setBusy] = useState<"retry" | "reassess" | null>(null)
  // A refusal to start for want of credits carries its numbers; it is not a
  // red error line, it is a decision the founder can act on.
  const [shortfall, setShortfall] = useState<JourneyCost | null>(null)
  // What finishing still costs, so the price is on screen before the button.
  const [cost, setCost] = useState<JourneyCost | null>(null)
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
  // A run started from this page is accepted by the server before it does any
  // work, so the view it returns is still the old one. Without this the page
  // looked frozen: the button re-enabled and nothing ever changed.
  const [watching, setWatching] = useState(false)
  const watchDeadline = useRef(0)
  const watchStartedAt = useRef(0)

  useEffect(() => {
    if (view.assessment.result) return
    let cancelled = false
    jsonFetcher<JourneyCost>(`/api/billing/business-connect?projectId=${projectId}`)
      .then((next) => {
        if (!cancelled) setCost(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [projectId, view.assessment.result, view.website.status])

  useEffect(() => {
    if (!running && !watching) return
    const timer = setInterval(async () => {
      await refresh()
      if (watching && Date.now() > watchDeadline.current) setWatching(false)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [running, watching, refresh])

  // The connect funnel: the read landing and the connection going live are the
  // two moments the journey can be measured from the browser.
  const readReported = useRef(false)
  const connectionReported = useRef(false)
  useEffect(() => {
    if (view.assessment.result && !readReported.current) {
      readReported.current = true
      trackConnectReadCompleted({ surface: "project" })
    }
  }, [view.assessment.result])
  useEffect(() => {
    if (view.connection.status === "verified" && !connectionReported.current) {
      connectionReported.current = true
      trackConnectCompleted({ surface: "project" })
    }
  }, [view.connection.status])

  // Stop polling once the run reports a verdict. The view right after a start
  // still shows the previous outcome, so an old failure only counts once enough
  // time has passed for this run to have failed on its own.
  useEffect(() => {
    if (!watching) return
    if (view.assessment.status === "completed") {
      setWatching(false)
      return
    }
    const settled = view.assessment.status === "failed" && view.overall !== "pending" && view.overall !== "processing"
    if (settled && Date.now() - watchStartedAt.current > 15_000) setWatching(false)
  }, [watching, view.assessment.status, view.overall])

  async function startRun(action?: "reassess") {
    setBusy(action === "reassess" ? "reassess" : "retry")
    setError(null)
    try {
      const data = await postJson<{ started: boolean; view: IntakeView }>(
        `/api/projects/${projectId}/intake`,
        action ? { action } : {},
      )
      setView(data.view)
      if (data.started) {
        watchStartedAt.current = Date.now()
        watchDeadline.current = Date.now() + 180_000
        setWatching(true)
      } else {
        await refresh()
      }
    } catch (e) {
      const api = e as ApiError
      const meta = api.meta as Partial<JourneyCost> | undefined
      if (api.code === "INSUFFICIENT_CREDITS" && typeof meta?.shortfall === "number") {
        setShortfall({
          readCost: Number(meta.readCost ?? 0),
          assessmentCost: Number(meta.assessmentCost ?? 0),
          engineCost: Number(meta.engineCost ?? 0),
          engineName: meta.engineName ?? null,
          required: Number(meta.required ?? 0),
          available: Number(meta.available ?? 0),
          shortfall: meta.shortfall,
        })
      } else {
        setError(e instanceof Error ? e.message : "Could not start the run. Please try again.")
      }
    } finally {
      setBusy(null)
    }
  }

  const { steps, current } = businessSteps(view)
  // A business that belongs to another account gets no verification controls:
  // there is nothing to verify, and a token here would invite tag-pasting on a
  // site this account does not own.
  const claimHeld = view.claim.state === "held_by_other"
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
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3" data-atai-tour="existing-business-status">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
            <Globe className="size-3" />
            Connected business
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {view.displayName || "Your existing business"}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {allDone
              ? "All three steps are done. Your co-founder can see this business now — ask it anything, or pick the section that matches your goal."
              : `${doneCount} of ${steps.length} steps done. Finish this one and the next opens on its own.`}
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

          <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
            <header className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-[18px]">
                <copy.icon />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Step {activeIndex + 1} of {steps.length}
                  <span className="text-muted-foreground/60"> · </span>
                  {active.done ? "done" : copy.minutes}
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-balance sm:text-2xl">{active.title}</h2>
                <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.purpose}</p>
              </div>
            </header>

            <div className="mt-5 border-t border-border/70 pt-5">
              {active.id === "assessment" ? (
                <AssessmentStep
                  projectId={projectId}
                  view={view}
                  cost={cost}
                  running={running || watching}
                  busy={busy}
                  error={error}
                  onStart={startRun}
                  onShowReading={() => setReadingOpen(true)}
                  blocked={claimHeld}
                />
              ) : null}
              {active.id === "domain" ? (
                claimHeld ? (
                  <ClaimHeld hostname={view.claim.hostname} />
                ) : (
                  <DomainVerification
                    projectId={projectId}
                    initialDomains={view.domain.records}
                    defaultUrl={view.website.url}
                    onChanged={refresh}
                  />
                )
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

            <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                {active.done ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-success" />
                    This step is finished.
                  </>
                ) : (
                  <>
                    <Lock className="size-3.5" />
                    {active.id === "domain" && view.domain.verified
                      ? "One address is proved. Prove or remove the rest to finish this step."
                      : "The next step stays closed until this one is verified."}
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
                <Link href={routeBase.href("collaborate")} className={buttonVariants({ size: "default" })}>
                  <Sparkles className="size-4" />
                  Ask your co-founder
                </Link>
              )}
            </footer>
          </section>

          {allDone ? <NextBestActions base={routeBase} /> : null}
        </div>

        <ReadingPreviewDialog
          projectId={projectId}
          submittedUrl={view.website.url}
          open={readingOpen}
          onOpenChange={setReadingOpen}
        />
        <CreditsShortfallDialog
          open={shortfall !== null}
          onOpenChange={(next) => {
            if (!next) setShortfall(null)
          }}
          cost={shortfall}
          businessName={view.displayName ?? ""}
          stepLabel={active.title}
          stepHint={`You are on “${active.title}”. ${STEP_COPY[active.id].purpose}`}
        />

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

function NextBestActions({ base }: { base: WorkspaceBase }) {
  const actions = [
    { href: base.href("collaborate"), label: "Ask your co-founder", detail: "What to fix first, in your words." },
    { href: base.href("growth"), label: "Market & grow", detail: "Turn the read into customers." },
    { href: base.href("money"), label: "Business finances", detail: "See what the numbers say." },
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

/** Shown instead of verification controls when another account holds the site.
 * It never names the holder — only what this founder can do next. */
function ClaimHeld({ hostname }: { hostname?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-800 dark:text-amber-300">
      <p className="flex items-center gap-2 font-medium">
        <Lock className="size-4 shrink-0" />
        {hostname ? `${hostname} is connected to another Atai account` : "This website is connected to another Atai account"}
      </p>
      <p>
        Only that account can disconnect it. If this is the business you own,{" "}
        <a href={BUSINESS_CLAIM_SUPPORT_HREF} className="underline underline-offset-2">
          contact support
        </a>{" "}
        to recover it. If you connected it with another account of your own, sign in to that account and delete the
        business there.
      </p>
      <p className="text-xs opacity-90">
        Verification is paused for this business until the claim is released, so no tag or file is issued here.
      </p>
    </div>
  )
}

function AssessmentStep({
  projectId,
  view,
  cost,
  running,
  busy,
  error,
  onStart,
  onShowReading,
  blocked,
}: {
  projectId: string
  view: IntakeView
  cost: JourneyCost | null
  running: boolean
  busy: "retry" | "reassess" | null
  error: string | null
  onStart: (action?: "reassess") => void
  onShowReading: () => void
  /** Another account holds this business: a run would be refused, so offer none. */
  blocked?: boolean
}) {
  const assessment = view.assessment
  const website = view.website
  // A failed write whose cause is the engine gets the engine panel: the founder
  // can switch engines and retry in place instead of retrying a dead model.
  const engineTrouble = assessment.status === "failed" && assessment.error?.code === "ASSESSMENT_FAILED"

  if (assessment.result) {
    return (
      <div className="flex flex-col gap-5">
        <AssessmentReport assessment={assessment.result} onShowReading={onShowReading} />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onStart("reassess")}
            disabled={busy !== null || running || blocked}
          >
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
      {/* The control comes first: a founder who lands on this step should not
          have to scroll past status lines to find the one button that acts. */}
      {running ? (
        <div className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm text-primary">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span className="min-w-0 flex-1">Your co-founder is writing the first read. This page updates itself.</span>
        </div>
      ) : engineTrouble ? (
        <EngineTroublePanel
          projectId={projectId}
          failedEngine={assessment.engine}
          reason={assessment.error?.reason}
          onRetry={() => onStart()}
          retrying={busy === "retry"}
          blocked={blocked}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => onStart()} disabled={busy !== null || blocked}>
            {busy === "retry" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {assessment.status === "failed" ? "Try again" : "Write my first read"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {blocked
              ? "Paused: this website is connected to another Atai account."
              : assessment.status === "failed"
                ? "The last attempt did not produce a usable read. Nothing was invented, and the charge was refunded."
                : "One read, written from your own words and your live pages."}
          </p>
        </div>
      )}

      {cost && cost.required > 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {cost.readCost > 0 && !website.analyzed
            ? `${cost.readCost.toLocaleString()} credits to read your live site, then `
            : ""}
          {cost.assessmentCost.toLocaleString()} credits for the read
          {(cost.engineCost ?? 0) > 0
            ? `, plus ${cost.engineCost?.toLocaleString()} for ${cost.engineName ?? "your engine"}`
            : ""}
          . You have {cost.available.toLocaleString()}
          {cost.shortfall > 0
            ? ` — ${cost.shortfall.toLocaleString()} short of finishing.`
            : " — enough to finish."}
        </p>
      ) : null}

      {error ? <Alert>{error}</Alert> : null}

      <ul className="flex flex-col gap-2">
        <StageLine
          label={website.url ? `Reading ${website.url.replace(/^https?:\/\//, "")}` : "Reading your website"}
          status={website.status}
          detail={
            website.analyzed
              ? `${website.pagesCrawled ?? 0} page${website.pagesCrawled === 1 ? "" : "s"} read${website.fromCache ? " — cached, no new spend" : ""}`
              : website.error?.message
          }
          action={website.analyzed ? <ReadingPreviewButton onClick={onShowReading} /> : null}
        />
        <StageLine
          label="Writing your first read"
          status={assessment.status}
          detail={assessment.status === "processing" ? "Your co-founder is writing it now" : assessment.error?.message}
          reason={assessment.status === "failed" ? assessment.error?.detail : undefined}
        />
      </ul>
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
  reason,
  action,
}: {
  label: string
  status: IntakeView["assessment"]["status"]
  detail?: string
  /** The operator-facing cause. Shown so a failing step can be diagnosed
   * instead of retried blindly. */
  reason?: string
  action?: React.ReactNode
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-background/60 px-4 py-3">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{label}</span>
        {detail ? <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{detail}</span> : null}
        {reason ? (
          <span className="mt-1 block font-mono text-[10px] leading-relaxed text-muted-foreground/80">
            Why: {reason}
          </span>
        ) : null}
        {action ? <span className="mt-2 block">{action}</span> : null}
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
