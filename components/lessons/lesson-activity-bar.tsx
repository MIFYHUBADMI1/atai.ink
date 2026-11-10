"use client"

import { useEffect, useRef, useState } from "react"
import { Bookmark, BookmarkCheck, CircleCheck, Circle, Loader2 } from "lucide-react"
import type { LessonActivityAction } from "@/lib/lessons/activity"
import {
  trackLessonCompleted,
  trackLessonOpened,
  trackLessonUncompleted,
  trackResourceSaved,
  type LessonAnalyticsContext,
} from "@/lib/lessons/analytics"
import { cn } from "@/lib/utils"

type ActivityState = { saved: boolean; completed: boolean }

export function LessonActivityBar({
  lessonRef,
  initialSaved,
  initialCompleted,
  analytics,
  authenticated = true,
}: {
  lessonRef: string
  initialSaved: boolean
  initialCompleted: boolean
  analytics: LessonAnalyticsContext
  /** Signed-out readers cannot persist activity — show a sign-in cue instead
   * of controls that can only fail. */
  authenticated?: boolean
}) {
  const [state, setState] = useState<ActivityState>({ saved: initialSaved, completed: initialCompleted })
  const [busy, setBusy] = useState<"save" | "complete" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const opened = useRef(false)

  useEffect(() => {
    if (!authenticated || opened.current) return
    opened.current = true
    trackLessonOpened(lessonRef, analytics)
    // Recording the open powers "Continue learning"; a failure is not worth
    // interrupting a reader, so it stays silent.
    void fetch("/api/lessons/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonRef, action: "open" }),
    }).catch(() => undefined)
  }, [lessonRef, authenticated])

  async function send(action: LessonActivityAction): Promise<ActivityState | null> {
    const response = await fetch("/api/lessons/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonRef, action }),
    })
    const json = (await response.json()) as {
      ok?: boolean
      data?: { state?: ActivityState }
      error?: { message?: string }
    }
    if (!response.ok || !json.ok || !json.data?.state) {
      throw new Error(json.error?.message || "Could not update this lesson.")
    }
    return json.data.state
  }

  async function toggle(kind: "save" | "complete") {
    const action: LessonActivityAction =
      kind === "save" ? (state.saved ? "unsave" : "save") : state.completed ? "uncomplete" : "complete"
    setBusy(kind)
    setError(null)
    try {
      const next = await send(action)
      if (next) {
        setState(next)
        if (kind === "save") trackResourceSaved(lessonRef, next.saved, analytics)
        else if (next.completed) trackLessonCompleted(lessonRef, analytics)
        else trackLessonUncompleted(lessonRef, analytics)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this lesson.")
    } finally {
      setBusy(null)
    }
  }

  if (!authenticated) {
    return (
      <div className="mt-6">
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Bookmark className="size-4" />
          <a href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </a>{" "}
          to save this lesson and track your progress.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void toggle("save")}
          disabled={busy !== null}
          aria-pressed={state.saved}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60",
            state.saved
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {busy === "save" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : state.saved ? (
            <BookmarkCheck className="size-4" />
          ) : (
            <Bookmark className="size-4" />
          )}
          {state.saved ? "Saved" : "Save for later"}
        </button>
        <button
          type="button"
          onClick={() => void toggle("complete")}
          disabled={busy !== null}
          aria-pressed={state.completed}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60",
            state.completed
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {busy === "complete" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : state.completed ? (
            <CircleCheck className="size-4" />
          ) : (
            <Circle className="size-4" />
          )}
          {state.completed ? "Completed" : "Mark complete"}
        </button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
