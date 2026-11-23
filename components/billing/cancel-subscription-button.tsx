"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { postJson } from "@/lib/client/api"
import { formatUSD, type SubscriptionPlan } from "@/lib/billing/config"
import { cn } from "@/lib/utils"

interface CancelSubscriptionButtonProps {
  planName: string
  periodEnd: number
  monthlyCredits: number
  priceUSD: number
  currentPlanId: string
  /** Server-resolved published catalog; never a second local catalog. */
  plans: SubscriptionPlan[]
  className?: string
}

const CANCELLATION_REASONS = [
  { value: "too_expensive", label: "It's too expensive for my needs" },
  { value: "not_using_enough", label: "I'm not using it enough", requiresFeedback: true },
  { value: "missing_features", label: "Missing features I need", requiresFeedback: true },
  { value: "switching_competitor", label: "Switching to a competitor", requiresFeedback: true },
  { value: "technical_issues", label: "Experiencing technical issues", requiresFeedback: true },
  { value: "temporary_pause", label: "I need a temporary break", requiresFeedback: true },
  { value: "project_completed", label: "My project is completed", requiresFeedback: true },
  { value: "other", label: "Other reason", requiresFeedback: true },
]

export function CancelSubscriptionButton({
  planName,
  periodEnd,
  monthlyCredits,
  priceUSD,
  currentPlanId,
  plans,
  className,
}: CancelSubscriptionButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<"reason" | "confirm">("reason")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedReason, setSelectedReason] = useState("")
  const [additionalFeedback, setAdditionalFeedback] = useState("")

  const periodEndDate = new Date(periodEnd).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  const currentPlan = plans.find((p) => p.id === currentPlanId)
  const cheaperPlans = plans
    .filter((p) => !p.custom && p.priceUSD > 0 && p.priceUSD < (currentPlan?.priceUSD || 0))
    .sort((a, b) => b.priceUSD - a.priceUSD)

  const selectedReasonData = CANCELLATION_REASONS.find((r) => r.value === selectedReason)
  const requiresFeedback = selectedReasonData?.requiresFeedback ?? false
  const canContinue = Boolean(selectedReason) && (!requiresFeedback || additionalFeedback.trim().length > 0)

  function reset() {
    setOpen(false)
    setStep("reason")
    setError(null)
    setSelectedReason("")
    setAdditionalFeedback("")
  }

  async function handleCancel() {
    setIsLoading(true)
    setError(null)
    try {
      if (selectedReason) {
        try {
          await postJson("/api/billing/subscription/cancel-feedback", {
            reason: selectedReason,
            feedback: additionalFeedback,
            planName,
          })
        } catch {
          // Feedback is best-effort; cancellation must still proceed.
        }
      }
      await postJson("/api/billing/subscription/cancel")
      reset()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel subscription")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("text-sm text-muted-foreground hover:text-destructive hover:underline transition-colors", className)}
      >
        Cancel subscription
      </button>

      <Dialog open={open} onOpenChange={(next) => { if (!next) reset() }}>
        <DialogContent className="sm:max-w-lg">
          {step === "reason" ? (
            <>
              <DialogHeader>
                <DialogTitle>Cancel {planName}?</DialogTitle>
                <DialogDescription>
                  Your plan stays active until {periodEndDate}. After that, monthly credit grants and plan features end; permanent credits remain available.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                {CANCELLATION_REASONS.map((reason) => (
                  <label
                    key={reason.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/60",
                      selectedReason === reason.value && "border-primary bg-primary/5",
                    )}
                  >
                    <input
                      type="radio"
                      name="cancel-reason"
                      value={reason.value}
                      checked={selectedReason === reason.value}
                      onChange={() => setSelectedReason(reason.value)}
                      className="mt-1 size-4 accent-primary"
                    />
                    <span className="text-sm font-medium">{reason.label}</span>
                  </label>
                ))}
              </div>

              {selectedReason && requiresFeedback ? (
                <div>
                  <Label htmlFor="cancel-feedback" className="text-sm">Tell us more</Label>
                  <Textarea
                    id="cancel-feedback"
                    value={additionalFeedback}
                    onChange={(e) => setAdditionalFeedback(e.target.value)}
                    placeholder="What could Atai do better?"
                    rows={4}
                    className="mt-1.5"
                  />
                </div>
              ) : null}

              {cheaperPlans.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Prefer a smaller plan? You can switch from the plans section after closing this dialog.
                </p>
              ) : null}

              {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}

              <DialogFooter>
                <Button variant="outline" onClick={reset} disabled={isLoading}>Keep plan</Button>
                <Button
                  variant="destructive"
                  disabled={!canContinue || isLoading}
                  onClick={() => setStep("confirm")}
                >
                  Continue
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-destructive" /> Final confirmation
                </DialogTitle>
                <DialogDescription>
                  Cancel <span className="font-medium text-foreground">{planName}</span> ({formatUSD(priceUSD)}/mo, {monthlyCredits.toLocaleString()} credits/month)?
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                <p>Access continues until <span className="font-medium text-foreground">{periodEndDate}</span>.</p>
                <p className="mt-2">After that, the subscription will not renew and plan credit grants will stop.</p>
              </div>
              {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setStep("reason")} disabled={isLoading}>Go back</Button>
                <Button variant="destructive" onClick={() => void handleCancel()} disabled={isLoading}>
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : "Yes, cancel subscription"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
