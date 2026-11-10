"use client"

import { useEffect, useState } from "react"
import { LessonActivityBar } from "@/components/lessons/lesson-activity-bar"

type ActivityState = { saved: boolean; completed: boolean }

/**
 * Save/complete controls for a core lesson whose reading surface is the
 * statically rendered resource page. The page cannot know the reader, so the
 * controls fetch their state after hydration and stay absent for signed-out
 * visitors or when the request fails — no misleading "not saved" flash.
 */
export function ResourceLessonActivity({
  lessonRef,
  stage,
  categoryId,
}: {
  lessonRef: string
  stage: string
  categoryId: string
}) {
  const [state, setState] = useState<ActivityState | null>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/lessons/activity?lessonRef=${encodeURIComponent(lessonRef)}`)
      .then(async (response) => {
        if (!active) return
        if (response.status === 401 || response.status === 403) return
        const json = (await response.json()) as {
          ok?: boolean
          data?: { state?: ActivityState | null }
        }
        if (!response.ok || !json.ok) return
        setState({
          saved: Boolean(json.data?.state?.saved),
          completed: Boolean(json.data?.state?.completed),
        })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [lessonRef])

  if (!state) return null
  return (
    <LessonActivityBar
      lessonRef={lessonRef}
      initialSaved={state.saved}
      initialCompleted={state.completed}
      analytics={{ kind: "core", stage, categoryId, surface: "resource_reader" }}
    />
  )
}
