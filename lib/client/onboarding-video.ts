"use client"

import useSWR from "swr"
import { jsonFetcher } from "@/lib/client/api"

interface OnboardingVideoResponse {
  url: string | null
  embedUrl: string | null
}

/**
 * The admin-configured onboarding video, resolved once per session via SWR.
 * Returns the ready-to-embed iframe URL (YouTube links are normalized
 * server-side), or null when no video is configured.
 */
export function useOnboardingVideoEmbedUrl(): string | null {
  const { data } = useSWR<OnboardingVideoResponse>(
    "/api/public/onboarding-video",
    jsonFetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: 300_000 },
  )
  return data?.embedUrl ?? null
}
