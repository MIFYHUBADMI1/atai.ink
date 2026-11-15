import { ObjectId } from "mongodb"
import { subscriptionRecordsCol } from "@/lib/db/collections"
import { grantSubscriptionCredits } from "@/lib/billing/credit-service"
import { LEGACY_SUBSCRIPTION_PLANS } from "@/lib/billing/config"
import { getDodoClient } from "@/lib/billing/dodo-service"
import { resolveCommercialProduct, getCommercialPlanById } from "@/lib/billing/entitlements/commercial-plans"
import { addMonths } from "@/lib/billing/entitlements/annual-scheduler"
import { cryptoId } from "@/lib/store/id"
import { logger } from "@/lib/logging/logger"
import type { SubscriptionRecord } from "@/lib/billing/billing-types"
import type { SubscriptionStatus } from "@/lib/billing/config"

type ActivateInput = {
  subscriptionId: string
  customerId?: string
  productId?: string
  status?: string
  metadata?: Record<string, unknown>
  nextBillingDate?: string
  expectedUserId?: string
}

export type ActivateResult =
  | { ok: true; planId: string; alreadyRecorded?: boolean }
  | { ok: false; reason: string }

function stringMeta(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === "string" && value.trim() ? value : undefined
}

export async function activatePaidSubscription(input: ActivateInput): Promise<ActivateResult> {
  const subscriptionId = input.subscriptionId?.trim()
  if (!subscriptionId) return { ok: false, reason: "missing_subscription" }

  const userId = stringMeta(input.metadata, "userId") ?? stringMeta(input.metadata, "user_id") ?? input.expectedUserId
  if (!userId) return { ok: false, reason: "missing_user" }
  if (input.expectedUserId && userId !== input.expectedUserId) {
    return { ok: false, reason: "user_mismatch" }
  }

  const now = Date.now()
  const status = (input.status === "trialing" ? "trialing" : "active") as SubscriptionStatus

  // ── Commercial-first attribution ──────────────────────────────────────────
  // A Dodo product id that matches a commercial product (monthly or annual) is
  // the decisive signal: it can never be a legacy purchase. Resolving legacy
  // first here would attribute a commercial Starter to the legacy $79 starter
  // (same plan id, different price/credits) and fail Growth/Scale entirely.
  const commercialMatch =
    resolveCommercialProduct(input.productId) ??
    (() => {
      // Checkout writes `billingCycle` metadata for commercial plans ONLY. If
      // the product id didn't resolve but that marker is present, attribute by
      // plan id rather than risking a legacy same-name collision.
      const cycleMeta = stringMeta(input.metadata, "billingCycle")
      if (cycleMeta !== "monthly" && cycleMeta !== "annual") return undefined
      const byId = getCommercialPlanById(stringMeta(input.metadata, "planId") ?? "")
      return byId ? { plan: byId, billingCycle: cycleMeta } : undefined
    })()

  let grantAmount: number
  let recordPlanId: string
  let recordPlanName: string
  let recordPriceUSD: number
  let mirrorCreditsForRecord: number
  let billingCycle: "monthly" | "annual"
  let commercialPlanId: string | undefined
  // The month-1 grant window. Annual subs are charged once upfront but granted
  // monthly: activation grants month 0, and the annual sweep grants the rest —
  // anchored so the month-0 keys deduplicate.
  let grantPeriodEnd: number

  if (commercialMatch) {
    const cPlan = commercialMatch.plan
    billingCycle = commercialMatch.billingCycle
    const credits = cPlan.mirrorCredits
    if (!credits) return { ok: false, reason: "missing_plan" }
    grantAmount = credits
    mirrorCreditsForRecord = credits
    recordPlanId = cPlan.id
    recordPlanName = cPlan.name
    recordPriceUSD = billingCycle === "annual" ? (cPlan.annualPriceUSD ?? cPlan.priceUSD) : cPlan.priceUSD
    commercialPlanId = cPlan.commercialPlanId
    grantPeriodEnd =
      billingCycle === "annual" ? addMonths(now, 1) : input.nextBillingDate ? new Date(input.nextBillingDate).getTime() : now + 30 * 24 * 60 * 60 * 1000
  } else {
    // Legacy catalog — the authority for every pre-existing subscription.
    const planId = stringMeta(input.metadata, "planId") ?? stringMeta(input.metadata, "plan_id")
    const plan =
      (planId ? LEGACY_SUBSCRIPTION_PLANS.find((item) => item.id === planId) : undefined) ??
      LEGACY_SUBSCRIPTION_PLANS.find((item) => item.dodoProductId && item.dodoProductId === input.productId)
    const credits = plan?.mirrorCredits ?? Number(stringMeta(input.metadata, "credits") ?? 0)
    if (!plan || !credits) return { ok: false, reason: "missing_plan" }
    grantAmount = credits
    mirrorCreditsForRecord = credits
    recordPlanId = plan.id
    recordPlanName = plan.name
    recordPriceUSD = plan.priceUSD
    billingCycle = stringMeta(input.metadata, "billingCycle") === "annual" ? "annual" : "monthly"
    const legacyFullPeriodEnd = input.nextBillingDate ? new Date(input.nextBillingDate).getTime() : now + 30 * 24 * 60 * 60 * 1000
    grantPeriodEnd = legacyFullPeriodEnd
  }

  const col = await subscriptionRecordsCol()
  const prevSub = await col.findOne({
    userId,
    status: { $in: ["active", "trialing"] },
    dodoSubscriptionId: { $ne: subscriptionId },
  })
  if (prevSub) {
    await col.updateOne(
      { dodoSubscriptionId: prevSub.dodoSubscriptionId },
      { $set: { status: "cancelled", cancelAtPeriodEnd: true, updatedAt: now } },
    )
  }

  const granted = await grantSubscriptionCredits({
    userId,
    amount: grantAmount,
    subscriptionId,
    planId: recordPlanId,
    periodStart: now,
    periodEnd: grantPeriodEnd,
    metadata: { dodoCustomerId: input.customerId, productId: input.productId, event: "activation", billingCycle },
  })

  // The stored period is the PAID period: for annual this spans the full year
  // (Dodo's next_billing_date is +1y); the monthly-issuance sweep slices it.
  const paidPeriodEnd = input.nextBillingDate ? new Date(input.nextBillingDate).getTime() : grantPeriodEnd

  await upsertSubscriptionRecord({
    userId,
    dodoSubscriptionId: subscriptionId,
    dodoCustomerId: input.customerId,
    planId: recordPlanId,
    commercialPlanId,
    billingCycle,
    planName: recordPlanName,
    priceUSD: recordPriceUSD,
    mirrorCredits: mirrorCreditsForRecord,
    status,
    currentPeriodStart: now,
    currentPeriodEnd: paidPeriodEnd,
    nextBillingDate: input.nextBillingDate ? new Date(input.nextBillingDate).getTime() : undefined,
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
  })

  logger.info("billing.activate", "subscription recorded", {
    subscriptionId,
    userId,
    planId: recordPlanId,
    billingCycle,
    granted,
  })

  return { ok: true, planId: recordPlanId }
}

