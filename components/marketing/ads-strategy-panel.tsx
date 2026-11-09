"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, Copy, FileText, Loader2, Save, Sparkles, TriangleAlert } from "lucide-react"
import { postJson, putJson } from "@/lib/client/api"
import { AD_STRATEGY_BOUNDS } from "@/lib/marketing/ads/strategy-content"

export interface AdStrategyView {
  positioning: string
  icp: string
  geographies: string
  objectives: string[]
  channels: string[]
  budgetNote: string
  priorities: string[]
  brandVoice: string
  usps: string
  updatedAt: number
}

export interface StrategyDraftView {
  id: string
  title: string
  body: string
  kind: string
  creditsCharged: number
  createdAt: number
}

type DraftResponse = {
  id: string
  title: string
  body: string
  kind: string
  creditsCharged: number
  createdAt: number
}

const B = AD_STRATEGY_BOUNDS

const emptyStrategy: AdStrategyView = {
  positioning: "",
  icp: "",
  geographies: "",
  objectives: [],
  channels: [],
  budgetNote: "",
  priorities: [],
  brandVoice: "",
  usps: "",
  updatedAt: 0,
}

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, B.listItems)
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * The Strategy tab of the Growth Center: the founder's own advertising
 * strategy (free to save) plus AI recommendations drafted from it (metered,
 * saved to the content library — never written back into the strategy).
 */
