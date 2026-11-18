"use client"

import { jsonFetcher, postJson } from "@/lib/client/api"
import type { TourContext } from "../registry"
import type { TourProgress } from "../types"
import { mergeProgress, sanitizeProgress } from "../progress"

export { mergeProgress, sanitizeProgress }

/**
 * Progress is stored on the founder's own account, so it survives a refresh,
 * a different device and a closed tab. The response shape is owned by
 * `app/api/settings/tours/route.ts`; nothing here trusts it to be complete.
 */

export interface TourStatusResponse {
  progress: Record<string, TourProgress>
  context: TourContext
}

const MIRROR_PREFIX = "atai:tour-progress:"

export function fetchTourStatus(): Promise<TourStatusResponse> {
  return jsonFetcher<TourStatusResponse>("/api/settings/tours")
}

export interface TourProgressPatch {
  tourId: string
  step: number
  status: TourProgress["status"]
  paused?: boolean
  skipped?: string[]
}

export function saveTourProgress(patch: TourProgressPatch): Promise<TourStatusResponse> {
  return postJson<TourStatusResponse>("/api/settings/tours", patch)
}

/** A local mirror so an interrupted tour still resumes when the network or the
 * signed-in session is not back yet. The server value wins when it is newer. */
export function mirrorProgress(userId: string, progress: Record<string, TourProgress>): void {
  try {
    globalThis.localStorage?.setItem(MIRROR_PREFIX + userId, JSON.stringify(progress))
  } catch {
    // Private modes and quota failures are non-events: the server is the record.
  }
}

export function readMirroredProgress(userId: string): Record<string, TourProgress> | null {
  try {
    const raw = globalThis.localStorage?.getItem(MIRROR_PREFIX + userId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return sanitizeProgress(parsed)
  } catch {
    return null
  }
}
