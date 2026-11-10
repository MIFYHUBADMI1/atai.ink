"use client"

import { useEffect } from "react"
import { trackPathCompleted, trackPathStarted } from "@/lib/lessons/analytics"

/**
 * Emits path start/completion from recorded progress, not from page views.
 * Deduped per browser session so a refresh does not inflate the funnel.
 */
const emitted = new Set<string>()

function once(key: string): boolean {
  if (emitted.has(key)) return false
  emitted.add(key)
  return true
}

export function PathProgressTracker({
  slug,
  stage,
  total,
  completed,
}: {
  slug: string
  stage: string
  total: number
  completed: number
}) {
  useEffect(() => {
    if (total === 0) return
    if (completed > 0 && once(`started:${slug}`)) trackPathStarted(slug, stage)
    if (completed >= total && once(`completed:${slug}`)) trackPathCompleted(slug, stage)
  }, [slug, stage, total, completed])

  return null
}
