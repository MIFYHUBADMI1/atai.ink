"use client"

import Link from "next/link"
import { ArrowRight, Coins, Cpu, Globe, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { formatNumber } from "@/lib/client/format"
import { cn } from "@/lib/utils"

export interface JourneyCost {
  readCost: number
  /** Flat price of the co-founder's write. */
  assessmentCost: number
  /** The chosen engine's price per turn, added to the write. */
  engineCost?: number
  engineName?: string | null
  required: number
  available: number
  shortfall: number
}

export const TOP_UP_HREF = "/billing/top-up"

const credits = (n: number) => `${formatNumber(n)} credit${n === 1 ? "" : "s"}`

export interface ShortfallRow {
  label: string
  value: number
  icon: "site" | "cofounder" | "engine" | null
  tone: "plain" | "total" | "balance" | "gap"
}

export interface ShortfallCopy {
  headline: string
  lead: string
  rows: ShortfallRow[]
  coveredPct: number
  coveredLine: string
  cta: string
}

export type ShortfallVariant = "connect" | "message"

/**
 * The words and numbers of the refusal, kept apart from the markup so the
 * thing the founder actually reads — the gap, what it buys, what they hold —
 * can be asserted without a DOM.
 *
 * `message` is the same refusal for a single co-founder turn: no site read, no
 * journey, just the price of the message and the balance that cannot cover it.
 */
export function describeShortfall(
  cost: JourneyCost,
  businessName: string,
  variant: ShortfallVariant = "connect",
): ShortfallCopy {
  const coveredPct = Math.min(100, Math.round((cost.available / Math.max(1, cost.required)) * 100))

  if (variant === "message") {
    return {
      headline: `You are ${credits(cost.shortfall)} short of your next message`,
      lead: `A message costs ${credits(cost.required)}. You have ${credits(cost.available)} today. Nothing has been taken from your balance.`,
      rows: [
        { label: "Your next message", value: cost.required, icon: "cofounder", tone: "plain" },
        ...((cost.engineCost ?? 0) > 0
          ? [
              {
                label: cost.engineName ? `Your engine — ${cost.engineName}` : "Your engine",
                value: cost.engineCost ?? 0,
                icon: "engine" as const,
                tone: "plain" as const,
              },
            ]
          : []),
        { label: "Your balance", value: cost.available, icon: null, tone: "balance" },
        { label: "Still needed", value: cost.shortfall, icon: null, tone: "gap" },
      ],
      coveredPct,
      coveredLine: `${coveredPct}% of the way covered by your balance.`,
      cta: `Add ${credits(cost.shortfall)}`,
    }
  }

  const name = businessName.trim() || "your business"
  return {
    headline: `You are ${credits(cost.shortfall)} short of finishing ${name}`,
    lead: `Connecting ${name} costs ${credits(cost.required)}. You have ${credits(cost.available)} today. Nothing has been taken from your balance, and every answer you have given is saved.`,
    rows: [
      { label: "Reading your live site", value: cost.readCost, icon: "site", tone: "plain" },
      { label: "Your co-founder's first read", value: cost.assessmentCost, icon: "cofounder", tone: "plain" },
      ...((cost.engineCost ?? 0) > 0
        ? [
            {
              label: cost.engineName ? `Your engine — ${cost.engineName}` : "Your engine",
              value: cost.engineCost ?? 0,
              icon: "engine" as const,
              tone: "plain" as const,
            },
          ]
        : []),
      { label: "Total to connect", value: cost.required, icon: null, tone: "total" },
      { label: "Your balance", value: cost.available, icon: null, tone: "balance" },
      { label: "Still needed", value: cost.shortfall, icon: null, tone: "gap" },
    ],
    coveredPct,
    coveredLine: `${coveredPct}% of the way covered by your balance.`,
    cta: `Add ${credits(cost.shortfall)}`,
  }
}

/**
 * Shown the moment a founder cannot pay for the rest of connecting their
 * business. It answers the four things a "you are out of credits" wall usually
 * leaves out: what the credits buy, what they have, exactly how much is
 * missing, and where they are in the journey.
 */
export function CreditsShortfallDialog({
  open,
  onOpenChange,
  cost,
  businessName,
  stepLabel,
  stepHint,
  variant = "connect",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  cost: JourneyCost | null
  businessName: string
  stepLabel: string
  stepHint: string
  variant?: ShortfallVariant
}) {
  if (!cost) return null

  const copy = describeShortfall(cost, businessName, variant)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
            <Coins className="size-3.5" /> {stepLabel}
          </p>
          <DialogTitle className="text-xl font-semibold">{copy.headline}</DialogTitle>
          <p className="text-sm leading-relaxed text-muted-foreground">{copy.lead}</p>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <dl className="rounded-xl border border-border/70 bg-secondary/30 p-4 text-sm">
            {copy.rows.map((row) => (
              <div
                key={row.label}
                className={cn(
                  "flex items-center justify-between gap-3",
                  row.tone !== "plain" && "mt-2",
                  row.tone === "total" && "mt-3 border-t border-border/70 pt-3 font-medium",
                  row.tone === "balance" && "text-muted-foreground",
                  row.tone === "gap" && "font-semibold text-primary",
                )}
              >
                <dt className="flex items-center gap-2">
                  {row.icon === "site" ? <Globe className="size-3.5" /> : null}
                  {row.icon === "cofounder" ? <Sparkles className="size-3.5" /> : null}
                  {row.icon === "engine" ? <Cpu className="size-3.5" /> : null}
                  {row.label}
                </dt>
                <dd className="font-mono tabular-nums">{formatNumber(row.value)}</dd>
              </div>
            ))}
          </dl>

          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="img" aria-label={copy.coveredLine}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${copy.coveredPct}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{copy.coveredLine}</p>
          </div>

          <p className="rounded-xl border border-border/70 bg-background/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            {stepHint}
          </p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Not now
            </Button>
            <Button render={<Link href={TOP_UP_HREF} />} className="gap-1.5">
              {copy.cta}
              <ArrowRight className="size-4" />
            </Button>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {variant === "message"
              ? "Credits are taken when the message is answered, and a failed reply is refunded in full. Your draft stays on the page until you send it."
              : "Credits are taken when each step actually runs, and a failed co-founder read is refunded in full. Nothing is charged for a page Atai already read in the last 7 days."}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
