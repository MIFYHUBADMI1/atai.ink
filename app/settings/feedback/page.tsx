"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { Bug, Camera, MonitorSmartphone, ShieldCheck } from "lucide-react"
import { SettingsShell } from "@/components/settings/settings-shell"
import { Card, CardContent } from "@/components/ui/card"
import { jsonFetcher, patchJson } from "@/lib/client/api"
import { toast } from "sonner"
import {
  DEFAULT_PRIVACY_PREFS,
  loadPrivacyPrefs,
  savePrivacyPrefs,
  type FeedbackPrivacyPrefs,
} from "@/lib/feedback/privacy"

const ITEMS: { key: keyof FeedbackPrivacyPrefs; icon: typeof Bug; title: string; hint: string }[] = [
  {
    key: "launcherEnabled",
    icon: Bug,
    title: "Show feedback button",
    hint: "The floating assistant in the corner of every page — reporting bugs and reaching your AI co-founder.",
  },
  {
    key: "collectPage",
    icon: MonitorSmartphone,
    title: "Share page context",
    hint: "Page address, route, title, and which business you were in — helps us reproduce the issue.",
  },
  {
    key: "collectDevice",
    icon: MonitorSmartphone,
    title: "Share device info",
    hint: "Browser, OS, screen size, and language — helps us spot device-specific bugs.",
  },
  {
    key: "collectErrors",
    icon: ShieldCheck,
    title: "Share recent errors",
    hint: "Sanitised summaries of recent errors on the page. Passwords and tokens are always redacted.",
  },
  {
    key: "autoScreenshot",
    icon: Camera,
    title: "Auto-attach page screenshot",
    hint: "Capture the current page automatically when you submit a report. Stored privately, visible only to you and reviewers, deleted after 30 days.",
  },
]

export default function FeedbackPrivacyPage() {
  const [prefs, setPrefs] = useState<FeedbackPrivacyPrefs>(DEFAULT_PRIVACY_PREFS)
  const [hydrated, setHydrated] = useState(false)
  const { data } = useSWR<{ prefs: Partial<FeedbackPrivacyPrefs> | null }>(
    "/api/settings/feedback-privacy",
    jsonFetcher,
  )

  useEffect(() => {
    const local = loadPrivacyPrefs()
    const server = data?.prefs
    if (server) {
      const merged = { ...DEFAULT_PRIVACY_PREFS, ...server }
      setPrefs(merged)
      savePrivacyPrefs(merged)
    } else {
      setPrefs(local)
      if (data) {
        void patchJson("/api/settings/feedback-privacy", { prefs: local }).catch(() => {})
      }
    }
    setHydrated(true)
  }, [data])

  const update = (key: keyof FeedbackPrivacyPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    savePrivacyPrefs(next)
    void patchJson("/api/settings/feedback-privacy", { prefs: next }).catch((err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save privacy preference")
    })
  }

  return (
    <SettingsShell title="Feedback & privacy">
      <div className="flex flex-col gap-6">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Support</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Feedback & privacy</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Control the floating feedback assistant and exactly what diagnostic information your reports include.
          </p>
        </header>

        <Card>
          <CardContent className="divide-y divide-border py-2">
            {!hydrated ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">Loading privacy preferences…</div>
            ) : (
              ITEMS.map(({ key, icon: Icon, title, hint }) => (
                <label key={key} className="flex cursor-pointer items-start justify-between gap-4 px-4 py-4">
                  <span className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs[key]}
                    onChange={(e) => update(key, e.target.checked)}
                    className="mt-1 size-4 shrink-0 accent-primary"
                    aria-label={title}
                  />
                </label>
              ))
            )}
          </CardContent>
        </Card>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Your account identity (user ID, report reference, and email for admin review) is always attached to reports —
          it&apos;s how we verify ownership, prevent abuse, and pay contributor rewards. You can turn off the launcher
          here at any time; your report history stays available under{" "}
          <a href="/contributions" className="text-primary hover:underline">My Contributions</a>.
        </p>
      </div>
    </SettingsShell>
  )
}
