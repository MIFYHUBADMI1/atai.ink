"use client"

import { useRef } from "react"
import { trackVideoOpened, type LessonAnalyticsContext } from "@/lib/lessons/analytics"

/**
 * The embedded player, instrumented. "Opened" means the player loaded — it
 * is deliberately not "watched", which cannot be measured cross-origin.
 */
export function TrackedVideoEmbed({
  src,
  title,
  analytics,
  lessonRef,
}: {
  src: string
  title: string
  analytics: LessonAnalyticsContext
  lessonRef: string
}) {
  const fired = useRef(false)
  return (
    <iframe
      src={src}
      title={title}
      loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      className="size-full"
      onLoad={() => {
        if (fired.current) return
        fired.current = true
        trackVideoOpened(lessonRef, analytics)
      }}
    />
  )
}
