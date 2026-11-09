"use client"

import Link from "next/link"
import { useState } from "react"
import { patchJson, type ApiError } from "@/lib/client/api"

export interface FeatureToggleState {
  key: "seoAudit" | "growthTasks" | "campaigns" | "lessons"
  title: string
  description: string
  costNote?: string
  /** Operator env kill switch — the founder's flip is refused honestly. */
  blocked: boolean
  blockedNote?: string
  enabled: boolean
}

interface PatchResponse {
  preferences: Record<string, boolean>
  enabled: Record<string, boolean>
}

function Switch({
  enabled,
  disabled,
  onFlip,
  label,
}: {
  enabled: boolean
  disabled: boolean
  onFlip: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={onFlip}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200",
        enabled ? "border-primary bg-primary" : "border-border bg-muted",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block size-4 rounded-full bg-background shadow transition-transform duration-200",
          enabled ? "translate-x-6 bg-primary-foreground" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  )
}

export function FeatureToggles({ features }: { features: FeatureToggleState[] }) {
  const [state, setState] = useState<FeatureToggleState[]>(features)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function flip(feature: FeatureToggleState) {
    const next = !feature.enabled
    setPendingKey(feature.key)
    setError(null)
    // Optimistic flip; the PATCH reply (or a revert on failure) is the truth.
    setState((s) => s.map((f) => (f.key === feature.key ? { ...f, enabled: next } : f)))
    try {
      const res = await patchJson<PatchResponse>("/api/settings/features", { [feature.key]: next })
      setState((s) =>
        s.map((f) =>
          res.enabled?.[f.key] === undefined ? f : { ...f, enabled: res.enabled[f.key] },
        ),
      )
    } catch (e) {
      setState((s) => s.map((f) => (f.key === feature.key ? { ...f, enabled: !next } : f)))
      const err = e as ApiError
      setError(err.message || "That switch didn't take — try again.")
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {state.map((f) => {
        const locked = f.blocked
        const disabled = locked || pendingKey === f.key
        return (
          <section key={f.key} className="border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-medium">{f.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{f.description}</p>
                {f.costNote ? (
                  <p className="mt-3 font-mono text-xs text-muted-foreground">{f.costNote}</p>
                ) : null}
                {locked && f.blockedNote ? (
                  <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    {f.blockedNote}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-center gap-2">
                <Switch
                  enabled={f.enabled && !locked}
                  disabled={disabled}
                  onFlip={() => void flip(f)}
                  label={`${f.title} on or off`}
                />
                <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  {locked ? "Locked" : f.enabled ? "On" : "Off"}
                </span>
              </div>
            </div>
          </section>
        )
      })}
      <p className="text-xs leading-5 text-muted-foreground">
        These switches are yours — flipping them changes what appears in your workspace right away. Pricing and
        availability are managed by Atai. See{" "}
        <Link href="/settings/billing" className="text-primary hover:underline">
          billing
        </Link>{" "}
        for credit costs.
      </p>
    </div>
  )
}
