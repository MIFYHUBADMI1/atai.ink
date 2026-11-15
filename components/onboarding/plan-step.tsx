"use client"

import { useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { CheckoutButton } from "@/components/billing/checkout-button"
import { PlanChangeDialog } from "@/components/billing/plan-change-dialog"
import { formatUSD } from "@/lib/billing/config"
import { getCommercialPlans } from "@/lib/billing/entitlements/commercial-plans"
import { jsonFetcher } from "@/lib/client/api"
import { cn } from "@/lib/utils"

type Overview = {
  subscription: { planId: string; currentPeriodEnd: number | null; cancelAtPeriodEnd: boolean } | null
}

const PLANS = getCommercialPlans()

export function OnboardingPlanStep({
  selectedPlanId,
  onSelect,
  onBeforeCheckout,
}: {
  selectedPlanId?: string
  onSelect: (planId: string) => void
  onBeforeCheckout?: () => void | Promise<void>
}) {
  const { data } = useSWR<Overview>("/api/billing/overview", jsonFetcher)
  const activePlanId = data?.subscription?.planId ?? "explorer"
  const [changeTo, setChangeTo] = useState<string | null>(null)
  const [checkoutPending, setCheckoutPending] = useState(false)
  const current = PLANS.find((p) => p.id === activePlanId)
  const target = PLANS.find((p) => p.id === changeTo)
  const onPaidPlan = Boolean(current && current.priceUSD > 0)

  function startCheckout(planId: string) {
    setCheckoutPending(true)
    void Promise.resolve(onBeforeCheckout?.()).then(() => fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "subscription", productId: planId, returnPath: "/start" }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.data?.checkoutUrl) {
          window.location.href = json.data.checkoutUrl
        } else {
          toast.error(json.error?.message ?? "Failed to start checkout. Please try again.")
          setCheckoutPending(false)
        }
      })
      .catch(() => {
        toast.error("Failed to start checkout. Please try again.")
        setCheckoutPending(false)
      }))
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <h1 className="text-xl font-black tracking-tight sm:text-2xl">Choose how you want to start.</h1>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          Stay on Explorer or pick a plan. You can change this later in billing.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PLANS.filter((plan) => plan.active).map((plan) => {
          const isCurrent = plan.id === activePlanId
          const selected = (selectedPlanId ?? "explorer") === plan.id
          return (
            <div
              key={plan.id}
              className={cn(
                "rounded-xl border px-3 py-2.5",
                selected ? "border-indigo-500/40 bg-indigo-500/5" : "border-border bg-card",
              )}
            >
              <button type="button" className="w-full text-left" onClick={() => onSelect(plan.id)}>
                <p className="flex items-center justify-between gap-3 text-sm font-medium">
                  {plan.name}
                  <span className="font-mono text-xs text-muted-foreground">
                    {plan.priceUSD === 0 ? "Free" : `${formatUSD(plan.priceUSD)}/mo`}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{plan.tagline}</p>
                {isCurrent ? <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">Current plan</p> : null}
              </button>
              {plan.priceUSD > 0 && selected ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {onPaidPlan && activePlanId !== plan.id ? (
                    <button
                      type="button"
                      className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-accent"
                      onClick={() => setChangeTo(plan.id)}
                    >
                      Change plan
                    </button>
                  ) : (
                    <CheckoutButton type="subscription" productId={plan.id} returnPath="/start" onBeforeCheckout={onBeforeCheckout} className="h-8 rounded-lg px-3 text-sm" disabled={checkoutPending}>
                      Checkout {plan.name}
                    </CheckoutButton>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      {current && target ? (
        <PlanChangeDialog
          open={Boolean(changeTo)}
          onOpenChange={(open) => {
            if (!open) setChangeTo(null)
          }}
          currentPlan={current}
          targetPlan={target}
          currentPeriodEnd={data?.subscription?.currentPeriodEnd ?? null}
          loading={checkoutPending}
          onConfirm={() => {
            setChangeTo(null)
            startCheckout(target.id)
          }}
        />
      ) : null}
    </div>
  )
}
