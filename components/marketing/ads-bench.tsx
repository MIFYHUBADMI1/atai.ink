"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ImageIcon,
  Info,
  ListChecks,
  Loader2,
  MapPin,
  Megaphone,
  RefreshCw,
  Square,
  Target,
  TriangleAlert,
} from "lucide-react"
import { postNdjson } from "@/lib/client/api"
import { downloadDataUrl } from "@/lib/client/download"
import { defaultBenchSlots } from "@/lib/marketing/studio/ads-kit-content"
import type { BenchGuide, BenchInputSource, GuideChannelId } from "@/lib/marketing/ads/beginner-guide"

export interface AdsBenchItem {
  id: string
  title: string
  body: string
  kind: "copy" | "email" | "social" | "timeline" | "blog" | "brief" | "image" | "voice" | "video"
  creditsCharged: number
  createdAt: number
  media?: { kind: "image" | "audio" | "video"; dataUrl?: string; jobId?: string; status?: string; notPersisted?: boolean }
  /** The founder's raw bench inputs persisted with the item (prefill on return). */
  input?: { offer: string; audience?: string }
  /** True when the stored item has viewable media the bench can fetch. */
  hasMedia?: boolean
  /** The media was too large to persist — nothing viewable exists for this item. */
  mediaNotPersisted?: boolean
}

export interface AdsBenchSlotView {
  slot: string
  label: string
  description: string
  kind: AdsBenchItem["kind"]
  /** Free posts the founder publishes, or paid ad pieces. */
  group: "posts" | "ads"
  /** Step by step: exactly where this draft gets pasted. */
  whereToPost: string
  /** What a good version of this looks like. */
  whatGoodLooksLike: string
  /** The places this piece makes sense on. */
  channelIds: GuideChannelId[]
  item: AdsBenchItem | null
}

const MAX_OFFER = 600
const MAX_AUDIENCE = 300

/** The founder is told where a prefilled value came from — never shown a
 * filled field with no explanation. */
const INPUT_SOURCE_NOTE: Record<BenchInputSource, string> = {
  "last-time": "We kept what you used here last time.",
  "your-own-words": "Prefilled from your advertising strategy.",
  "your-plan": "Prefilled from your plan.",
  none: "",
}

/** How much of the founder's time the place takes, as an ongoing commitment. */
const EFFORT_LABEL: Record<"low" | "medium" | "high", string> = {
  low: "Minutes a week",
  medium: "An hour or two a week",
  high: "Most days",
}

function sourceNote(source: BenchInputSource): string {
  const note = INPUT_SOURCE_NOTE[source]
  if (!note) return ""
  return `${note} Change it if you are promoting something else today.`
}

/**
 * One ad creative image. Fresh generations carry the blob inline; drafts loaded
 * from the bench store only a media flag, so the blob is fetched per item from
 * the studio's per-item read (same endpoint the Studio library uses).
 */
