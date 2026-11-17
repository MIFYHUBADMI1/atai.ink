"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { SettingsShell } from "@/components/settings/settings-shell"
import { ArrowRight, Calendar, Check, AlertTriangle } from "lucide-react"
import { useSession, jsonFetcher } from "@/lib/client/api"
import { PERMANENT_CREDIT_PACKS, CREDIT_UNIT_NAME, formatUSD } from "@/lib/billing/config"
import type { SubscriptionPlan } from "@/lib/billing/config"
import { getCommercialPlans } from "@/lib/billing/entitlements/commercial-plans"
import { cn } from "@/lib/utils"
import { CheckoutButton } from "@/components/billing/checkout-button"
import { PlanCard } from "@/components/billing/plan-card"
import { CancelSubscriptionButton } from "@/components/billing/cancel-subscription-button"
import { BillingCheckoutReturn } from "@/components/billing/billing-checkout-return"
import useSWR from "swr"

type BillingOverview = {
  balance: { total: number; subscription: number; permanent: number }
  history: Array<{ id: string; reason: string; creditType: string; createdAt: number; amount: number }>
  subscription: { planId: string; currentPeriodEnd: number | null; cancelAtPeriodEnd: boolean } | null
  usageAlerts?: {
    creditsNearLimit: boolean
    creditsAtLimit: boolean
    creditUsageRatio: number | null
    businessCapReached: boolean
    businessCapNear: boolean
    warnings: string[]
  } | null
  /** Active plan catalog (commercial when the flag is on, else legacy). */
  plans?: SubscriptionPlan[]
  /** The commercial plan id the user's subscription maps to (flag on only). */
  activeCommercialPlanId?: string | null
  /** The user's current business count. */
  businessCount?: number
}

