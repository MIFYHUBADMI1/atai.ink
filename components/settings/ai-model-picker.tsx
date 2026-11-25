"use client"

import Link from "next/link"
import { useState } from "react"
import { patchJson, type ApiError } from "@/lib/client/api"
import type { CofounderModelTier } from "@/lib/cofounder/models"

interface Props {
  /** Live admin-managed catalog, in display order. */
  tiers: CofounderModelTier[]
  /** Tier id currently stored on the user doc (null = never picked → first tier). */
  currentTierId: string | null
  /** Operator-forced tier via COFOUNDER_MODEL_TIER env, if set. */
  envTierId: string | null
  /** Called after a successful save, so a host surface can update its own view. */
  onSelected?: (tier: CofounderModelTier) => void
}

function costLabel(tier: CofounderModelTier): string {
  return tier.creditsPerMessage === 0 ? "Free" : `${tier.creditsPerMessage} credits / message`
}

/**
 * The founder picks a named ENGINE (mode) — never a raw model. The underlying
 * OpenRouter id is shown small for transparency, so founders see what powers
 * each mode without being invited to comparison-shop model names.
 */
export function AiModelPicker({ tiers, currentTierId, envTierId, onSelected }: Props) {
  const fallbackId = tiers[0]?.id ?? ""
  const [selected, setSelected] = useState(currentTierId ?? fallbackId)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const envLocked = envTierId !== null && tiers.some((t) => t.id === envTierId)
  const envTier = envTierId ? tiers.find((t) => t.id === envTierId) : undefined

  async function pick(tier: CofounderModelTier) {
    if (tier.id === selected || pending || envLocked) return
    const previous = selected
    setSelected(tier.id)
    setPending(true)
    setError(null)
    setSaved(false)
    try {
      await patchJson("/api/settings/ai-model", { tier: tier.id })
      setSaved(true)
      onSelected?.(tier)
    } catch (e) {
      setSelected(previous)
      const err = e as ApiError
      setError(err.message || "That engine didn't take — try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {envLocked ? (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          This deployment pins the co-founder to <strong className="text-foreground">{envTier?.name ?? envTierId}</strong>.
          Your pick is kept, but it can't take effect until the pin is lifted.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground">
          Engine switched — your next co-founder message and your next read use it.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {tiers.map((tier) => {
          const active = tier.id === selected
          const free = tier.creditsPerMessage === 0
          return (
            <button
              key={tier.id}
              type="button"
              disabled={pending || envLocked}
              onClick={() => void pick(tier)}
              aria-pressed={active}
              className={[
                "group flex flex-col gap-2 rounded-xl border p-4 text-left transition-all",
                active
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-card hover:border-primary/40 hover:bg-accent/40",
                pending || envLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-semibold tracking-tight">{tier.name}</span>
                <span
                  className={[
                    "rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-widest",
                    free ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-primary/10 text-primary",
                  ].join(" ")}
                >
                  {costLabel(tier)}
                </span>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{tier.strength}</p>
              <p className="mt-auto font-mono text-[10px] text-muted-foreground/70">{tier.modelId}</p>
            </button>
          )
        })}
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        Paid engines charge their listed cost once per message, and the same amount is added to the price of your
        first read of a business. If a turn fails, the charge is refunded automatically. See{" "}
        <Link href="/settings/billing" className="text-primary hover:underline">
          billing
        </Link>{" "}
        for your balance.
      </p>
    </div>
  )
}
