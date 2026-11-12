"use client"

import { useCallback, useRef, useState } from "react"
import Link from "next/link"
import { Check, Loader2, RefreshCw, Rocket, Square, TriangleAlert } from "lucide-react"
import { postNdjson } from "@/lib/client/api"
import { LaunchKitDraftView } from "@/components/marketing/launch-kit-draft-view"

export interface LaunchKitItem {
  id: string
  title: string
  body: string
  creditsCharged: number
  createdAt: number
}

export interface LaunchKitSlotView {
  slot: string
  label: string
  description: string
  item: LaunchKitItem | null
}

type RunStatus = "running" | "failed"

/**
 * The Market page hero: one click drafts the founder's whole launch package.
 * Pieces stream in one at a time; every piece is a draft in the content
 * library — nothing is ever posted, sent, or scheduled by Atai.
 */
export function LaunchKitPanel({
  projectId,
  slots: initialSlots,
  creditsAvailable: initialCredits,
  textReady,
}: {
  projectId: string
  slots: LaunchKitSlotView[]
  creditsAvailable: number | null
  textReady: boolean
}) {
  const [slots, setSlots] = useState(initialSlots)
  const [running, setRunning] = useState<string[] | null>(null)
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [creditsAvailable, setCreditsAvailable] = useState(initialCredits)
  const [confirmAll, setConfirmAll] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const hasAnyItem = slots.some((slot) => slot.item)
  const missing = slots.filter((slot) => !slot.item)

  const generate = useCallback(
    async (requested?: string[]) => {
      if (running) return
      setError(null)
      setFailures({})
      setConfirmAll(false)
      const order = requested ?? slots.map((slot) => slot.slot)
      setRunning(order)
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const summary = await postNdjson<{ done: true; generated: number; failed: number; creditsCharged: number }>(
          `/api/projects/${encodeURIComponent(projectId)}/market/launch-kit`,
          requested ? { slots: requested } : {},
          {
            onDelta: () => {},
            signal: controller.signal,
            onMeta: (frame) => {
              if (
                frame.status === "done" &&
                typeof frame.slot === "string" &&
                frame.item &&
                typeof frame.item === "object"
              ) {
                const item = frame.item as LaunchKitItem
                setSlots((current) =>
                  current.map((slot) => (slot.slot === frame.slot ? { ...slot, item } : slot)),
                )
              } else if (frame.status === "failed" && typeof frame.slot === "string") {
                setFailures((current) => ({
                  ...current,
                  [frame.slot as string]:
                    typeof frame.message === "string" ? frame.message : "This piece didn't generate.",
                }))
              }
            },
          },
        )
        if (summary.creditsCharged > 0) {
          setCreditsAvailable((current) => (current === null ? null : Math.max(0, current - summary.creditsCharged)))
        }
        const stillMissing = summary.failed > 0
        setError(
          stillMissing
            ? "Some pieces didn't generate — everything already written is saved below. Retry just the missing pieces."
            : null,
        )
      } catch (e) {
        const code = (e as Error & { code?: string }).code
        setError(
          code === "STOPPED"
            ? "Stopped. Pieces already written are saved below."
            : e instanceof Error
              ? `${e.message} Pieces already written are saved below.`
              : "The kit stopped part-way. Pieces already written are saved below.",
        )
      } finally {
        abortRef.current = null
        setRunning(null)
      }
    },
    [projectId, running, slots],
  )

  const runIndex = (slot: string) => (running ? running.indexOf(slot) : -1)
  const isRunning = (slot: string) => runIndex(slot) >= 0 && Boolean(running)

  return (
    <section aria-labelledby="launch-kit-heading" className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-fuchsia-500/60 via-primary/60 to-sky-500/60" aria-hidden />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Rocket className="size-3.5 text-primary" aria-hidden /> Launch kit
            </p>
            <h2 id="launch-kit-heading" className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">
              {hasAnyItem ? "Your launch marketing, drafted" : "Your launch marketing, drafted for you"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              One click drafts everything you need to launch: announcements for X, LinkedIn and WhatsApp, Product
              Hunt copy, an announcement email, a 14-day content calendar, and the search &amp; share copy for your
              site — all written from your own plan. Every piece is a draft saved to your library: you review, copy,
              and post it yourself. Nothing goes out on its own.
            </p>
          </div>
          {creditsAvailable !== null && (
            <span className="shrink-0 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {creditsAvailable} credits available
            </span>
          )}
        </div>

        {!running && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {hasAnyItem ? (
              <>
                {missing.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void generate(missing.map((slot) => slot.slot))}
                    disabled={!textReady}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Rocket className="size-3.5" aria-hidden />
                    Draft the {missing.length} missing piece{missing.length === 1 ? "" : "s"}
                  </button>
                )}
                {confirmAll ? (
                  <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    Generate fresh drafts of all {slots.length} pieces? Existing drafts stay in your library.
                    <button
                      type="button"
                      onClick={() => void generate()}
                      className="rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      Yes, regenerate all
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmAll(false)}
                      className="rounded-full border border-border px-3 py-1 font-medium hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmAll(true)}
                    disabled={!textReady}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                    Regenerate all
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => void generate()}
                disabled={!textReady}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Rocket className="size-4" aria-hidden />
                Market my app for me
              </button>
            )}
            {!textReady && (
              <span className="text-xs text-muted-foreground">Text generation isn&apos;t configured on this deployment yet.</span>
            )}
          </div>
        )}

        {running && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
            >
              <Square className="size-3" aria-hidden />
              Stop
            </button>
            <span className="text-xs text-muted-foreground">
              Writing your marketing piece by piece — finished pieces appear below as they land.
            </span>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
            {error}
          </p>
        )}
      </div>

      <ol className="flex flex-col gap-3">
        {slots.map((slot) => {
          const failed = failures[slot.slot]
          const active = isRunning(slot.slot)
          return (
            <li key={slot.slot} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-sm font-semibold tracking-tight">{slot.label}</span>
                {slot.item && !active && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3" aria-hidden /> Draft ready
                  </span>
                )}
                {active && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-primary">
                    <Loader2 className="size-3 animate-spin" aria-hidden /> Writing…
                  </span>
                )}
                {failed && !active && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400">
                    <TriangleAlert className="size-3" aria-hidden /> Retry
                  </span>
                )}
                {!slot.item && !active && !running && (
                  <button
                    type="button"
                    onClick={() => void generate([slot.slot])}
                    disabled={!textReady}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Rocket className="size-3" aria-hidden /> {failed ? "Retry this piece" : "Draft this"}
                  </button>
                )}
                {slot.item && !active && (
                  <button
                    type="button"
                    onClick={() => void generate([slot.slot])}
                    disabled={Boolean(running) || !textReady}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className="size-3" aria-hidden /> New draft
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{slot.description}</p>

              {failed && !active && <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-400">{failed}</p>}

              {active && (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
                  Writing from your plan — this usually takes a few seconds…
                </div>
              )}

              {slot.item && !active && (
                <>
                  <LaunchKitDraftView projectId={projectId} slot={slot.slot} label={slot.label} item={slot.item} />
                  <div className="mt-3 flex flex-wrap items-center justify-end border-t border-border pt-3">
                    <Link
                      href={`/project/${projectId}/studio`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Open in Studio <span aria-hidden>→</span>
                    </Link>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
