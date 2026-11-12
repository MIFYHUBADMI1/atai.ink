"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, Check, Copy, Download, ListChecks, Pencil, Undo2 } from "lucide-react"
import { CofounderMarkdown } from "@/components/cofounder/markdown"
import { parseCalendarDays, slotFileBase, type ParsedCalendar } from "@/lib/marketing/launch-kit-view"
import type { LaunchKitItem } from "@/components/marketing/launch-kit-panel"

/**
 * Structured display for one drafted launch-kit piece.
 *
 * A plain paragraph was readable but useless as a working document: the
 * 14-day calendar rendered as a wall of text with no sense of progress, and
 * no piece could be edited, exported, or tracked. This view renders the
 * calendar as day cards with a personal checklist (kept on this device only),
 * renders every other piece as formatted markdown, and gives each draft
 * copy / download / edit affordances. Edits are an explicit working copy —
 * they stay on this device and never claim to be saved to the library.
 */

type CalendarMode = { kind: "calendar"; days: ParsedCalendar }
type DraftMode = { kind: "markdown" } | CalendarMode

function progressKey(projectId: string, slot: string, itemId: string): string {
  return `atai:launchkit-progress:${projectId}:${slot}:${itemId}`
}

export function LaunchKitDraftView({
  projectId,
  slot,
  label,
  item,
}: {
  projectId: string
  slot: string
  label: string
  item: LaunchKitItem
}) {
  const [working, setWorking] = useState(item.body)
  const [editing, setEditing] = useState(false)
  const [doneDays, setDoneDays] = useState<number[]>([])
  const [hideDone, setHideDone] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setWorking(item.body)
    setEditing(false)
  }, [item.body])

  const key = progressKey(projectId, slot, item.id)
  useEffect(() => {
    try {
      const stored = globalThis.localStorage?.getItem(key)
      setDoneDays(stored ? (JSON.parse(stored) as unknown[]).filter((n): n is number => typeof n === "number") : [])
    } catch {
      setDoneDays([])
    }
  }, [key])

  const mode: DraftMode = useMemo(() => {
    if (slot === "content-calendar") {
      const parsed = parseCalendarDays(working)
      if (parsed) return { kind: "calendar", days: parsed }
    }
    return { kind: "markdown" }
  }, [slot, working])

  const doneSet = useMemo(() => new Set(doneDays), [doneDays])

  const persistDone = useCallback(
    (next: number[]) => {
      setDoneDays(next)
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(next))
      } catch {
        // Private browsing — the checklist still works for this visit.
      }
    },
    [key],
  )

  const toggleDay = useCallback(
    (day: number) => {
      persistDone(doneSet.has(day) ? doneDays.filter((n) => n !== day) : [...doneDays, day].sort((a, b) => a - b))
    },
    [doneDays, doneSet, persistDone],
  )

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(working)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard blocked — the founder can still select the text.
    }
  }

  function download() {
    try {
      const blob = new Blob([working], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${slotFileBase(label)}.md`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      // Download blocked — copy remains available.
    }
  }

  const days = mode.kind === "calendar" ? mode.days.days : null
  const notes = mode.kind === "calendar" ? mode.days.notes : null
  const doneCount = days ? days.filter((day) => doneSet.has(day.day)).length : 0
  const visibleDays =
    days && hideDone ? days.filter((day) => !doneSet.has(day.day)) : days

  return (
    <div className="mt-3 flex min-w-0 flex-col gap-3">
      {mode.kind === "calendar" && days ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ListChecks className="size-4 text-primary" aria-hidden />
              {doneCount} of {days.length} days done
            </p>
            <div className="flex min-w-0 flex-1 items-center gap-3 sm:justify-end">
              <div
                className="h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={doneCount}
                aria-valuemin={0}
                aria-valuemax={days.length}
                aria-label="Calendar days completed"
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                  style={{ width: `${days.length > 0 ? Math.round((doneCount / days.length) * 100) : 0}%` }}
                />
              </div>
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={hideDone}
                  onChange={(event) => setHideDone(event.target.checked)}
                  className="accent-primary"
                />
                Hide done
              </label>
            </div>
          </div>

          {notes && notes.length > 0 && (
            <p className="break-words text-xs leading-5 text-muted-foreground">{notes.join(" · ")}</p>
          )}

          <ol className="flex flex-col gap-2">
            {visibleDays?.map((day) => {
              const isDone = doneSet.has(day.day)
              return (
                <li
                  key={day.day}
                  className={`flex min-w-0 gap-3 rounded-xl border p-3 transition-colors sm:p-4 ${
                    isDone ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ${
                      isDone ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-primary/10 text-primary"
                    }`}
                    aria-hidden
                  >
                    {day.day}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Day {day.day}
                      </p>
                      {day.channel && (
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {day.channel}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 break-words text-sm leading-6 text-foreground">{day.idea}</p>
                    {day.cta && (
                      <p className="mt-2 flex items-start gap-1.5 break-words text-xs leading-5 text-primary">
                        <ArrowRight className="mt-0.5 size-3 shrink-0" aria-hidden />
                        <span>{day.cta}</span>
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isDone}
                    aria-label={`Mark day ${day.day} done`}
                    onClick={() => toggleDay(day.day)}
                    className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${
                      isDone
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-border text-transparent hover:border-primary hover:text-primary/30"
                    }`}
                  >
                    <Check className="size-3.5" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      ) : (
        <div className="min-w-0 text-sm leading-6 text-foreground">
          <CofounderMarkdown>{working}</CofounderMarkdown>
        </div>
      )}

      {editing && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <textarea
            value={working}
            onChange={(event) => setWorking(event.target.value)}
            rows={Math.min(24, Math.max(6, Math.ceil(working.length / 90)))}
            spellCheck={false}
            className="w-full resize-y rounded-xl border border-border bg-background p-3 font-mono text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Edit draft for ${label}`}
          />
          <p className="text-xs text-muted-foreground">
            Working copy — your edits stay on this device and are not saved to the library. Use Copy or Download to
            take this version with you, or undo to return to the original draft.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => void copyAll()}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-500" aria-hidden /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3" aria-hidden /> Copy
            </>
          )}
        </button>
        <button
          type="button"
          onClick={download}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Download className="size-3" aria-hidden /> Download
        </button>
        {editing ? (
          <button
            type="button"
            onClick={() => {
              setWorking(item.body)
              setEditing(false)
            }}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
          >
            <Undo2 className="size-3" aria-hidden /> Undo edits
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
          >
            <Pencil className="size-3" aria-hidden /> Edit
          </button>
        )}
        {item.creditsCharged > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground">{item.creditsCharged} credits</span>
        )}
        <span className="text-[10px] text-muted-foreground">AI draft — review before you post</span>
      </div>
    </div>
  )
}
