import { ObjectId } from "mongodb"
import { subscriptionRecordsCol } from "@/lib/db/collections"
import { grantSubscriptionCredits } from "@/lib/billing/credit-service"
import { getLegacySubscriptionPlans } from "@/lib/billing/config"
import { getDodoClient } from "@/lib/billing/dodo-service"
import { resolveCommercialProduct, getCommercialPlanById } from "@/lib/billing/entitlements/commercial-plans"
import { addMonths } from "@/lib/billing/entitlements/annual-scheduler"
import { ensureCatalogVersionRecordsSafe } from "@/lib/billing/entitlements/versions"
import { resolveRuntimeCatalogProduct } from "@/lib/billing/catalog/runtime"
import {
  buildCatalogPurchasedTerms,
  buildCommercialPurchasedTerms,
  buildLegacyPurchasedTerms,
  buildPurchasedTermsFromRecord,
} from "@/lib/billing/subscription-terms"
import {
  findSubscriptionGrantEntry,
  linkSubscriptionGrantToPayment,
} from "@/lib/billing/subscription-payment-grants"
import { cryptoId } from "@/lib/store/id"
import { logger } from "@/lib/logging/logger"
import type { PurchasedTerms, SubscriptionRecord } from "@/lib/billing/billing-types"
import type { SubscriptionStatus, SubscriptionPlan } from "@/lib/billing/config"
import type { CommercialPlan } from "@/lib/billing/entitlements/commercial-plans"

type ActivateInput = {
  subscriptionId: string
  customerId?: string
  productId?: string
  status?: string
  metadata?: Record<string, unknown>
  nextBillingDate?: string
  previousBillingDate?: string
  paymentId?: string
  expectedUserId?: string
}

export type ActivateResult =
  | { ok: true; planId: string; alreadyRecorded?: boolean }
  | { ok: false; reason: string }

function stringMeta(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === "string" && value.trim() ? value : undefined
}

