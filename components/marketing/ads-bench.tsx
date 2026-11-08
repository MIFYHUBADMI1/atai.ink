"use client"

import { useCallback, useRef, useState } from "react"
import Link from "next/link"
import { Check, Copy, ImageIcon, Loader2, Megaphone, RefreshCw, Square, TriangleAlert } from "lucide-react"
import { postNdjson } from "@/lib/client/api"

export interface AdsBenchItem {
  id: string
  title: string
  body: string
  kind: "copy" | "email" | "social" | "timeline" | "blog" | "brief" | "image" | "voice" | "video"
  creditsCharged: number
  createdAt: number
  media?: { kind: "image" | "audio" | "video"; dataUrl?: string; jobId?: string; status?: string; notPersisted?: boolean }
}

export interface AdsBenchSlotView {
  slot: string
  label: string
  description: string
  kind: AdsBenchItem["kind"]
  item: AdsBenchItem | null
}

type RunStatus = "running" | "failed"

const MAX_OFFER = 600
const MAX_AUDIENCE = 300

/**
 * The Ads page bench: the founder describes the offer once, then each
 * ad-relevant piece is drafted through the studio pipeline. Every piece is a
 * draft in the content library — nothing is published, uploaded, or run on any
 * ad platform, because Atai does not place or manage ads.
 */
