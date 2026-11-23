"use client"

import { useState } from "react"
import { Check, X, ChevronDown, Mail } from "lucide-react"
import { cn } from "@/lib/utils"
import { CheckoutButton } from "@/components/billing/checkout-button"
import { PlanChangeDialog } from "@/components/billing/plan-change-dialog"
import { formatUSD, CREDIT_UNIT_NAME } from "@/lib/billing/config"
import { translateFeature } from "@/lib/billing/feature-copy"
import type { PlanAvailability, SubscriptionPlan } from "@/lib/billing/config"
import { planCustomerInitiatedDowngrade } from "@/lib/billing/entitlements/downgrade"
import type { CommercialPlanId } from "@/lib/billing/entitlements/types"

import { AuthTrigger } from "@/components/auth/auth-trigger"
import { toast } from "sonner"

interface PlanCardProps {
  plan: SubscriptionPlan
  activePlanId?: string | null
  currentPeriodEnd?: number | null
  isLoggedIn?: boolean
  className?: string
  /** Who the plan suits, in the buyer's words. Shown under the plan name. */
  bestFor?: string
  /** What the buyer can do with the plan. When supplied, the raw feature lists
   * move into a disclosure below the card so the card reads as an outcome. */
  outcomes?: string[]
  /** Rewrite the plan's internal feature strings for a non-technical reader.
   * A flag, not a function prop: functions cannot cross the server→client
   * boundary during prerender. */
  translateLabels?: boolean
  /** The server-resolved published catalog used for current-plan resolution. */
  allPlans: SubscriptionPlan[]
  /** The user's current business count — lets the change dialog show the
   * downgrade business-cap impact before confirmation (Gate 6, Flow A). */
  currentBusinesses?: number
  /** Selected billing cycle from the pricing page toggle (commercial only). */
  billingCycle?: "monthly" | "annual"
}

const COMMERCIAL_PLAN_IDS = new Set<string>(["explorer", "starter", "growth", "scale", "enterprise"])

/**
 * Hard-rule-#3 guard (defensive): drop any feature line that names a capability
 * the plan's `availability` marks as not yet launched. Kept inline (no import of
 * the server-side entitlement module) so this client component stays light.
 */
function filterUnlaunchedFeatures(features: string[], availability?: PlanAvailability): string[] {
  if (!availability) return features
  const checks: Array<[boolean, RegExp]> = [
    [availability.agents, /agent/i],
    [availability.marketingAutomation, /marketing automation/i],
    [availability.knowledgeBase, /knowledge base/i],
  ]
  return features.filter((feature) => {
    for (const [available, pattern] of checks) {
      if (!available && pattern.test(feature)) return false
    }
    return true
  })
}