export function AdsStrategyPanel({
  projectId,
  strategy: initialStrategy,
  prefill,
  creditsAvailable,
  aiTextReady,
  initialRecommendations,
}: {
  projectId: string
  strategy: AdStrategyView | null
  prefill: { positioning?: string; icp?: string }
  creditsAvailable: number | null
  aiTextReady: boolean
  initialRecommendations: StrategyDraftView[]
}) {
  const saved = initialStrategy ?? null
  const base = saved ?? { ...emptyStrategy, positioning: prefill.positioning ?? "", icp: prefill.icp ?? "" }

  const [positioning, setPositioning] = useState(base.positioning)
  const [icp, setIcp] = useState(base.icp)
  const [geographies, setGeographies] = useState(base.geographies)
  const [objectives, setObjectives] = useState(base.objectives.join("\n"))
  const [channels, setChannels] = useState(base.channels.join("\n"))
  const [budgetNote, setBudgetNote] = useState(base.budgetNote)
  const [priorities, setPriorities] = useState(base.priorities.join("\n"))
  const [brandVoice, setBrandVoice] = useState(base.brandVoice)
  const [usps, setUsps] = useState(base.usps)

  const [savedAt, setSavedAt] = useState<number>(saved?.updatedAt ?? 0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [recommendations, setRecommendations] = useState<StrategyDraftView[]>(initialRecommendations)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const result = await putJson<{ strategy: AdStrategyView }>(
        `/api/projects/${encodeURIComponent(projectId)}/ads/strategy`,
        {
          positioning: positioning.trim(),
          icp: icp.trim(),
          geographies: geographies.trim(),
          objectives: parseLines(objectives),
          channels: parseLines(channels),
          budgetNote: budgetNote.trim(),
          priorities: parseLines(priorities),
          brandVoice: brandVoice.trim(),
          usps: usps.trim(),
        },
      )
      setSavedAt(result.strategy.updatedAt)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "The strategy didn't save — try again.")
    } finally {
      setSaving(false)
    }
  }

  async function generateRecommendations() {
    if (generating) return
    setGenerating(true)
    setGenerateError(null)
    try {
      const item = await postJson<DraftResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/ads/strategy`,
        { action: "recommend" },
      )
      setRecommendations((current) => [
        { id: item.id, title: item.title, body: item.body, kind: item.kind, creditsCharged: item.creditsCharged, createdAt: item.createdAt },
        ...current.filter((draft) => draft.id !== item.id),
      ])
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "The recommendations didn't generate — try again.")
    } finally {
      setGenerating(false)
    }
  }

  async function copyBody(item: StrategyDraftView) {
    try {
      await navigator.clipboard.writeText(item.body)
      setCopiedId(item.id)
      window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1600)
    } catch {
      // Clipboard blocked — the founder can still select the text.
    }
  }

  const listField = (
    label: string,
    value: string,
    setValue: (next: string) => void,
    placeholder: string,
    optional = true,
  ) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        {label} {!optional && <span className="text-amber-600 dark:text-amber-400">*</span>}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </span>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <span className="font-mono text-[10px] text-muted-foreground">
        {parseLines(value).length}/{B.listItems} lines, {B.listItem} characters each
      </span>
    </label>
  )

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="ads-strategy-heading" className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500/60 via-primary/60 to-violet-500/60" aria-hidden />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" aria-hidden /> Advertising strategy
            </p>
            <h2 id="ads-strategy-heading" className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">
              Your strategy, in your own words
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Tell Atai who you&apos;re reaching and what matters. Saving is free — this records your intent so every
              draft, recommendation and campaign in this workspace starts from the same picture.
            </p>
          </div>
          {creditsAvailable !== null && (
            <span className="shrink-0 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {creditsAvailable} credits available
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">
              Positioning <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <textarea
              value={positioning}
              onChange={(e) => setPositioning(e.target.value.slice(0, B.positioning))}
              rows={3}
              maxLength={B.positioning}
              placeholder="e.g. The warm, local bakery that delivers oven-fresh breakfast before the queue forms."
              className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-right font-mono text-[10px] text-muted-foreground">
              {positioning.length}/{B.positioning}
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              Ideal customer <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <input
              type="text"
              value={icp}
              onChange={(e) => setIcp(e.target.value.slice(0, B.icp))}
              maxLength={B.icp}
              placeholder="e.g. Families in Kampala who order breakfast online"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-right font-mono text-[10px] text-muted-foreground">
              {icp.length}/{B.icp}
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              Geographies <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <input
              type="text"
              value={geographies}
              onChange={(e) => setGeographies(e.target.value.slice(0, B.geographies))}
              maxLength={B.geographies}
              placeholder="e.g. Kampala and surrounding districts"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-right font-mono text-[10px] text-muted-foreground">
              {geographies.length}/{B.geographies}
            </span>
          </label>

          {listField("Advertising objectives", objectives, setObjectives, "One per line — e.g. Fill the weekend delivery calendar")}
          {listField("Preferred channels", channels, setChannels, "One per line — e.g. Facebook, Instagram, TikTok")}
          {listField("Priorities", priorities, setPriorities, "One per line — e.g. Get the first 20 orders")}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              Budget note <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <input
              type="text"
              value={budgetNote}
              onChange={(e) => setBudgetNote(e.target.value.slice(0, B.budgetNote))}
              maxLength={B.budgetNote}
              placeholder="e.g. Start small, scale what works"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-right font-mono text-[10px] text-muted-foreground">
              {budgetNote.length}/{B.budgetNote}
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              Brand voice <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <input
              type="text"
              value={brandVoice}
              onChange={(e) => setBrandVoice(e.target.value.slice(0, B.brandVoice))}
              maxLength={B.brandVoice}
              placeholder="e.g. Warm, plain-spoken, never pushy"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-right font-mono text-[10px] text-muted-foreground">
              {brandVoice.length}/{B.brandVoice}
            </span>
          </label>

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">
              Selling points to emphasize <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <textarea
              value={usps}
              onChange={(e) => setUsps(e.target.value.slice(0, B.usps))}
              rows={3}
              maxLength={B.usps}
              placeholder="e.g. Oven-fresh on arrival; first delivery free; ordered by name, baked by name."
              className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-right font-mono text-[10px] text-muted-foreground">
              {usps.length}/{B.usps}
            </span>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
            {saving ? "Saving…" : savedAt ? "Save changes" : "Save strategy"}
          </button>
          {savedAt > 0 && !saving && !saveError && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3 text-emerald-500" aria-hidden /> Saved {formatDate(savedAt)}
            </span>
          )}
        </div>
        {saveError && (
          <p role="alert" className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
            {saveError}
          </p>
        )}
      </section>

      <section aria-labelledby="ads-recommendations-heading" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 id="ads-recommendations-heading" className="text-lg font-semibold tracking-tight">
              What Atai recommends
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              A generated read of your strategy and plan: 4–6 concrete moves and where to start. Each generation is a
              metered AI draft saved to your library — recommendations never overwrite what you typed above.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void generateRecommendations()}
            disabled={generating || !aiTextReady}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-primary bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            {generating ? "Reading your strategy…" : recommendations.length > 0 ? "Generate new recommendations" : "Generate recommendations"}
          </button>
        </div>
        {!aiTextReady && (
          <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            AI text generation isn&apos;t configured on this deployment yet — you can still save your strategy.
          </p>
        )}
        {generating && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden /> Reading your strategy and plan —
            this usually takes under a minute. The draft appears here and in your library when it lands.
          </p>
        )}
        {generateError && (
          <p role="alert" className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
            {generateError}
          </p>
        )}

        {recommendations.length > 0 ? (
          <ol className="mt-4 flex flex-col gap-3">
            {recommendations.map((draft, index) => (
              <li key={draft.id} className="rounded-xl border border-border bg-background p-3.5 sm:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold tracking-tight">
                    {recommendations.length > 1 ? `${index + 1}. ` : ""}
                    {draft.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatDate(draft.createdAt)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{draft.body}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => void copyBody(draft)}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    {copiedId === draft.id ? (
                      <>
                        <Check className="size-3 text-emerald-500" aria-hidden /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="size-3" aria-hidden /> Copy
                      </>
                    )}
                  </button>
                  {draft.creditsCharged > 0 && (
                    <span className="font-mono text-[10px] text-muted-foreground">{draft.creditsCharged} credits</span>
                  )}
                  <Link
                    href={`/project/${projectId}/studio?tab=library&item=${encodeURIComponent(draft.id)}`}
                    className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Open in Studio <span aria-hidden>→</span>
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          !generating && (
            <p className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
              <FileText className="size-3.5" aria-hidden /> No recommendations yet. Save your strategy, then generate
              one — you&apos;ll also find every draft in your Studio library.
            </p>
          )
        )}
      </section>
      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Atai doesn&apos;t place, run, or manage ads. Recommendations are drafts to act on yourself — no impressions,
        reach, or sales are promised, and nothing is published from here.
      </p>
    </div>
  )
}