export async function syncDodoSubscription(subscriptionId: string, expectedUserId: string): Promise<ActivateResult> {
  const client = await getDodoClient()
  const raw = (await client.subscriptions.retrieve(subscriptionId)) as {
    subscription_id?: string
    status?: string
    product_id?: string
    next_billing_date?: string
    customer?: { customer_id?: string }
    metadata?: Record<string, unknown>
  }

  const status = raw.status ?? "active"
  if (status !== "active" && status !== "trialing") {
    return { ok: false, reason: `not_active:${status}` }
  }

  return activatePaidSubscription({
    subscriptionId: raw.subscription_id ?? subscriptionId,
    customerId: raw.customer?.customer_id,
    productId: raw.product_id,
    status,
    metadata: raw.metadata,
    nextBillingDate: raw.next_billing_date,
    expectedUserId,
  })
}

async function upsertSubscriptionRecord(params: {
  userId: string
  dodoSubscriptionId: string
  dodoCustomerId?: string
  planId: string
  commercialPlanId?: string
  billingCycle?: "monthly" | "annual"
  planName: string
  priceUSD: number
  mirrorCredits: number
  status: SubscriptionStatus
  currentPeriodStart: number
  currentPeriodEnd: number
  nextBillingDate?: number
  cancelAtPeriodEnd: boolean
  createdAt: number
  updatedAt: number
}) {
  const col = await subscriptionRecordsCol()
  const existing = await col.findOne({ dodoSubscriptionId: params.dodoSubscriptionId })
  if (existing) {
    await col.updateOne(
      { dodoSubscriptionId: params.dodoSubscriptionId },
      {
        $set: {
          userId: params.userId,
          planId: params.planId,
          ...(params.commercialPlanId ? { commercialPlanId: params.commercialPlanId } : {}),
          ...(params.billingCycle ? { billingCycle: params.billingCycle } : {}),
          planName: params.planName,
          priceUSD: params.priceUSD,
          mirrorCredits: params.mirrorCredits,
          status: params.status,
          currentPeriodStart: params.currentPeriodStart,
          currentPeriodEnd: params.currentPeriodEnd,
          nextBillingDate: params.nextBillingDate,
          cancelAtPeriodEnd: params.cancelAtPeriodEnd,
          updatedAt: Date.now(),
        },
      },
    )
    return
  }

  const record: SubscriptionRecord = {
    _id: new ObjectId(),
    id: `sub_${cryptoId()}`,
    userId: params.userId,
    dodoSubscriptionId: params.dodoSubscriptionId,
    dodoCustomerId: params.dodoCustomerId,
    planId: params.planId,
    commercialPlanId: params.commercialPlanId,
    billingCycle: params.billingCycle,
    planName: params.planName,
    priceUSD: params.priceUSD,
    mirrorCredits: params.mirrorCredits,
    status: params.status,
    currentPeriodStart: params.currentPeriodStart,
    currentPeriodEnd: params.currentPeriodEnd,
    nextBillingDate: params.nextBillingDate,
    cancelAtPeriodEnd: params.cancelAtPeriodEnd,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  }
  await col.insertOne(record)
}