function SlotImage({ projectId, item, alt }: { projectId: string; item: AdsBenchItem; alt: string }) {
  const inline = item.media?.dataUrl && !item.media.notPersisted ? item.media : null
  const notPersisted = Boolean(item.mediaNotPersisted || item.media?.notPersisted)
  const [fetched, setFetched] = useState<{ dataUrl: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const fetchable = Boolean(item.hasMedia) && !notPersisted && !inline
  const loading = fetchable && !fetched && !failed

  useEffect(() => {
    if (!fetchable) return
    let cancelled = false
    setFailed(false)
    const controller = new AbortController()
    fetch(`/api/projects/${encodeURIComponent(projectId)}/market/studio?contentId=${encodeURIComponent(item.id)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = await response.json()
        const dataUrl = json?.data?.media?.dataUrl
        if (!response.ok || !json?.ok || typeof dataUrl !== "string" || !dataUrl) {
          throw new Error("media unavailable")
        }
        if (!cancelled) setFetched({ dataUrl })
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [projectId, item.id, fetchable])

  const shown = inline?.dataUrl ?? fetched?.dataUrl ?? null

  if (notPersisted) {
    return (
      <p className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        <ImageIcon className="size-3.5" aria-hidden /> This creative was too large to store — regenerate it to get a
        viewable image.
      </p>
    )
  }

  if (shown) {
    return (
      <div className="mt-3 flex flex-col items-start gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shown}
          alt={alt}
          className="max-h-80 w-auto max-w-full self-stretch rounded-xl border border-border object-contain"
        />
        <button
          type="button"
          onClick={() => void downloadDataUrl(shown, `ad-creative-${item.id}`).catch(() => {})}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Download className="size-3" aria-hidden /> Download image
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <p className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading your saved creative…
      </p>
    )
  }

  return (
    <p className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
      <ImageIcon className="size-3.5" aria-hidden /> Creative saved — open it in the Studio below to view the image.
    </p>
  )
}

/**
 * The Ads page bench: a business owner with no marketing experience reads
 * three steps, sees where their customers might already be, and gets the words
 * and visuals drafted from their own offer.
 *
 * Everything is a DRAFT saved to the content library. Nothing is published,
 * uploaded, or run on any ad platform — Atai does not place or manage ads.
 */
export function AdsBench({
  projectId,
  slots: initialSlots,
  creditsAvailable: initialCredits,
  textReady,
  imageReady,
  guide,
}: {
  projectId: string
  slots: AdsBenchSlotView[]
  creditsAvailable: number | null
  textReady: boolean
  imageReady: boolean
  guide: BenchGuide
}) {
  const [slots, setSlots] = useState(initialSlots)
  const [offer, setOffer] = useState(guide.inputs.offer)
  const [audience, setAudience] = useState(guide.inputs.audience)
  const [channels, setChannels] = useState<string[]>(guide.channels.map((channel) => channel.id))
  const [selected, setSelected] = useState<string[]>(guide.defaultSlots)
  const [selectionTouched, setSelectionTouched] = useState(false)
  const [running, setRunning] = useState<string[] | null>(null)
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [creditsAvailable, setCreditsAvailable] = useState(initialCredits)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const hasAnyItem = slots.some((slot) => slot.item)
  const anyGenerationReady = textReady || imageReady
  const offerReady = offer.trim().length > 0

  const postSlots = useMemo(() => slots.filter((slot) => slot.group === "posts"), [slots])
  const adSlots = useMemo(() => slots.filter((slot) => slot.group === "ads"), [slots])

  const toggleSlot = (slot: string) => {
    setSelectionTouched(true)
    setSelected((current) => (current.includes(slot) ? current.filter((entry) => entry !== slot) : [...current, slot]))
  }

  /** Choosing where to show up decides which pieces we suggest — until the
   * founder picks their own, the suggestion follows their channels. */
  const toggleChannel = (id: string) => {
    const next = channels.includes(id) ? channels.filter((entry) => entry !== id) : [...channels, id]
    setChannels(next)
    if (!selectionTouched) {
      setSelected(defaultBenchSlots(next as GuideChannelId[]))
    }
  }

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

  const renderSlotCard = (slot: AdsBenchSlotView) => {
    const failed = failures[slot.slot]
    const active = isRunning(slot.slot)
    const isImage = slot.kind === "image"
    const matches = slot.channelIds.filter((id) => channels.includes(id))
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

        {matches.length > 0 && (
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            For:{" "}
            {matches
              .map((id) => guide.channels.find((channel) => channel.id === id)?.label ?? id)
              .join(", ")}
          </p>
        )}

        <div className="mt-3 rounded-xl border border-border bg-muted/40 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <MapPin className="size-3" aria-hidden /> Where to post it
          </p>
          <p className="mt-1 text-xs leading-5">{slot.whereToPost}</p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            What good looks like
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{slot.whatGoodLooksLike}</p>
        </div>

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
              <SlotImage projectId={projectId} item={slot.item} alt={`${slot.label} — AI-drafted ad creative`} />
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
                href={`/project/${projectId}/studio?tab=library&item=${encodeURIComponent(slot.item.id)}`}
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Open in Studio <span aria-hidden>→</span>
              </Link>
            </div>
          </>
        )}
      </li>
    )
  }

  return (
    <section aria-labelledby="ads-bench-heading" className="flex flex-col gap-6">
      {/* ── Start here ─────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500/60 via-primary/60 to-emerald-500/60" aria-hidden />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Megaphone className="size-3.5 text-primary" aria-hidden /> Ads bench
            </p>
            <h2 id="ads-bench-heading" className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">
              {hasAnyItem ? "Your drafts, ready to post" : "Make your business visible"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              You don&apos;t need to know anything about marketing. Tell Atai what you are selling and who it is for, and
              it writes the posts and the ad copy — then tells you exactly where to paste each one. Every piece is a
              draft saved to your library: you copy it into your ad platforms yourself. Atai doesn&apos;t place, run, or
              manage ads, and nothing is published from here.
            </p>
          </div>
          {creditsAvailable !== null && (
            <span className="shrink-0 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {creditsAvailable} credits available
            </span>
          )}
        </div>

        <ol className="mt-4 grid gap-2 sm:grid-cols-3">
          {guide.steps.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-border bg-muted/40 p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] text-primary">
                  {index + 1}
                </span>
                {step.title}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
            </li>
          ))}
        </ol>
      </div>

      {/* ── First week ─────────────────────────────────────────────── */}
      <section aria-labelledby="ads-first-week-heading" className="flex flex-col gap-3">
        <h3 id="ads-first-week-heading" className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <ListChecks className="size-4 text-primary" aria-hidden /> Your first week
        </h3>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Four small things. A beginner who finishes these is ahead of most businesses that never post at all.
        </p>
        <ol className="grid gap-2 sm:grid-cols-2">
          {guide.firstActions.map((action) => (
            <li key={action.id} className="rounded-2xl border border-border bg-card p-3.5">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {action.kind === "ask" ? "Ask" : "Do"}
                </span>
                {action.title}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{action.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Where to show up ───────────────────────────────────────── */}
      <section aria-labelledby="ads-channels-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="ads-channels-heading" className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Target className="size-4 text-primary" aria-hidden /> Where your customers might already be
          </h3>
          <p className="text-xs text-muted-foreground">Tick the places you already use or can use.</p>
        </div>
        <ul className="grid gap-2 lg:grid-cols-2">
          {guide.channels.map((channel) => {
            const on = channels.includes(channel.id)
            return (
              <li key={channel.id} className="rounded-2xl border border-border bg-card p-4">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggleChannel(channel.id)}
                  className="flex w-full items-start gap-2.5 text-left"
                >
                  <span
                    className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                    aria-hidden
                  >
                    {on && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold tracking-tight">{channel.label}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {channel.cost === "free" ? "Free" : "Paid"}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {EFFORT_LABEL[channel.effort]}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{channel.whatItIs}</span>
                  </span>
                </button>
                <dl className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      What to post here
                    </dt>
                    <dd className="mt-1 text-xs leading-5">{channel.whatToPost}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      How to post there
                    </dt>
                    <dd className="mt-1 text-xs leading-5">{channel.whereToPost}</dd>
                  </div>
                </dl>
                <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-muted/40 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                  <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {channel.why}
                </p>
              </li>
            )
          })}
        </ul>
        {guide.others.length > 0 && (
          <details className="rounded-2xl border border-dashed border-border bg-card p-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
              <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
              Other places you can post later ({guide.others.length})
            </summary>
            <ul className="mt-3 flex flex-col gap-2">
              {guide.others.map((other) => (
                <li key={other.id} className="text-xs leading-5">
                  <span className="font-medium">{other.label}</span>{" "}
                  <span className="text-muted-foreground">— {other.why}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ── The offer ──────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h3 className="text-base font-semibold tracking-tight">What are you promoting?</h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          One or two sentences. This is what every draft below is written from, so keep it plain.
        </p>
        {!running && (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">The offer</span>
              <textarea
                value={offer}
                onChange={(e) => setOffer(e.target.value.slice(0, MAX_OFFER))}
                rows={3}
                maxLength={MAX_OFFER}
                placeholder="e.g. Weekend delivery bundle — six oven-fresh pastries delivered before breakfast, first delivery free."
                className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs leading-5 text-muted-foreground">{sourceNote(guide.inputs.offerSource)}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {offer.length}/{MAX_OFFER}
                </span>
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
              {sourceNote(guide.inputs.audienceSource) && (
                <span className="text-xs leading-5 text-muted-foreground">{sourceNote(guide.inputs.audienceSource)}</span>
              )}
            </label>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-medium">Pieces to draft</legend>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Publish for free — no ad budget
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {postSlots.map((slot) => {
                      const checked = selected.includes(slot.slot)
                      return (
                        <button
                          key={slot.slot}
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() => toggleSlot(slot.slot)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                            checked ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {checked && <Check className="size-3" aria-hidden />}
                          {slot.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Paid ads — need an ad account and a budget
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {adSlots.map((slot) => {
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
                </div>
              </div>
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

      {/* ── The drafts ─────────────────────────────────────────────── */}
      <section aria-labelledby="ads-drafts-heading" className="flex flex-col gap-3">
        <h3 id="ads-drafts-heading" className="text-base font-semibold tracking-tight">
          {hasAnyItem ? "Your drafts" : "Your drafts will appear here"}
        </h3>

        {postSlots.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Publish for free — no ad budget
            </p>
            <ol className="flex flex-col gap-3">{postSlots.map(renderSlotCard)}</ol>
          </div>
        )}

        {adSlots.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Paid ads — need an ad account and a budget
            </p>
            <ol className="flex flex-col gap-3">{adSlots.map(renderSlotCard)}</ol>
          </div>
        )}
      </section>
    </section>
  )
}
