"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, Clock, Crosshair, GripVertical, Pause, Play, X } from "lucide-react"
import { useTourStore } from "@/lib/tour/engine/store"
import { remainingMinutes } from "@/lib/tour/engine/resolve"
import { clampPosition, layoutMode, placeTooltip, EDGE, type Point } from "@/lib/tour/engine/geometry"
import { getTour } from "@/lib/tour/registry"
import type { TourRuntime } from "@/lib/tour/engine/use-tour-runtime"

/**
 * The explanation card: what the thing is, what it does, why it matters, and
 * what the founder can do next — plus controls that always include a way out.
 * Positioned near the spotlight on desktop, a bottom sheet on a phone, and
 * draggable anywhere on screen: a card that covers the thing being explained is
 * the founder's problem to solve, not a reason to give up on the highlight.
 */

const CARD_SIZE = { width: 380, height: 320 }
const NUDGE = 24

const BUTTON =
  "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const BUTTON_PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:opacity-90`
const BUTTON_GHOST = `${BUTTON} text-muted-foreground hover:bg-accent hover:text-foreground`
const BUTTON_OUTLINE = `${BUTTON} border border-border text-muted-foreground hover:bg-accent hover:text-foreground`

export function TourCard({ runtime }: { runtime: TourRuntime }) {
  const status = useTourStore((s) => s.status)
  const tourId = useTourStore((s) => s.tourId)
  const index = useTourStore((s) => s.index)
  const resolved = useTourStore((s) => s.resolved)
  const confirmed = useTourStore((s) => s.confirmed)
  const notice = useTourStore((s) => s.notice)
  const targetLabel = useTourStore((s) => s.target.label)
  const box = useTourStore((s) => s.target.box)
  const next = useTourStore((s) => s.next)
  const prev = useTourStore((s) => s.prev)
  const skip = useTourStore((s) => s.skip)
  const pause = useTourStore((s) => s.pause)
  const exit = useTourStore((s) => s.exit)
  const confirm = useTourStore((s) => s.confirm)

  const [viewport, setViewport] = useState({ width: 1280, height: 800 })
  useEffect(() => {
    const sync = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    sync()
    window.addEventListener("resize", sync)
    return () => window.removeEventListener("resize", sync)
  }, [])

  // Where the founder dropped the card. `null` means "let the engine place it",
  // which is what a step's highlight relies on, so it survives steps but not
  // tours: a new tour starts anchored again.
  const [manual, setManual] = useState<Point | null>(null)
  const [dragging, setDragging] = useState(false)
  const cardRef = useRef<HTMLElement | null>(null)
  const grab = useRef<{ dx: number; dy: number } | null>(null)
  const size = useRef(CARD_SIZE)

  useEffect(() => setManual(null), [tourId])

  const headingRef = useRef<HTMLDivElement | null>(null)
  const step = resolved?.steps[index] ?? null
  const total = resolved?.steps.length ?? 0
  const tour = getTour(tourId)

  // Announce each stop to screen readers by moving focus to the heading, which
  // is also what makes the card reachable by keyboard alone.
  useEffect(() => {
    if (status === "active" && step) headingRef.current?.focus()
  }, [status, step?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const placement = useMemo(() => {
    if (layoutMode(viewport) === "mobile") {
      return { side: "overlay" as const, left: EDGE, top: 0, maxWidth: viewport.width - EDGE * 2 }
    }
    if (!box) {
      return { side: "overlay" as const, left: Math.max(EDGE, viewport.width / 2 - CARD_SIZE.width / 2), top: 0, maxWidth: CARD_SIZE.width }
    }
    return placeTooltip(box, viewport, CARD_SIZE)
  }, [box, viewport])

  const measureCard = () => {
    const el = cardRef.current
    if (!el) return
    size.current = { width: el.offsetWidth || CARD_SIZE.width, height: el.offsetHeight || CARD_SIZE.height }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const el = cardRef.current
    if (!el) return
    measureCard()
    const rect = el.getBoundingClientRect()
    grab.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!grab.current) return
    setManual(
      clampPosition(
        { x: event.clientX - grab.current.dx, y: event.clientY - grab.current.dy },
        size.current,
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!grab.current) return
    grab.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDragging(false)
  }

  // The handle is a button, so a keyboard founder can move the card too. Arrow
  // keys nudge it and Home gives the manual position back to the engine.
  const onHandleKey = (event: React.KeyboardEvent<HTMLElement>) => {
    const keys: Record<string, Point> = {
      ArrowLeft: { x: -NUDGE, y: 0 },
      ArrowRight: { x: NUDGE, y: 0 },
      ArrowUp: { x: 0, y: -NUDGE },
      ArrowDown: { x: 0, y: NUDGE },
    }
    if (event.key === "Home") {
      event.preventDefault()
      event.stopPropagation()
      setManual(null)
      return
    }
    const delta = keys[event.key]
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    measureCard()
    const from = manual ?? { x: placement.left, y: placement.top }
    setManual(clampPosition({ x: from.x + delta.x, y: from.y + delta.y }, size.current, viewport))
  }

  if (status === "finished" && tour) {
    return (
      <Sheet placement={placement} manual={manual} tone="done" dragging={dragging} cardRef={cardRef}>
        <FinishedCard tourId={tour.id} onExit={exit} onRestart={() => useTourStore.getState().restart()} />
      </Sheet>
    )
  }

  if (status !== "active" || !step || !tour) return null

  const waitingForPage = runtime.searching
  const isLast = index >= total - 1
  const needsConfirm = runtime.verdict === "manual" && !confirmed
  const blocked = runtime.missing
  const left = remainingMinutes(tour.minutes, total, index)

  return (
    <Sheet
      placement={placement}
      manual={manual}
      dragging={dragging}
      cardRef={cardRef}
      caret={manual || placement.side === "overlay" || !box ? null : placement.side}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {tour.title}
          </p>
          <div
            ref={headingRef}
            tabIndex={-1}
            role="heading"
            aria-level={2}
            className="mt-1 text-base font-semibold tracking-tight text-foreground outline-none"
          >
            {step.title}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {manual ? (
            <button
              type="button"
              onClick={() => setManual(null)}
              aria-label="Move the card back to the highlighted section"
              title="Snap back to the highlight"
              className={`${BUTTON_GHOST} !px-2 !py-1`}
            >
              <Crosshair className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            data-tour-drag-handle=""
            aria-label="Move the tour card. Arrow keys nudge it, Shift plus arrow moves it further, Home snaps it back."
            title="Drag me — this card can go anywhere on the screen"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onHandleKey}
            className={`${BUTTON_GHOST} cursor-grab touch-none !px-2 !py-1 active:cursor-grabbing`}
          >
            <GripVertical className="size-4" />
          </button>
          <button
            type="button"
            onClick={exit}
            aria-label="Exit the tour"
            className={`${BUTTON_GHOST} !px-2 !py-1`}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Progress: where you are, how many stops, and roughly how long left. */}
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300 motion-reduce:transition-none"
            style={{ width: `${Math.round(((index + 1) / Math.max(1, total)) * 100)}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {index + 1}/{total}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <Clock className="size-3" />~{left} min
        </span>
      </div>

      {/* On a phone there is no ring to read, and after a drag there is no
          line of sight between card and highlight — so name the section. */}
      {targetLabel && !blocked ? (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden />
          Looking at: {targetLabel}
        </p>
      ) : null}

      <p className="mt-3 text-sm leading-6 text-foreground/90">{step.text}</p>
      {step.why ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground/80">Why it matters: </span>
          {step.why}
        </p>
      ) : null}

      {step.instruction ? (
        <p className="mt-3 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-sm leading-6 text-foreground">
          {step.instruction}
        </p>
      ) : null}

      {step.costsCredits ? (
        <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm leading-6 text-amber-800 dark:text-amber-300">
          Doing this uses credits. The cost is shown where you do it, and Atai never does it for you.
        </p>
      ) : null}

      {blocked ? (
        <p className="mt-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm leading-6 text-muted-foreground">
          {targetLabel ? `“${targetLabel}” ` : "This part "}is not on the page right now — it may belong to
          another stage, a feature that is switched off, or a business you have not made yet. You can skip it and
          continue.
        </p>
      ) : waitingForPage ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground" role="status" aria-live="polite">
          Waiting for the page to load. This tour never blocks you — carry on with what you were doing.
        </p>
      ) : null}

      {notice ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{notice}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={prev} disabled={index === 0} className={`${BUTTON_GHOST} disabled:opacity-40`}>
            <ArrowLeft className="size-4" />
            Back
          </button>
          <button type="button" onClick={skip} className={BUTTON_GHOST}>
            Skip this step
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={pause} className={BUTTON_OUTLINE} aria-label="Pause the tour">
            <Pause className="size-4" />
          </button>
          {needsConfirm ? (
            <button type="button" onClick={confirm} className={BUTTON_PRIMARY}>
              I&apos;ve done this
              <ArrowRight className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={next}
              className={BUTTON_PRIMARY}
              disabled={runtime.verdict === "waiting" && !blocked}
            >
              {isLast ? "Finish" : blocked || runtime.verdict === "waiting" ? "Continue" : "Next"}
              <ArrowRight className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Politely announced so a screen reader gets the stop without the card
          stealing focus back from a control the founder is using. */}
      <p className="sr-only" aria-live="polite">
        Step {index + 1} of {total}: {step.title}
      </p>
    </Sheet>
  )
}

function Sheet({
  children,
  placement,
  manual,
  tone = "normal",
  dragging = false,
  caret = null,
  cardRef,
}: {
  children: React.ReactNode
  placement: { side: "top" | "bottom" | "overlay"; left: number; top: number; maxWidth: number }
  manual?: Point | null
  tone?: "normal" | "done"
  dragging?: boolean
  caret?: "top" | "bottom" | null
  cardRef?: React.Ref<HTMLElement>
}) {
  // A dragged card keeps exactly where the founder put it, on a phone too.
  const moved = Boolean(manual)
  const mobile = placement.side === "overlay" && !moved
  const style: React.CSSProperties = moved
    ? { left: manual!.x, top: manual!.y, width: placement.maxWidth }
    : mobile
      ? { left: placement.left, right: placement.left, maxWidth: placement.maxWidth }
      : { left: placement.left, top: placement.top, width: placement.maxWidth }

  return (
    <section
      ref={cardRef}
      aria-label="Guided tour"
      className={
        `pointer-events-auto fixed z-[80] rounded-2xl border ${tone === "done" ? "border-primary/40" : "border-border"} bg-card p-4 shadow-xl transition-shadow ` +
        (mobile ? "inset-x-3 bottom-3 sm:left-auto sm:right-3 sm:w-[380px] " : "") +
        (dragging ? "select-none shadow-2xl ring-2 ring-ring" : "")
      }
      style={mobile ? undefined : style}
    >
      {caret ? (
        <span
          aria-hidden
          className={`absolute left-1/2 size-3 -translate-x-1/2 rotate-45 border-border bg-card ${
            caret === "top" ? "-top-1.5 border-x border-t" : "-bottom-1.5 border-b border-r"
          }`}
        />
      ) : null}
      {children}
    </section>
  )
}

function FinishedCard({ tourId, onExit, onRestart }: { tourId: string; onExit: () => void; onRestart: () => void }) {
  const tour = getTour(tourId)
  const start = useTourStore((s) => s.start)
  const offer = tour?.offerNext ? getTour(tour.offerNext) : null
  if (!tour) return null

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{tour.title}</p>
      <h2 className="mt-1 text-base font-semibold text-foreground">That is the whole tour</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Nothing was changed on your account except this tour&apos;s progress, and you can take it again any time from
        Guided tours.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {offer ? (
          <button type="button" className={BUTTON_PRIMARY} onClick={() => start(offer.id, { atStep: 0 })}>
            Take {offer.title}
          </button>
        ) : null}
        <button type="button" className={BUTTON_OUTLINE} onClick={onRestart}>
          Run it again
        </button>
        <button type="button" className={BUTTON_GHOST} onClick={onExit}>
          Done
        </button>
      </div>
    </div>
  )
}

/** The only affordance while a tour is paused: get back in, or let it go.
 * Pausing must never strand a founder with a tour they cannot resume. */
export function TourPausedPill() {
  const status = useTourStore((s) => s.status)
  const resume = useTourStore((s) => s.resume)
  const exit = useTourStore((s) => s.exit)
  const tourTitle = useTourStore((s) => getTour(s.tourId)?.title ?? "Tour")
  if (status !== "paused") return null
  return (
    <div className="pointer-events-auto fixed bottom-3 left-3 z-[80] flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-xl">
      <p className="pl-1 text-xs text-muted-foreground">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em]">Tour paused</span>
        {tourTitle}
      </p>
      <button type="button" onClick={resume} className={BUTTON_PRIMARY}>
        <Play className="size-4" aria-hidden />
        Resume
      </button>
      <button type="button" onClick={exit} className={BUTTON_GHOST}>
        End here
      </button>
    </div>
  )
}
