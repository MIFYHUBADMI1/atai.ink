"use client"

import { useState } from "react"
import { PlanCard } from "@/components/billing/plan-card"
import { cn } from "@/lib/utils"
import type { SubscriptionPlan } from "@/lib/billing/config"

interface PricingPlanGridProps {
  plans: SubscriptionPlan[]
  isLoggedIn: boolean
  guidance: Record<string, { bestFor: string; outcomes: string[] }>
  allPlans?: SubscriptionPlan[]
}

/**
 * Plan grid with the Monthly/Yearly billing toggle. The toggle only appears
 * when at least one paid plan has a provisioned annual product — never offer a
 * cycle that cannot actually be purchased (hard rule #3).
 */
export function PricingPlanGrid({ plans, isLoggedIn, guidance, allPlans }: PricingPlanGridProps) {
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly")

  const annualOffered = plans.some(
    (p) => !p.custom && p.priceUSD > 0 && p.annualPurchaseState === "available",
  )
  const paidPlans = plans.filter((p) => !p.custom)
  const enterprise = plans.find((p) => p.custom)

  return (
    <>
      {annualOffered && (
        <div className="mt-8 flex justify-center">
          <div
            role="group"
            aria-label="Billing cycle"
            className="inline-flex items-center rounded-full border border-border bg-card p-1"
          >
            {(["monthly", "annual"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={cycle === option}
                onClick={() => setCycle(option)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  cycle === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option === "monthly" ? "Monthly" : "Yearly"}
                {option === "annual" && (
                  <span className={cn("ml-1.5 text-xs", cycle === "annual" ? "text-primary-foreground/80" : "text-primary")}>
                    1 month free
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={cn("grid gap-5 lg:grid-cols-2", annualOffered ? "mt-6" : "mt-10")}>
        {paidPlans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isLoggedIn={isLoggedIn}
            bestFor={guidance[plan.id]?.bestFor}
            outcomes={guidance[plan.id]?.outcomes}
            translateLabels
            allPlans={allPlans}
            billingCycle={cycle}
          />
        ))}
      </div>

      {enterprise && (
        <div className="mt-5">
          <PlanCard
            plan={enterprise}
            isLoggedIn={isLoggedIn}
            bestFor={guidance[enterprise.id]?.bestFor}
            outcomes={guidance[enterprise.id]?.outcomes}
            translateLabels
            allPlans={allPlans}
            billingCycle={cycle}
          />
        </div>
      )}
    </>
  )
}