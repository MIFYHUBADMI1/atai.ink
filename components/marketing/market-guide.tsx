"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * First-time guide and guided tour for the Market & grow page.
 *
 * The page's trust model (real measurements, honest limits, plan-derived
 * drafts) was invisible to a first-time founder, who could reasonably mistake
 * the drafting surfaces for "a ChatGPT with extra steps". This guide states
 * plainly what each block does, what a good first session looks like, and —
 * just as importantly — what the page does NOT do.
 *
 * SSR renders the expanded guide deterministically; the dismissal flag is
 * read from localStorage only after mount (no hydration mismatch), and the
 * tour is plain DOM: data-tour anchors, scrollIntoView, an outline spotlight.
 */

const DISMISS_KEY = "atai:market-guide-dismissed"

interface TourStep {
  target: string
  label: string
  title: string
  text: string
}

const TOUR_STEPS: TourStep[] = [
  {
    target: "launch-kit",
    label: "Launch Kit",
    title: "One pass, your whole launch day",
    text: "Generate launch-ready pieces for X, LinkedIn, WhatsApp and communities, Product Hunt, email, a 14-day content calendar, and search & share copy for your site. Each piece is drafted from your plan, shaped for its channel, and saved to your library — nothing is posted anywhere automatically.",
  },
  {
    target: "overview",
    label: "Growth overview",
    title: "Your workspace, actually measured",
    text: "Live deployment state, the runtime requests and checkout calls your app made in the last 30 days, credits the project consumed, plan completeness, and the growth plans Atai drafted for you. These are real platform measurements — every metric states what it measures and what it does not mean.",
  },
  {
    target: "studio",
    label: "AI Marketing Studio",
    title: "Draft anything, keep it in one library",
    text: "Open the Studio to draft posts, emails, website copy, blog articles, scripts and briefs with tone and length controls. Every draft lands in your content library so nothing lives in a chat scrollback.",
  },
  {
    target: "seo",
    label: "SEO visibility",
    title: "Check how findable your site is",
    text: "Atai crawls your deployed website, scores it, and lists concrete fixes with a plan. Reading the latest audit is free; running a new crawl charges credits.",
  },
]

const GUIDE_BLOCKS: Array<{ label: string; what: string; do: string }> = [
  {
    label: "Launch Kit",
    what: "Drafts your launch-day pack in one pass: X and LinkedIn announcements, a WhatsApp or community message, Product Hunt copy, an announcement email, a 14-day post-launch content calendar, and search & share copy for your site. Each piece is shaped for its channel and saved to your library.",
    do: "Generate a piece, read it, edit what you need, then copy it into the channel yourself.",
  },
  {
    label: "Growth overview",
    what: "Shows your real workspace data: whether your site is live, the runtime requests and checkout calls your app made in the last 30 days, credits the project consumed, how complete your plan is, and the growth plans Atai drafted for you. Every metric states what it measures and what it does not mean.",
    do: "Read the drafted plans, tighten weak plan sections, and follow the suggested next steps.",
  },
  {
    label: "AI Marketing Studio",
    what: "Drafts anything you need channel by channel — posts, emails, website copy, blog articles, scripts and briefs — with tone and length controls. Drafts are saved in your library and can be planned for later use.",
    do: "Draft follow-up content after launch and keep the library as your content backlog.",
  },
  {
    label: "SEO visibility",
    what: "Crawls your deployed website and scores it, then lists concrete fixes with an action plan. Reading the latest audit is free; running a new one charges credits.",
    do: "Run an audit after every meaningful site change and work through what it finds.",
  },
]

const FIRST_SESSION: string[] = [
  "Read the drafted growth and marketing plans and correct anything that misrepresents your business — every draft on this page builds on them.",
  "Deploy your site if it is not live yet (Runtime page). The SEO audit and the live measurements need a deployed URL.",
  "Run an SEO audit and work through its fixes.",
  "Generate your Launch Kit pieces, starting with the announcement posts.",
  "Draft follow-up content in the Studio and keep the 14-day calendar as your posting plan.",
]

const HONEST_LIMITS: string[] = [
  "Nothing here posts, sends, or publishes — you copy each draft to its channel yourself.",
  "Atai does not collect visitor analytics for your app yet, so there are no visitor, conversion, or revenue numbers; runtime requests are API calls, not visitors.",
  "Paid advertising is planned and quoted on Ads & marketing — execution stays manual, with you in control.",
  "Competitor suggestions in Resources are AI-generated and unverified; the Competition page states exactly what is known and what is not.",
]

