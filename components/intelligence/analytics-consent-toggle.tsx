"use client"

import { useState } from "react"
import { toast } from "sonner"

/**
 * Founder-facing permission switch for co-founder product-analytics insights.
 * Pure control over the consent flag — it never reads or displays analytics
 * data. Default OFF; only the owner can flip it (the API enforces ownership).
 */
export function AnalyticsConsentToggle({
  projectId,
  initialEnabled,
  featureAvailable,
}: {
  projectId: string
  initialEnabled: boolean
  featureAvailable: boolean
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    if (!featureAvailable) return
    const next = !enabled
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/analytics-consent`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.message || "Failed to update analytics permission")
        return
      }
      setEnabled(next)
      toast.success(data.message)
    } catch (e) {
      toast.error((e as Error).message || "Failed to update analytics permission")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Co-founder analytics permission</h3>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${
              enabled ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
            }`}
          >
            {enabled ? "Granted" : "Off"}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {featureAvailable
            ? "Allow your co-founder to read this project's product analytics (events and retention your app reports to Atai) and suggest improvements. Off by default; you can revoke it anytime."
            : "Product analytics insights aren't available for your account yet."}
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={loading || !featureAvailable}
        className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          enabled
            ? "border border-border bg-card hover:bg-accent"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {loading ? "Updating..." : enabled ? "Revoke permission" : "Grant permission"}
      </button>
    </div>
  )
}