function formatCredits(amount: number): string {
  const abs = Math.abs(amount)
  return amount >= 0 ? `+${abs.toLocaleString()}` : `-${abs.toLocaleString()}`
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatPeriodEnd(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

export default function BillingSettingsPage() {
  const router = useRouter()
  const { session, isLoading } = useSession()

  const { data: billingData, error: billingError, isLoading: billingLoading, mutate: refreshBilling } = useSWR<BillingOverview>(
    session ? "/api/billing/overview" : null,
    jsonFetcher,
  )

  useEffect(() => {
    if (!isLoading && !session) router.replace("/login?next=%2Fsettings%2Fbilling")
  }, [session, isLoading, router])

  if (isLoading || !session) return null

  const balance = billingData?.balance ?? null
  const creditHistory = billingData?.history ?? []
  const activeSubscription = billingData?.subscription ?? null
  const usageAlerts = billingData?.usageAlerts ?? null
  const usageWarnings = usageAlerts?.warnings ?? []

  // Active catalog comes from the server (the commercial five-plan catalog),
  // so the in-app upgrade list matches the public pricing page.
  const plans: SubscriptionPlan[] = billingData?.plans ?? getCommercialPlans()
  const FREE_PLAN = plans.find((p) => p.priceUSD === 0) ?? plans[0]
  const activePlanId = billingData?.activeCommercialPlanId ?? activeSubscription?.planId ?? "explorer"
  const activePlan = activeSubscription
    ? (plans.find((p) => p.id === activePlanId) ?? FREE_PLAN)
    : FREE_PLAN
  const currentPeriodEnd: number | null = activeSubscription?.currentPeriodEnd ?? null
  const currentBusinesses = billingData?.businessCount ?? 0

  return (
    <SettingsShell title="Billing">
      <div className="flex flex-col gap-8">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Billing
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Atai Billing</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Credits, subscription, purchases, and transaction history.
          </p>
        </header>
        <BillingCheckoutReturn />

        {billingError ? (
          <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-destructive">Billing data couldn&apos;t be loaded</p>
                <p className="mt-1 text-sm text-muted-foreground">Your balance and subscription may be temporarily unavailable. No amounts are shown rather than risking stale data.</p>
              </div>
              <button type="button" onClick={() => void refreshBilling()} className="w-fit rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent">
                Retry
              </button>
            </div>
          </section>
        ) : null}

        {/* ── Credit Balance Card ── */}
        <section className="border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Available {CREDIT_UNIT_NAME}
              </p>
              <p className="mt-4 text-5xl font-semibold tabular-nums">
                {billingLoading ? "…" : billingError ? "—" : (balance?.total ?? 0).toLocaleString()}
              </p>
              <div className="mt-3 flex items-center gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground">Subscription: </span>
                  <span className="font-mono font-medium">{billingLoading ? "…" : billingError ? "—" : (balance?.subscription ?? 0).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Permanent: </span>
                  <span className="font-mono font-medium">{billingLoading ? "…" : billingError ? "—" : (balance?.permanent ?? 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Subscription credits are consumed first and expire at the end of your billing period.
            Permanent credits never expire and are consumed after subscription credits.
          </p>
        </section>

        {/* ── Usage alerts (advisory) ── */}
        {usageWarnings.length > 0 && (
          <section
            className={cn(
              "rounded-lg border p-5",
              usageAlerts?.creditsAtLimit || usageAlerts?.businessCapReached
                ? "border-red-500/30 bg-red-500/5"
                : "border-amber-500/30 bg-amber-500/5",
            )}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  usageAlerts?.creditsAtLimit || usageAlerts?.businessCapReached
                    ? "text-red-600 dark:text-red-400"
                    : "text-amber-600 dark:text-amber-400",
                )}
              />
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Plan usage</p>
                <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                  {usageWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                {usageAlerts?.creditUsageRatio != null && (
                  <div className="mt-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          usageAlerts.creditUsageRatio >= 1
                            ? "bg-red-500"
                            : usageAlerts.creditUsageRatio >= 0.8
                              ? "bg-amber-500"
                              : "bg-primary",
                        )}
                        style={{ width: `${Math.round(usageAlerts.creditUsageRatio * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {Math.round(usageAlerts.creditUsageRatio * 100)}% of this period&rsquo;s
                      credits used
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── Current Plan ── */}
        <section className="rounded-lg border border-border bg-card/50 p-5">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Current Plan
          </p>
          {billingLoading ? (
            <p className="mt-3 text-sm text-muted-foreground">Loading subscription…</p>
          ) : billingError ? (
            <p className="mt-3 text-sm text-muted-foreground">Subscription status unavailable until billing data loads.</p>
          ) : (
          <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold">{activePlan.name}</p>
                <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                  <Check className="size-3" /> Active
                </span>
              </div>
              {activePlan.priceUSD === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Free plan — upgrade to get monthly credits and more features.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {formatUSD(activePlan.priceUSD)}/month
                  {" · "}{activePlan.mirrorCredits.toLocaleString()} {CREDIT_UNIT_NAME}/month
                </p>
              )}
              {currentPeriodEnd && (
                <>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="size-3 shrink-0" />
                    Current period ends{" "}
                    <span className="font-medium text-foreground">
                      {formatPeriodEnd(currentPeriodEnd)}
                    </span>
                    {" "}— your credits remain available until then.
                  </p>
                  {activeSubscription && !activeSubscription.cancelAtPeriodEnd && (
                    <div className="mt-2">
                      <CancelSubscriptionButton
                        planName={activePlan.name}
                        periodEnd={currentPeriodEnd}
                        monthlyCredits={activePlan.mirrorCredits}
                        priceUSD={activePlan.priceUSD}
                        currentPlanId={activePlanId}
                      />
                    </div>
                  )}
                  {activeSubscription?.cancelAtPeriodEnd && (
                    <div className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                      <strong>Cancellation scheduled:</strong> Your subscription will end on{" "}
                      {formatPeriodEnd(currentPeriodEnd)}. You'll retain access until then.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          )}
        </section>

        {/* ── How Credits Work ── */}
        <section className="rounded-lg border border-border bg-card/50 p-5">
          <p className="text-sm font-medium">How Credits Work</p>
          <div className="mt-3 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            <div className="flex items-start gap-2">
              <span className="font-mono text-primary">1</span>
              <span>Subscription credits are consumed first</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-mono text-primary">2</span>
              <span>Permanent credits are consumed second</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-mono text-primary">3</span>
              <span>New users get 500 free permanent credits on email verification</span>
            </div>
          </div>
        </section>

        {/* ── Subscription Plans ── */}
        <section className="border border-border bg-card p-6">
          <h2 className="text-xl font-medium">Subscription Plans</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {activePlan.priceUSD === 0
              ? "Choose a plan to unlock monthly credits and more capabilities."
              : <>Monthly subscriptions with recurring credit grants.{" "}
                <span className="font-medium text-primary">Our most popular plan is recommended</span> for best value.
              </>
            }
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 items-start">
            {plans.filter((p) => !p.custom).map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                activePlanId={billingData ? activePlanId : null}
                currentPeriodEnd={currentPeriodEnd}
                isLoggedIn={true}
                allPlans={plans}
                currentBusinesses={currentBusinesses}
              />
            ))}
          </div>
        </section>

        {/* ── Buy Permanent Credits ── */}
        <section className="border border-border bg-card p-6">
          <h2 className="text-xl font-medium">Buy Permanent Credits</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Permanent credits never expire and remain available after subscription cancellation.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PERMANENT_CREDIT_PACKS.map((pack) => (
              <div
                key={pack.id}
                className={cn(
                  "rounded-lg border border-border p-4 transition-colors hover:border-primary/50",
                  pack.popular && "border-primary/30",
                )}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{pack.label}</p>
                    <p className="mt-1 text-2xl font-bold text-primary">{formatUSD(pack.priceUSD)}</p>
                  </div>
                  {pack.popular && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Popular</span>
                  )}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  ${(pack.priceUSD / pack.credits).toFixed(4)} per credit
                </div>
                <CheckoutButton
                  type="permanent"
                  productId={pack.id}
                  className="mt-3 w-full"
                >
                  Buy {pack.label}
                </CheckoutButton>
              </div>
            ))}
          </div>
        </section>

        {/* ── Credit History ── */}
        <section id="history" className="border border-border bg-card p-6">
          <h2 className="text-xl font-medium">Credit History</h2>

          {billingLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading credit history…</p>
          ) : billingError ? (
            <p className="mt-4 text-sm text-muted-foreground">Credit history is unavailable until billing data loads.</p>
          ) : creditHistory.length > 0 ? (
            <div className="mt-5">
              {/* Desktop table */}
              <div className="hidden sm:block">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-border pb-3 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  <span>Description</span>
                  <span>Type</span>
                  <span>Date</span>
                  <span className="text-right">Credits</span>
                </div>
                <div className="divide-y divide-border">
                  {creditHistory.map((tx) => (
                    <div
                      key={tx.id}
                      className="grid grid-cols-[1fr_auto_auto_auto] gap-4 py-3 text-sm"
                    >
                      <span className="text-muted-foreground truncate">{tx.reason}</span>
                      <span className="font-mono text-xs text-muted-foreground capitalize">
                        {tx.creditType}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(tx.createdAt)}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-sm font-medium tabular-nums text-right",
                          tx.amount >= 0 ? "text-success" : "text-muted-foreground",
                        )}
                      >
                        {formatCredits(tx.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mobile list */}
              <div className="sm:hidden space-y-3">
                {creditHistory.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm truncate">{tx.reason}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {tx.creditType} · {formatFullDate(tx.createdAt)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "font-mono text-sm font-medium tabular-nums shrink-0",
                        tx.amount >= 0 ? "text-success" : "text-muted-foreground",
                      )}
                    >
                      {formatCredits(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No transactions yet.</p>
          )}
        </section>
      </div>
    </SettingsShell>
  )
}