export function MarketGuide() {
  const [dismissed, setDismissed] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [tourStep, setTourStep] = useState<number | null>(null)
  const spotlighted = useRef<HTMLElement | null>(null)

  useEffect(() => {
    try {
      if (globalThis.localStorage?.getItem(DISMISS_KEY) === "1") {
        setDismissed(true)
        setExpanded(false)
      }
    } catch {
      // Storage can be unavailable (private modes); keep the guide visible.
    }
  }, [])

  const clearSpotlight = useCallback(() => {
    spotlighted.current?.classList.remove("market-guide-spotlight")
    spotlighted.current = null
  }, [])

  const endTour = useCallback(() => {
    clearSpotlight()
    setTourStep(null)
  }, [clearSpotlight])

  const stepTo = useCallback(
    (index: number, direction: 1 | -1) => {
      let i = index
      // Sections can be absent (e.g. the launch kit hides when the studio is
      // disabled) — skip to the next existing stop in the walking direction.
      while (i >= 0 && i < TOUR_STEPS.length) {
        const el = document.querySelector<HTMLElement>(`[data-tour="${TOUR_STEPS[i].target}"]`)
        if (el) {
          clearSpotlight()
          spotlighted.current = el
          el.classList.add("market-guide-spotlight")
          const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
          el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" })
          setTourStep(i)
          return
        }
        i += direction
      }
      endTour()
    },
    [clearSpotlight, endTour],
  )

  useEffect(() => {
    if (tourStep === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") endTour()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [tourStep, endTour])

  useEffect(() => () => clearSpotlight(), [clearSpotlight])

  function dismiss() {
    setDismissed(true)
    setExpanded(false)
    try {
      globalThis.localStorage?.setItem(DISMISS_KEY, "1")
    } catch {
      // Still collapse for this visit even if the flag cannot be stored.
    }
  }

  if (dismissed && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-fit rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        Guide & tour — how Market & grow works
      </button>
    )
  }

  const step = tourStep !== null ? TOUR_STEPS[tourStep] : null

  return (
    <>
      <style>{`.market-guide-spotlight{outline:3px solid var(--primary,#6366f1);outline-offset:6px;border-radius:16px}`}</style>
      <section
        aria-labelledby="market-guide-heading"
        className="rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">How this page works</p>
            <h2 id="market-guide-heading" className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">
              New to Market &amp; grow? Start here
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss this guide"
            className="shrink-0 rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            ×
          </button>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          This page already knows your plan — what you are building, who it serves, how it should sound. That context is
          what separates it from a blank chat box: every draft starts from your business, and every number comes from
          your actual workspace.
        </p>
        <button
          type="button"
          onClick={() => stepTo(0, 1)}
          className="mt-3 inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Show me around ({TOUR_STEPS.length} stops)
        </button>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {GUIDE_BLOCKS.map((block) => (
            <div key={block.label} className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground">{block.label}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{block.what}</p>
              <p className="mt-2 text-sm leading-6 text-foreground/90">
                <span className="font-semibold">Do this:</span> {block.do}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">A good first session</h3>
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-6 text-muted-foreground">
            {FIRST_SESSION.map((entry) => (
              <li key={entry} className="min-w-0 break-words marker:text-muted-foreground/60">{entry}</li>
            ))}
          </ol>
        </div>

        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">What this page does not do</h3>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-6 text-foreground/85">
            {HONEST_LIMITS.map((entry) => (
              <li key={entry} className="min-w-0 break-words">{entry}</li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="mt-4 inline-flex w-fit rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Got it — collapse this guide
        </button>
      </section>

      {step && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-2xl border border-border bg-card p-4 shadow-lg"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {tourStep !== null ? `Stop ${tourStep + 1} of ${TOUR_STEPS.length} · ${step.label}` : step.label}
            </p>
            <button
              type="button"
              onClick={endTour}
              aria-label="End the tour"
              className="rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              ×
            </button>
          </div>
          <h3 className="mt-1 text-base font-semibold text-foreground">{step.title}</h3>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{step.text}</p>
          <div className="mt-3 flex items-center justify-end gap-2">
            {tourStep !== null && tourStep > 0 && (
              <button
                type="button"
                onClick={() => stepTo(tourStep - 1, -1)}
                className="rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (tourStep !== null ? stepTo(tourStep + 1, 1) : endTour())}
              className="rounded-xl bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              {tourStep !== null && tourStep >= TOUR_STEPS.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
