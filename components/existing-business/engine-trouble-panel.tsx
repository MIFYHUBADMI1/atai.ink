"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowRight, CheckCircle2, Cpu, Loader2, RefreshCw, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { jsonFetcher, patchJson, type ApiError } from "@/lib/client/api"
import type { CofounderModelTier } from "@/lib/cofounder/models"
import type { AssessmentFailureReason, IntakeEngineRef } from "@/lib/types/business-intake"

/** What the engine did, in the founder's terms rather than the provider's. */
const REASON_COPY: Record<AssessmentFailureReason, string> = {
  timeout: "did not reply in time",
  model_unavailable: "is no longer available from the provider",
  rate_limited: "is being rate-limited by the provider",
  provider_error: "failed on the provider's side",
  rejected: "was rejected by the provider",
  format: "replied in a form Atai could not trust",
  unknown: "did not answer",
}

interface EngineSettingsPayload {
  tier: string | null
  current: IntakeEngineRef | null
  tiers: CofounderModelTier[]
}

/**
 * The read failed because of the engine, not because of the business. Saying so,
 * naming the engine, and offering the switch here is the difference between a
 * founder who fixes it in one click and a founder who retries the same broken
 * engine until they give up. Once the engine has changed — here or in settings —
 * the panel stops blaming it and asks for one more try instead.
 */
export function EngineTroublePanel({
  projectId,
  failedEngine,
  reason,
  onRetry,
  retrying,
  blocked,
}: {
  projectId: string
  /** The engine that failed this attempt, from the stored stage. */
  failedEngine?: IntakeEngineRef
  reason?: AssessmentFailureReason
  onRetry: () => void
  retrying: boolean
  blocked?: boolean
}) {
  const [current, setCurrent] = useState<IntakeEngineRef | null>(null)
  const [tiers, setTiers] = useState<CofounderModelTier[]>([])
  const [picking, setPicking] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [switched, setSwitched] = useState<IntakeEngineRef | null>(null)
  const settingsHref = `/settings/ai?next=${encodeURIComponent(`/project/${projectId}/business`)}`

  useEffect(() => {
    let cancelled = false
    jsonFetcher<EngineSettingsPayload>("/api/settings/ai-model")
      .then((data) => {
        if (cancelled) return
        setCurrent(data.current)
        setTiers(data.tiers ?? [])
      })
      // The catalog is a convenience: without it the settings link still works.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  async function switchTo(tier: CofounderModelTier) {
    if (switching) return
    setSwitching(true)
    setError(null)
    try {
      await patchJson("/api/settings/ai-model", { tier: tier.id })
      // Re-read rather than trusting the pick: a deployment can pin the engine,
      // and then the saved choice is not the engine that will answer.
      const next = await jsonFetcher<EngineSettingsPayload>("/api/settings/ai-model")
      setCurrent(next.current)
      setTiers(next.tiers ?? [])
      if (next.current && next.current.tierId !== tier.id) {
        setError(
          `This deployment pins the engine to ${next.current.tierName}, so ${tier.name} cannot take effect yet. Your pick is saved.`,
        )
      } else {
        setSwitched(next.current)
        setPicking(false)
      }
    } catch (e) {
      setError((e as ApiError).message || "That engine didn't take — try again.")
    } finally {
      setSwitching(false)
    }
  }

  const changedElsewhere = Boolean(current && failedEngine && current.tierId !== failedEngine.tierId)
  const settled = switched ?? (changedElsewhere ? current : null)

  return (
    <div
      className={[
        "flex flex-col gap-3 rounded-xl border px-4 py-3",
        settled ? "border-primary/25 bg-primary/5" : "border-amber-500/30 bg-amber-500/[0.06]",
      ].join(" ")}
    >
      <div className="flex items-start gap-2.5">
        {settled ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
        ) : (
          <Cpu className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {settled
              ? "Your co-founder is on a different engine now"
              : "Your co-founder\u2019s engine couldn\u2019t answer"}
          </p>
          {settled ? (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">{settled.tierName}</span> will answer this time.{" "}
              {failedEngine ? (
                <>
                  <span className="font-medium text-foreground">{failedEngine.tierName}</span> was the engine that
                  failed{reason ? ` — it ${REASON_COPY[reason]}` : ""}.{" "}
                </>
              ) : null}
              Your saved read is reused, so this costs only the write.
            </p>
          ) : (
            <>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {failedEngine ? (
                  <>
                    <span className="font-medium text-foreground">{failedEngine.tierName}</span>{" "}
                    <span className="font-mono text-[10px]">({failedEngine.modelId})</span>{" "}
                    {REASON_COPY[reason ?? "unknown"]}. Nothing was invented — your read is saved and the charge was
                    refunded.
                  </>
                ) : (
                  <>
                    The engine behind your co-founder did not answer. Nothing was invented — your read is saved and the
                    charge was refunded.
                  </>
                )}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                A different engine usually answers straight away. You only pay for the write, and your saved read is
                reused.
              </p>
            </>
          )}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-destructive"
        >
          {error}
        </p>
      ) : null}

      {picking ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
          <label
            htmlFor="engine-switch"
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
          >
            Pick the engine behind your co-founder
          </label>
          {tiers.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The engine list didn&rsquo;t load.{" "}
              <Link href={settingsHref} className="text-primary hover:underline">
                Open engine settings
              </Link>{" "}
              to pick one.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  id="engine-switch"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={settled?.tierId ?? current?.tierId ?? ""}
                  disabled={switching}
                  onChange={(event) => {
                    const tier = tiers.find((candidate) => candidate.id === event.target.value)
                    if (tier) void switchTo(tier)
                  }}
                >
                  {current && !tiers.some((tier) => tier.id === current.tierId) ? (
                    <option value={current.tierId}>{current.tierName}</option>
                  ) : null}
                  {tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name} — {tier.creditsPerMessage === 0 ? "free" : `${tier.creditsPerMessage} credits/message`}
                    </option>
                  ))}
                </select>
                {switching ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Switching applies to your next read and your next co-founder message.{" "}
                <Link href={settingsHref} className="text-primary hover:underline">
                  Compare engines in settings
                </Link>
                .
              </p>
            </>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={onRetry} disabled={retrying || blocked}>
          {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Try again
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setPicking((open) => !open)} disabled={blocked}>
          <Wrench className="size-3.5" />
          Fix the issue
        </Button>
        <Link
          href={settingsHref}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          Engine settings
          <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  )
}