function grantWindowEnd(now: number, billingCycle: "monthly" | "annual", nextBillingDate?: string): number {
  if (billingCycle === "annual") return addMonths(now, 1)
  return nextBillingDate ? new Date(nextBillingDate).getTime() : now + 30 * 24 * 60 * 60 * 1000
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000
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
  const col = await subscriptionRecordsCol()
  const existing = await col.findOne({ dodoSubscriptionId: subscriptionId })
  if (existing && existing.userId !== userId) {
    return { ok: false, reason: "user_mismatch" }
  }

  const metadataCycle = stringMeta(input.metadata, "billingCycle")
  const legacyByProduct = getLegacySubscriptionPlans().find(
    (plan) => plan.dodoProductId && plan.dodoProductId === input.productId,
  )
  const catalogProduct = await resolveRuntimeCatalogProduct({
    dodoProductId: input.productId,
    planId: stringMeta(input.metadata, "planId"),
    billingCycle: metadataCycle === "annual" ? "annual" : metadataCycle === "monthly" ? "monthly" : undefined,
    allowPlanFallback:
      !legacyByProduct && (metadataCycle === "annual" || metadataCycle === "monthly"),
  })

  // ── Commercial-first attribution ──────────────────────────────────────────
  // A Dodo product id that matches a commercial product (monthly or annual) is
  // the decisive signal: it can never be a legacy purchase. Resolving legacy
  // first here would attribute a commercial Starter to the legacy $79 starter
  // (same plan id, different price/credits) and fail Growth/Scale entirely.
  const commercialMatch = legacyByProduct
    ? undefined
    : resolveCommercialProduct(input.productId) ??
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
  let grantPeriodEnd: number
  let buildTerms: ((recordId: string) => PurchasedTerms) | undefined

  // An existing record may predate pinning (M-08). Reconstruct its terms from
  // its own stored evidence before falling back to today's catalog, so a
  // replayed activation cannot re-price a subscription purchased earlier.
  const existingTerms =
    existing?.purchasedTerms ??
    (existing ? buildPurchasedTermsFromRecord(existing, { now }).terms : undefined)

  if (existing && !existingTerms) {
    // A record already exists but its historical terms are not reliable. A
    // replay must never re-price it from today's catalog; leave the event
    // unresolved for reconciliation instead.
    return { ok: false, reason: "existing_terms_unresolved" }
  }

  if (existingTerms) {
    // A replay of an already-pinned subscription. Never re-price or re-grant
    // from today's catalog: the purchased terms stay authoritative.
    const pinned = existingTerms
    billingCycle = pinned.billingInterval
    grantAmount = pinned.monthlyCredits
    mirrorCreditsForRecord = pinned.monthlyCredits
    recordPlanId = pinned.planId
    recordPlanName = pinned.planName
    recordPriceUSD = typeof existing?.priceUSD === "number" ? existing.priceUSD : pinned.priceMinor / 100
    commercialPlanId = pinned.commercialPlanId
    grantPeriodEnd = grantWindowEnd(now, billingCycle, input.nextBillingDate)
    buildTerms = () => pinned
  } else if (catalogProduct && catalogProduct.productType === "subscription") {
    if (catalogProduct.billingCycle === "one_time" || !catalogProduct.monthlyCredits) {
      return { ok: false, reason: "missing_plan" }
    }
    billingCycle = catalogProduct.billingCycle
    grantAmount = catalogProduct.monthlyCredits
    mirrorCreditsForRecord = catalogProduct.monthlyCredits
    recordPlanId = catalogProduct.planId
    recordPlanName = catalogProduct.planName
    recordPriceUSD = catalogProduct.priceMinor / 100
    commercialPlanId = catalogProduct.commercialPlanId
    grantPeriodEnd = grantWindowEnd(now, billingCycle, input.nextBillingDate)
    const catalogSnapshot = catalogProduct.entitlementSnapshot
    const codePlan = getCommercialPlanById(catalogProduct.planId)
    if (!catalogSnapshot && !codePlan) return { ok: false, reason: "missing_plan" }
    buildTerms = (recordId) => {
      const ctx = {
        subscriptionRecordId: recordId,
        dodoSubscriptionId: subscriptionId,
        dodoProductId: input.productId,
        activatedAt: now,
        periodStart: now,
        periodEnd: input.nextBillingDate ? new Date(input.nextBillingDate).getTime() : grantPeriodEnd,
      }
      if (catalogSnapshot) {
        return buildCatalogPurchasedTerms(ctx, {
          planId: catalogProduct.planId,
          planName: catalogProduct.planName,
          commercialPlanId: catalogProduct.commercialPlanId,
          billingInterval: billingCycle,
          priceMinor: catalogProduct.priceMinor,
          monthlyCredits: catalogProduct.monthlyCredits,
          entitlementSnapshot: catalogSnapshot,
          entitlementVersion: catalogProduct.entitlementVersion,
          pricingVersion: catalogProduct.pricingVersion,
        })
      }
      return buildCommercialPurchasedTerms(ctx, codePlan as CommercialPlan, billingCycle)
    }
  } else if (commercialMatch) {
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
    grantPeriodEnd = grantWindowEnd(now, billingCycle, input.nextBillingDate)
    buildTerms = (recordId) =>
      buildCommercialPurchasedTerms(
        {
          subscriptionRecordId: recordId,
          dodoSubscriptionId: subscriptionId,
          dodoProductId: input.productId,
          activatedAt: now,
          periodStart: now,
          periodEnd: input.nextBillingDate ? new Date(input.nextBillingDate).getTime() : grantPeriodEnd,
        },
        cPlan as CommercialPlan,
        billingCycle,
      )
  } else {
    // Legacy catalog — the authority for every pre-existing subscription.
    const planId = stringMeta(input.metadata, "planId") ?? stringMeta(input.metadata, "plan_id")
    const plan =
      legacyByProduct ??
      (planId ? getLegacySubscriptionPlans().find((item) => item.id === planId) : undefined) ??
      getLegacySubscriptionPlans().find(
        (item) => item.dodoProductId && item.dodoProductId === input.productId,
      )
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
    buildTerms = (recordId) =>
      buildLegacyPurchasedTerms(
        {
          subscriptionRecordId: recordId,
          dodoSubscriptionId: subscriptionId,
          dodoProductId: input.productId,
          activatedAt: now,
          periodStart: now,
          periodEnd: legacyFullPeriodEnd,
        },
        plan as SubscriptionPlan,
        billingCycle,
      )
  }

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

  const paidPeriodStart = input.previousBillingDate
    ? new Date(input.previousBillingDate).getTime()
    : now
  const granted = await grantSubscriptionCredits({
    userId,
    amount: grantAmount,
    subscriptionId,
    planId: recordPlanId,
    periodStart: paidPeriodStart,
    periodEnd: grantPeriodEnd,
    metadata: { dodoCustomerId: input.customerId, productId: input.productId, event: "activation", billingCycle },
  })
  if (!granted) {
    // The payment must never be linked to a grant that did not happen.
    return { ok: false, reason: "grant_failed" }
  }

  // The stored period is the PAID period: for annual this spans the full year
  // (Dodo's next_billing_date is +1y); the monthly-issuance sweep slices it.
  const paidPeriodEnd = input.nextBillingDate ? new Date(input.nextBillingDate).getTime() : grantPeriodEnd

  await upsertSubscriptionRecord({
    existing,
    userId,
    dodoSubscriptionId: subscriptionId,
    dodoCustomerId: input.customerId,
    dodoProductId: input.productId,
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
    buildPurchasedTerms: buildTerms,
  })

  // Link the payment record to the ledger grant that actually happened. The
  // grant's bucket id is stored on the ledger entry by grantSubscriptionCredits.
  const stored = await col.findOne({ dodoSubscriptionId: subscriptionId })
  const terms = stored?.purchasedTerms ?? existingTerms
  const creditsAllocated = terms?.annual?.totalCredits ?? terms?.monthlyCredits ?? grantAmount
  const grantEntry = await findSubscriptionGrantEntry(subscriptionId, grantPeriodEnd)
  if (grantEntry) {
    await linkSubscriptionGrantToPayment({
      userId,
      subscriptionId,
      planId: recordPlanId,
      periodStart: paidPeriodStart,
      periodEnd: grantPeriodEnd,
      amount: grantAmount,
      creditsAllocated,
      paidPeriodStart,
      paidPeriodEnd,
      ledgerEntryId: grantEntry.id,
      ledgerIdempotencyKey: grantEntry.idempotencyKey,
      bucketId:
        typeof grantEntry.metadata?.bucketId === "string" ? grantEntry.metadata.bucketId : undefined,
      paymentId: input.paymentId,
      now,
    })
  }

  await ensureCatalogVersionRecordsSafe()

  logger.info("billing.activate", "subscription recorded", {
    subscriptionId,
    userId,
    planId: recordPlanId,
    billingCycle,
    granted,
    termsPinned: !!existing?.purchasedTerms || !!buildTerms,
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
  existing: SubscriptionRecord | null
  userId: string
  dodoSubscriptionId: string
  dodoCustomerId?: string
  dodoProductId?: string
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
  buildPurchasedTerms?: (recordId: string) => PurchasedTerms
}) {
  const col = await subscriptionRecordsCol()
  const existing = params.existing
  const recordId = existing?.id ?? `sub_${cryptoId()}`
  // A record that already carries pinned terms keeps them forever. Only a
  // record without terms may be pinned from the purchase being activated.
  const purchasedTerms = existing?.purchasedTerms ?? params.buildPurchasedTerms?.(recordId)
  // Reconstructed terms without a historical snapshot are provisional, not
  // authoritative: keep the record in review.
  const termsStatus = purchasedTerms
    ? purchasedTerms.entitlementEvidence === "legacy_mapping_provisional"
      ? ("needs_review" as const)
      : ("pinned" as const)
    : undefined
  const termsReviewReason =
    purchasedTerms?.entitlementEvidence === "legacy_mapping_provisional"
      ? "missing_entitlement_snapshot"
      : undefined

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
          ...(params.dodoProductId ? { dodoProductId: params.dodoProductId } : {}),
          ...(purchasedTerms && termsStatus
            ? {
                purchasedTerms,
                termsStatus,
                ...(termsReviewReason ? { termsReviewReason } : {}),
                entitlementVersion: purchasedTerms.entitlementVersion,
                pricingVersion: purchasedTerms.pricingVersion,
                entitlementSnapshot: purchasedTerms.entitlementSnapshot as unknown as Record<string, unknown>,
              }
            : {}),
          updatedAt: Date.now(),
        },
      },
    )
    return
  }

  const record: SubscriptionRecord = {
    _id: new ObjectId(),
    id: recordId,
    userId: params.userId,
    dodoSubscriptionId: params.dodoSubscriptionId,
    dodoCustomerId: params.dodoCustomerId,
    dodoProductId: params.dodoProductId,
    planId: params.planId,
    commercialPlanId: params.commercialPlanId as SubscriptionRecord["commercialPlanId"],
    billingCycle: params.billingCycle,
    planName: params.planName,
    priceUSD: params.priceUSD,
    mirrorCredits: params.mirrorCredits,
    status: params.status,
    currentPeriodStart: params.currentPeriodStart,
    currentPeriodEnd: params.currentPeriodEnd,
    nextBillingDate: params.nextBillingDate,
    cancelAtPeriodEnd: params.cancelAtPeriodEnd,
    ...(purchasedTerms && termsStatus
      ? {
          purchasedTerms,
          termsStatus,
          ...(termsReviewReason ? { termsReviewReason } : {}),
          entitlementVersion: purchasedTerms.entitlementVersion,
          pricingVersion: purchasedTerms.pricingVersion,
          entitlementSnapshot: purchasedTerms.entitlementSnapshot as unknown as Record<string, unknown>,
        }
      : {}),
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  }
  try {
    await col.insertOne(record)
  } catch (err) {
    // Two concurrent webhooks can both see no record. The unique
    // dodoSubscriptionId index picks the winner; converge on it rather than
    // failing the delivery.
    if (!isDuplicateKeyError(err)) throw err
    const update = { ...record } as Record<string, unknown>
    delete update._id
    delete update.id
    delete update.createdAt
    await col.updateOne(
      { dodoSubscriptionId: params.dodoSubscriptionId },
      { $set: update },
    )
  }
}
