"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { Check, ExternalLink, Film, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { jsonFetcher } from "@/lib/client/api"
import { youTubeEmbedUrl, youTubeThumbnailUrl } from "@/lib/resources/media"
import { cn } from "@/lib/utils"

interface SiteSettingsResponse {
  settings: { onboardingVideoUrl?: string }
  effectiveVideoUrl: string | null
}

/**
 * Admin control for the onboarding/getting-started video. The URL saved here
 * is shown in the first-run onboarding flow and in the /docs tutorial embed.
 * Clearing the field restores the NEXT_PUBLIC_ONBOARDING_VIDEO_URL env fallback.
 */
export function OnboardingVideoCard() {
  const { data, error, isLoading, mutate } = useSWR<SiteSettingsResponse>(
    "/api/admin/site-settings",
    jsonFetcher,
  )
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState<"save" | "clear" | null>(null)
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  useEffect(() => {
    if (data && !busy) setValue(data.settings.onboardingVideoUrl ?? "")
  }, [data, busy])

  const savedUrl = data?.settings.onboardingVideoUrl ?? ""
  const effectiveUrl = data?.effectiveVideoUrl ?? null
  const embedUrl = effectiveUrl ? (youTubeEmbedUrl(effectiveUrl) ?? effectiveUrl) : null
  const thumbnail = effectiveUrl ? youTubeThumbnailUrl(effectiveUrl) : null
  const dirty = value.trim() !== savedUrl

  async function save(next: string | null) {
    setBusy(next === null ? "clear" : "save")
    setMessage(null)
    try {
      const res = await fetch("/api/admin/site-settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ onboardingVideoUrl: next }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error?.message ?? "Couldn't save the video URL.")
      }
      setMessage({ kind: "ok", text: next ? "Video URL saved." : "Video URL cleared — env fallback applies." })
      await mutate()
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Couldn't save the video URL." })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Film className="size-4 text-muted-foreground" />
        <p className="text-sm font-medium">Onboarding video</p>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Paste a YouTube link (watch, share, Shorts, or youtu.be) or any https embed URL. It appears as a
        tour step in first-run onboarding and in the &ldquo;Getting Started with Atai&rdquo; tutorial on /docs.
      </p>

      {isLoading ? (
        <div className="mt-4 h-9 animate-pulse rounded-lg bg-muted" />
      ) : error ? (
        <p className="mt-4 text-sm text-destructive">Couldn&apos;t load site settings.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              inputMode="url"
              className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-3 font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void save(value.trim())}
                disabled={busy !== null || !dirty || !value.trim()}
                className="gap-1.5"
              >
                {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void save(null)}
                disabled={busy !== null || !savedUrl}
                className="gap-1.5"
              >
                {busy === "clear" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Clear
              </Button>
            </div>
          </div>

          {message ? (
            <p className={cn("text-xs", message.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")} role="status">
              {message.text}
            </p>
          ) : null}

          {effectiveUrl ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
              {thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbnail} alt="" loading="lazy" decoding="async" className="h-14 w-24 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="flex h-14 w-24 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Film className="size-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] text-muted-foreground" title={effectiveUrl}>
                  {effectiveUrl}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {savedUrl ? "Live for all users" : "Env fallback — not saved in admin yet"}
                </p>
              </div>
              {embedUrl ? (
                <a
                  href={effectiveUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                >
                  Open <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No video configured — onboarding and docs show no embed.</p>
          )}
        </div>
      )}
    </section>
  )
}