export function AdsBench({
  projectId,
  slots: initialSlots,
  creditsAvailable: initialCredits,
  textReady,
  imageReady,
}: {
  projectId: string
  slots: AdsBenchSlotView[]
  creditsAvailable: number | null
  textReady: boolean
  imageReady: boolean
}) {
  const [slots, setSlots] = useState(initialSlots)
  const [offer, setOffer] = useState("")
  const [audience, setAudience] = useState("")
  const [selected, setSelected] = useState<string[]>(initialSlots.map((slot) => slot.slot))
  const [running, setRunning] = useState<string[] | null>(null)
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [creditsAvailable, setCreditsAvailable] = useState(initialCredits)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const hasAnyItem = slots.some((slot) => slot.item)
  const anyGenerationReady = textReady || imageReady
  const offerReady = offer.trim().length > 0

  const toggleSlot = (slot: string) =>
    setSelected((current) => (current.includes(slot) ? current.filter((entry) => entry !== slot) : [...current, slot]))

  const generate = useCallback(
    async (requested?: string[]) => {
      if (running) return
      const order = requested ?? selected
      if (order.length === 0) return
      setError(null)
      setFailures({})
      setRunning(order)
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const summary = await postNdjson<{ done: true; generated: number; failed: number; creditsCharged: number }>(
          `/api/projects/${encodeURIComponent(projectId)}/market/ads-kit`,
          {
            offer: offer.trim(),
            ...(audience.trim() ? { audience: audience.trim() } : {}),
            slots: order,
          },
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
                const item = frame.item as AdsBenchItem
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
        setError(
          summary.failed > 0
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
              : "The bench stopped part-way. Pieces already written are saved below.",
        )
      } finally {
        abortRef.current = null
        setRunning(null)
      }
    },
    [audience, imageReady, offer, running, selected, textReady, projectId],
  )

  async function copyBody(item: AdsBenchItem) {
    try {
      await navigator.clipboard.writeText(item.body)
      setCopiedId(item.id)
      window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1600)
    } catch {
      // Clipboard blocked (permissions) — the founder can still select the text.
    }
  }

  const isRunning = (slot: string) => Boolean(running && running.includes(slot))

  return (
    <section aria-labelledby="ads-bench-heading" className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500/60 via-primary/60 to-emerald-500/60" aria-hidden />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Megaphone className="size-3.5 text-primary" aria-hidden /> Ads bench
            </p>
            <h2 id="ads-bench-heading" className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">
              {hasAnyItem ? "Ad drafts, ready to review" : "Draft your ad creatives"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Describe the offer once and Atai drafts copy for Facebook, Instagram and TikTok plus square and story
              image creatives, written from your offer and plan. Every piece is a draft saved to your library — you
              copy it into your ad platforms yourself. Atai doesn&apos;t place, run, or manage ads, and nothing is
              published from here.
            </p>
          </div>
          {creditsAvailable !== null && (
            <span className="shrink-0 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {creditsAvailable} credits available
            </span>
          )}
        </div>

        {!running && (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">What are you advertising?</span>
              <textarea
                value={offer}
                onChange={(e) => setOffer(e.target.value.slice(0, MAX_OFFER))}
                rows={3}
                maxLength={MAX_OFFER}
                placeholder="e.g. Weekend delivery bundle — six oven-fresh pastries delivered before breakfast, first delivery free."
                className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="text-right font-mono text-[10px] text-muted-foreground">
                {offer.length}/{MAX_OFFER}
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                Who should it speak to? <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <input
                type="text"
                value={audience}
                onChange={(e) => setAudience(e.target.value.slice(0, MAX_AUDIENCE))}
                maxLength={MAX_AUDIENCE}
                placeholder="e.g. Families in Kampala who order breakfast online"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Pieces to draft</legend>
              <div className="flex flex-wrap gap-2">
                {slots.map((slot) => {
                  const selectable = slot.kind === "image" ? imageReady : textReady
                  const checked = selected.includes(slot.slot)
                  return (
                    <button
                      key={slot.slot}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      disabled={!selectable}
                      onClick={() => toggleSlot(slot.slot)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        checked ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {checked && <Check className="size-3" aria-hidden />}
                      {slot.label}
                    </button>
                  )
                })}
              </div>
              {!imageReady && (
                <p className="text-xs text-muted-foreground">Image creatives aren&apos;t configured on this deployment — copy pieces still work.</p>
              )}
            </fieldset>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void generate()}
                disabled={!offerReady || selected.length === 0 || !anyGenerationReady}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Megaphone className="size-4" aria-hidden />
                Draft {selected.length} piece{selected.length === 1 ? "" : "s"}
              </button>
              {!offerReady && <span className="text-xs text-muted-foreground">Describe the offer first — one or two sentences is enough.</span>}
            </div>
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
              Drafting piece by piece — finished pieces appear below as they land.
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
          const isImage = slot.kind === "image"
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
                    disabled={!offerReady || (isImage ? !imageReady : !textReady)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Megaphone className="size-3" aria-hidden /> {failed ? "Retry this piece" : "Draft this"}
                  </button>
                )}
                {slot.item && !active && !running && (
                  <button
                    type="button"
                    onClick={() => void generate([slot.slot])}
                    disabled={!offerReady || (isImage ? !imageReady : !textReady)}
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
                  Drafting from your offer — this usually takes a few seconds…
                </div>
              )}

              {slot.item && !active && (
                <>
                  {isImage ? (
                    slot.item.media?.dataUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={slot.item.media.dataUrl}
                        alt={`${slot.label} — AI-drafted ad creative`}
                        className="mt-3 max-h-80 w-auto max-w-full rounded-xl border border-border object-contain"
                      />
                    ) : (
                      <p className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                        <ImageIcon className="size-3.5" aria-hidden /> Creative saved — open it in the Studio to view the image.
                      </p>
                    )
                  ) : (
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{slot.item.body}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {!isImage && (
                      <button
                        type="button"
                        onClick={() => void copyBody(slot.item as AdsBenchItem)}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
                      >
                        {copiedId === slot.item.id ? (
                          <>
                            <Check className="size-3 text-emerald-500" aria-hidden /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" aria-hidden /> Copy
                          </>
                        )}
                      </button>
                    )}
                    {slot.item.creditsCharged > 0 && (
                      <span className="font-mono text-[10px] text-muted-foreground">{slot.item.creditsCharged} credits</span>
                    )}
                    <span className="text-[10px] text-muted-foreground">AI draft — you place and run the ad yourself</span>
                    <Link
                      href={`/project/${projectId}/studio`}
                      className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
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