export function PlanCard({
  plan,
  activePlanId,
  currentPeriodEnd,
  isLoggedIn = false,
  className,
  bestFor,
  outcomes,
  translateLabels = false,
  allPlans,
  currentBusinesses,
  billingCycle = "monthly",
}: PlanCardProps) {
  const [selected, setSelected] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [checkoutPending, setCheckoutPending] = useState(false)

  const framed = Boolean(outcomes && outcomes.length > 0)
  const readable = translateLabels ? translateFeature : ((feature: string) => feature)

  // Hard rule #3: never render an unlaunched capability as available.
  const visibleFeatures = filterUnlaunchedFeatures(plan.features, plan.availability)
  const visibleNotIncluded = filterUnlaunchedFeatures(plan.notIncluded ?? [], plan.availability)

  const isActive = activePlanId === plan.id
  const planSource = allPlans
  const activePlan = planSource.find((p) => p.id === activePlanId) ?? null
  // A free account (legacy "free" or the commercial "explorer") is not an
  // active paid subscription, so other cards must offer purchase, not a switch.
  const activePlanIsPaid = Boolean(activePlan && activePlan.priceUSD > 0)
  const hasOtherActivePlan = Boolean(activePlanId) && !isActive && activePlanIsPaid
  const isHighlighted = selected || isActive || plan.popular

  const currentPlan = hasOtherActivePlan
    ? (planSource.find((p) => p.id === activePlanId) ?? null)
    : null

  // Purchase-state logic for the commercial catalog reconciliation.
  const isFree = plan.priceUSD === 0
  const isContact = plan.purchaseState === "contact" || plan.purchaseState === "soon"
  // Annual checkout is purchasable whenever the plan has an annual price —
  // checkout creates the annual Dodo product on demand when the owner has not
  // pre-provisioned one.
  const annualAvailable = Boolean(plan.annualPriceUSD) && plan.annualPurchaseState === "available"
  const effectiveCycle = billingCycle === "annual" && annualAvailable ? "annual" : "monthly"
  const annualRequestedButUnavailable = billingCycle === "annual" && !annualAvailable && !isFree && !isContact
  const isPurchasable =
    !isFree &&
    (effectiveCycle === "annual"
      ? annualAvailable
      : plan.purchaseState === "available")

  // Downgrade consequences (Gate 6, Flow A) — only when switching to a cheaper
  // commercial plan and the current business count is known.
  const downgrade =
    currentPlan &&
    plan.priceUSD < currentPlan.priceUSD &&
    currentBusinesses != null &&
    COMMERCIAL_PLAN_IDS.has(currentPlan.id) &&
    COMMERCIAL_PLAN_IDS.has(plan.id)
      ? planCustomerInitiatedDowngrade(
          currentPlan.id as CommercialPlanId,
          plan.id as CommercialPlanId,
          currentBusinesses,
        )
      : null

  function handleCardClick() {
    if (isActive) return
    setSelected((s) => !s)
  }

  function handleSubscribeClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (hasOtherActivePlan && currentPlan) {
      setDialogOpen(true)
    }
  }

  const featureLists = (
    <>
      <ul className="space-y-2.5">
        {visibleFeatures.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm">
            {feature.startsWith("Everything in") ? (
              <span className="mt-0.5 font-medium text-primary text-xs shrink-0">↳</span>
            ) : (
              <Check className="size-3.5 text-primary mt-0.5 shrink-0" />
            )}
            <span className={cn(
              "text-muted-foreground text-pretty",
              feature.startsWith("Everything in") && "font-medium text-foreground text-xs",
            )}>
              {readable(feature)}
            </span>
          </li>
        ))}
      </ul>

      {visibleNotIncluded.length > 0 && (
        <ul className="mt-4 space-y-2">
          {visibleNotIncluded.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm">
              <X className="size-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />
              <span className="text-muted-foreground/50 line-through decoration-muted-foreground/30">
                {readable(feature)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )

  const card = (
    <div
      role={isActive ? "article" : "button"}
      tabIndex={isActive ? undefined : 0}
      aria-pressed={!isActive ? selected : undefined}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (!isActive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          setSelected((s) => !s)
        }
      }}
      className={cn(
        "relative rounded-xl border p-6 transition-all duration-150 outline-none",
        !isActive && "cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        !isHighlighted && "border-border bg-card hover:border-primary/40 hover:shadow-sm",
        plan.popular && !selected && !isActive && "border-primary/50 bg-card shadow-lg shadow-primary/5",
        selected && !isActive && "border-primary bg-primary/5 shadow-lg shadow-primary/10 ring-2 ring-primary/20",
        isActive && "border-primary bg-primary/5 ring-2 ring-primary/30 cursor-default",
        className,
      )}
    >
      {plan.popular && (
        <div className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground select-none">
          Most Popular
        </div>
      )}

      {selected && !isActive && (
        <div className="absolute -top-3 right-6 rounded-full bg-primary/90 px-3 py-1 text-xs font-medium text-primary-foreground select-none">
          Selected
        </div>
      )}

      {isActive && (
        <div className="absolute -top-3 right-6 rounded-full bg-green-500 px-3 py-1 text-xs font-medium text-white flex items-center gap-1 select-none">
          <Check className="size-3" /> Current Plan
        </div>
      )}

      <div>
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
          <span className="text-xs font-bold text-primary">{plan.name[0]}</span>
        </div>
        <h3 className="mt-3 font-semibold text-lg">{plan.name}</h3>
        {bestFor && (
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-primary">{bestFor}</p>
        )}
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{plan.tagline}</p>
      </div>

      <div className="mt-5 pb-5 border-b border-border">
        {plan.priceUSD === 0 ? (
          <span className="text-3xl font-bold">Free</span>
        ) : effectiveCycle === "annual" && plan.annualPriceUSD ? (
          <>
            <span className="text-3xl font-bold">{formatUSD(plan.annualPriceUSD)}</span>
            <span className="ml-1 text-sm text-muted-foreground">/year</span>
            {plan.annualSavingsPct ? (
              <span className="ml-2 text-xs font-medium text-primary">save {plan.annualSavingsPct}%</span>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">12 months for the price of 11 · credits issued monthly</p>
          </>
        ) : (
          <>
            <span className="text-3xl font-bold">{formatUSD(plan.priceUSD)}</span>
            <span className="ml-1 text-sm text-muted-foreground">/month</span>
            {annualAvailable && plan.annualPriceUSD ? (
              <span className="ml-2 text-xs text-muted-foreground">
                or {formatUSD(plan.annualPriceUSD)}/yr
                {plan.annualSavingsPct ? (
                  <span className="ml-1 font-medium text-primary">save {plan.annualSavingsPct}%</span>
                ) : null}
              </span>
            ) : null}
          </>
        )}
        {annualRequestedButUnavailable ? (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground/80">
            Annual billing isn&rsquo;t available on this plan yet — checkout bills monthly.
          </p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground font-mono">
          {plan.mirrorCredits > 0
            ? `${plan.mirrorCredits.toLocaleString()} ${CREDIT_UNIT_NAME}`
            : "500 credits on verification"}
          {plan.provisionalCredits ? " (provisional)" : ""}
        </p>
        {plan.provisionalCredits ? (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground/70">
            Final credit amount confirmed at launch.
          </p>
        ) : null}
      </div>

      {outcomes && (
        <ul className="mt-5 space-y-2.5">
          {outcomes.map((outcome) => (
            <li key={outcome} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="text-muted-foreground text-pretty">{outcome}</span>
            </li>
          ))}
        </ul>
      )}

      {!framed && <div className="mt-5">{featureLists}</div>}

      <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {isLoggedIn ? (
          isFree ? (
            isActive ? (
              <button disabled className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium opacity-50 cursor-not-allowed">
                Current Plan
              </button>
            ) : null
          ) : isContact ? (
            <a
              href="mailto:support@atai.ink?subject=Atai%20plan%20enquiry"
              className={cn(
                "mt-6 block w-full text-center py-2.5 rounded-lg text-sm font-medium transition-colors",
                "border border-border hover:bg-accent inline-flex items-center justify-center gap-2",
              )}
            >
              <Mail className="size-4" /> Contact us
            </a>
          ) : hasOtherActivePlan && currentPlan ? (
            <button
              onClick={handleSubscribeClick}
              className={cn(
                "mt-6 w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                (plan.popular || selected)
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-border hover:bg-accent bg-background text-foreground",
              )}
            >
              Switch to {plan.name}
            </button>
          ) : isPurchasable ? (
            <CheckoutButton
              type="subscription"
              productId={plan.id}
              billingCycle={effectiveCycle}
              className={cn(
                "mt-6 w-full",
                (plan.popular || selected)
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-border hover:bg-accent bg-background text-foreground",
              )}
              disabled={isActive}
            >
              {isActive ? "Current Plan" : selected ? "Subscribe to Selected" : "Subscribe Now"}
            </CheckoutButton>
          ) : null
        ) : isContact ? (
          <a
            href="mailto:support@atai.ink?subject=Atai%20plan%20enquiry"
            className="mt-6 block w-full text-center py-2.5 rounded-lg text-sm font-medium transition-colors border border-border hover:bg-accent inline-flex items-center justify-center gap-2"
          >
            <Mail className="size-4" /> Contact us
          </a>
        ) : (
          <AuthTrigger
            view="signup"
            next="/pricing"
            className={cn(
              "mt-6 block w-full text-center py-2.5 rounded-lg text-sm font-medium transition-colors",
              isFree
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : (plan.popular || selected)
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-border hover:bg-accent",
            )}
          >
            {isFree ? "Get Started Free" : "Get Started"}
          </AuthTrigger>
        )}
      </div>
    </div>
  )

  const changeDialog = hasOtherActivePlan && currentPlan && (
    <PlanChangeDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      currentPlan={currentPlan}
      targetPlan={plan}
      currentPeriodEnd={currentPeriodEnd ?? null}
      loading={checkoutPending}
      downgradeImpact={
        downgrade
          ? {
              allowedBusinessesInToPlan: downgrade.impact.allowedBusinessesInToPlan,
              overLimit: downgrade.impact.overLimit,
              consequences: downgrade.consequences,
            }
          : null
      }
      onConfirm={() => {
        setCheckoutPending(true)
        setDialogOpen(false)
        fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "subscription", productId: plan.id, billingCycle: effectiveCycle }),
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
          .catch((err) => {
            console.error("Checkout error:", err)
            toast.error("Network error. Please try again.")
            setCheckoutPending(false)
          })
      }}
    />
  )

  if (!framed) {
    return (
      <>
        {card}
        {changeDialog}
      </>
    )
  }

  return (
    <>
      <div>
        {card}
        <details className="group mt-3 rounded-lg border border-border bg-card/60 px-5 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-muted-foreground marker:hidden transition-colors hover:text-foreground">
            <span>See exactly what this plan covers</span>
            <ChevronDown className="size-3.5 shrink-0 transition-transform duration-150 group-open:rotate-180" />
          </summary>
          <div className="mt-4">{featureLists}</div>
        </details>
      </div>
      {changeDialog}
    </>
  )
}
