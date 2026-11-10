"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Circle, CircleCheck, Loader2 } from "lucide-react"
import { trackLessonCompleted, trackLessonUncompleted } from "@/lib/lessons/analytics"
import { cn } from "@/lib/utils"

/**
 * Mark-complete control for a path step. The reading surface for core
 * lessons is the resource page, so completion is recorded here; the library's
 * continue/saved rows and path progress read the same activity document.
 */
export function LessonCompletionToggle({
  lessonRef,
  initialCompleted,
  stage,
  categoryId,
}: {
  lessonRef: string
  initialCompleted: boolean
  stage: string
  categoryId: string
}) {
  const router = useRouter()
  const [completed, setCompleted] = useState(initialCompleted)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function toggle() {
    setBusy(true)
    setError(false)
    try {
      const response = await fetch("/api/lessons/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonRef, action: completed ? "uncomplete" : "complete" }),
      })
      const json = (await response.json()) as { ok?: boolean; data?: { state?: { completed: boolean } } }
      if (!response.ok || !json.ok || !json.data?.state) throw new Error()
      const next = json.data.state.completed
      setCompleted(next)
      const analytics = { kind: "core" as const, stage, categoryId, surface: "path" as const }
      if (next) trackLessonCompleted(lessonRef, analytics)
      else trackLessonUncompleted(lessonRef, analytics)
      router.refresh()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={completed}
      aria-label={completed ? "Mark lesson not complete" : "Mark lesson complete"}
      title={error ? "Could not update progress. Try again." : undefined}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-medium transition-colors disabled:opacity-60 sm:px-3",
        completed
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-border text-muted-foreground hover:text-foreground",
        error && "border-destructive/40 text-destructive",
      )}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : completed ? (
        <CircleCheck className="size-4" />
      ) : (
        <Circle className="size-4" />
      )}
      <span className="hidden sm:inline">{completed ? "Completed" : "Mark complete"}</span>
    </button>
  )
}
