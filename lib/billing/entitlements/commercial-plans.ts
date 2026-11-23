/**
 * Atai — Commercial display + checkout catalog (Phase 3 → pricing page).
 *
 * This is the CUSTOMER-FACING view of the new five-plan commercial model. It is
 * derived from the entitlement source of truth in `catalog.ts` (PLAN_PRICING,
 * PROVISIONAL_MONTHLY_CREDITS, PLAN_BASE, availability) so the page shows
 * exactly what the entitlement engine enforces.
 *
 * It deliberately does NOT replace `lib/billing/config.ts`'s
 * `LEGACY_SUBSCRIPTION_PLANS` (legacy billing plumbing, Dodo products, ledger
 * types). The legacy catalog is left 100% intact to honour hard rule #4
 * (don't break existing billing) and is used only to attribute renewals for
 * pre-existing subscriptions.
 *
 * ── Hard rules honoured here ────────────────────────────────────────────────
 * #1 No invented credit quantities: monthly credits are pulled from
 *     PROVISIONAL_MONTHLY_CREDITS and flagged `provisionalCredits: true` so the
 *     UI says so. Phase 4 ratifies the final numbers.
 * #3 Don't advertise unfinished features: Scale's agents / marketing automation
 *     / knowledge base are `availability:false` in catalog.ts, so they are
 *     filtered out of `features` and the `filterUnlaunchedFeatures` helper is
 *     applied defensively in the card.
 * #4 Don't break existing billing: commercial plans reference NEW Dodo products
 *     via per-plan env vars (DODO_COMMERCIAL_PRODUCT_*). When the owner has not
 *     provisioned one, checkout creates it on demand at the catalog price, so a
 *     paid plan is never unbuyable and never reuses a legacy product.
 *
 * This catalog is the ONLY offering. The legacy six-plan rows in
 * `lib/billing/config.ts` survive solely to attribute renewals of pre-existing
 * Dodo subscriptions (ADR-2); they are never displayed or sold.
 *
 * @module lib/billing/entitlements/commercial-plans
 */

import type { CommercialPlanId } from "./types"
import { PLAN_PRICING, POPULAR_PLAN, PROVISIONAL_MONTHLY_CREDITS } from "./catalog"
import type { PlanAvailability, PurchaseState, SubscriptionPlan } from "@/lib/billing/config"

export interface CommercialPlan extends SubscriptionPlan {
  commercialPlanId: CommercialPlanId
  provisionalCredits: boolean
  annualPriceUSD: number | null
  purchaseState: PurchaseState
  availability: PlanAvailability
  /** Dodo product id for the annual billing variant, once provisioned. */
  annualDodoProductId?: string
  /** Annual checkout is purchasable only when the annual product exists. */
  annualPurchaseState: PurchaseState
  /** Approx. annual savings vs. 12× monthly, when annual is offered. */
  annualSavingsPct?: number | null
}

/** Per-plan Dodo product env var. Set by the product owner after provisioning. */
function commercialProductEnvVar(id: CommercialPlanId, cycle: "monthly" | "annual"): string {
  const base = `DODO_COMMERCIAL_PRODUCT_${id.toUpperCase()}`
  return cycle === "annual" ? `${base}_ANNUAL` : base
}

export function getCommercialDodoProductId(
  id: CommercialPlanId,
  cycle: "monthly" | "annual" = "monthly",
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env[commercialProductEnvVar(id, cycle)] || undefined
}

/** A commercial Dodo product id (monthly OR annual variant) → plan + cycle. */
export function resolveCommercialProduct(
  productId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { plan: CommercialPlan; billingCycle: "monthly" | "annual" } | undefined {
  if (!productId) return undefined
  for (const plan of getCommercialPlans(env)) {
    if (plan.dodoProductId === productId) return { plan, billingCycle: "monthly" }
    if (plan.annualDodoProductId && plan.annualDodoProductId === productId) {
      return { plan, billingCycle: "annual" }
    }
  }
  return undefined
}

/**
 * Canonical Dodo product name for a commercial plan + cycle.
 *
 * The price is part of the name on purpose: it stops the commercial product
 * from ever being name-matched against a legacy product of the same plan
 * name (the legacy set owns "Atai — Starter"), and it makes a price change
 * create a new product instead of silently reusing a stale-priced one.
 */
export function commercialProductName(
  plan: Pick<SubscriptionPlan, "name" | "priceUSD" | "annualPriceUSD">,
  cycle: "monthly" | "annual",
): string {
  const price = cycle === "annual" ? plan.annualPriceUSD ?? plan.priceUSD : plan.priceUSD
  return cycle === "annual"
    ? `Atai — ${plan.name} — $${price}/yr`
    : `Atai — ${plan.name} — $${price}/mo`
}

export function commercialProductDescription(
  plan: Pick<SubscriptionPlan, "name" | "mirrorCredits">,
  cycle: "monthly" | "annual",
): string {
  const credits = plan.mirrorCredits.toLocaleString()
  return cycle === "annual"
    ? `${credits} Atai Credits per month, billed yearly. ${plan.name} plan.`
    : `${credits} Atai Credits per month. ${plan.name} plan.`
}

/** Feature copy written in the buyer's words, keyed by commercial plan id. */
const COMMERCIAL_FEATURES: Record<CommercialPlanId, { features: string[]; notIncluded?: string[] }> = {
  explorer: {
    features: [
      "Plan your business with the AI co-founder",
      "500 planning credits on email verification",
      "Research markets & competitors",
      "Explore what Atai can build for you",
      "Community support",
    ],
    notIncluded: [
      "Launch & host production businesses",
      "Monthly credit grants",
      "Custom domains",
      "Specialist teams",
      "Priority builds",
      "Direct support",
    ],
  },
  starter: {
    features: [
      "150,000 Atai Credits / month (provisional)",
      "Launch 1 business",
      "1 production app on your Atai subdomain",
      "AI co-founder (core)",
      "Specialist teams",
      "SEO & content marketing",
      "Business intelligence basics",
      "Learning paths",
      "Standard support",
    ],
    notIncluded: [
      "Custom domains",
      "Ads & competition monitoring",
      "Priority builds",
      "Direct support",
    ],
  },
  growth: {
    features: [
      "400,000 Atai Credits / month (provisional)",
      "Launch up to 4 businesses",
      "4 production apps",
      "1 custom domain",
      "Advanced AI co-founder",
      "Expanded teams",
      "Ads & competition monitoring",
      "Direct support",
    ],
    notIncluded: [
      "Priority compute",
      "Premium support",
    ],
  },
  scale: {
    features: [
      "1,200,000 Atai Credits / month (provisional)",
      "Unlimited businesses",
      "Unlimited production apps",
      "4 custom domains",
      "Premium AI co-founder",
      "Premium specialist teams + customization",
      "Full BI suite (financial, analytics, competition, multi-business, customer insights)",
      "Priority compute",
      "Premium support",
    ],
    notIncluded: [
      "Custom volume & dedicated infrastructure (Enterprise)",
    ],
  },
  enterprise: {
    features: [
      "Everything in Scale, tailored to your operation",
      "Custom credit volume",
      "Dedicated infrastructure",
      "SLA-backed uptime",
      "White-glove onboarding",
      "Dedicated account manager",
    ],
    notIncluded: [
      "Fixed public pricing (negotiated per contract)",
    ],
  },
}

/** Availability (hard rule #3) — mirrored from catalog.ts PLAN_BASE. */
const COMMERCIAL_AVAILABILITY: Record<CommercialPlanId, PlanAvailability> = {
  explorer: { agents: false, marketingAutomation: false, knowledgeBase: false },
  starter: { agents: false, marketingAutomation: false, knowledgeBase: false },
  growth: { agents: false, marketingAutomation: false, knowledgeBase: false },
  scale: { agents: false, marketingAutomation: false, knowledgeBase: false },
  enterprise: { agents: false, marketingAutomation: false, knowledgeBase: false },
}

const PLAN_ORDER: CommercialPlanId[] = ["explorer", "starter", "growth", "scale", "enterprise"]

export const PLAN_NAMES: Record<CommercialPlanId, string> = {
  explorer: "Explorer",
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
  enterprise: "Enterprise",
}

export const PLAN_TAGLINES: Record<CommercialPlanId, string> = {
  explorer: "Map out your business, free. No card, no launch yet.",
  starter: "Launch your first real business and start selling.",
  growth: "Run several businesses and grow them with ads.",
  scale: "Operate at scale across unlimited businesses.",
  enterprise: "Custom volume, dedicated infrastructure, and white-glove support.",
}

function annualSavingsPct(monthly: number, annual: number | null): number | null {
  if (!annual || monthly <= 0) return null
  const twelveMo = monthly * 12
  if (twelveMo <= annual) return null
  return Math.round(((twelveMo - annual) / twelveMo) * 100)
}

function buildCommercialPlan(
  id: CommercialPlanId,
  env: NodeJS.ProcessEnv = process.env,
): CommercialPlan {
  const pricing = PLAN_PRICING[id]
  const monthly = pricing.monthly
  const annual = pricing.annual
  const credits = PROVISIONAL_MONTHLY_CREDITS[id]
  const dodoProductId = getCommercialDodoProductId(id, "monthly", env)
  const annualDodoProductId = getCommercialDodoProductId(id, "annual", env)
  const isCustom = id === "enterprise"
  const isFree = id === "explorer"

  let purchaseState: PurchaseState
  let annualPurchaseState: PurchaseState
  if (isCustom) {
    purchaseState = "contact"
    annualPurchaseState = "contact"
  } else if (isFree) {
    purchaseState = "available" // signup, not a purchase
    annualPurchaseState = "available"
  } else {
    // Self-serve: checkout creates the Dodo product on demand at the catalog
    // price when the owner has not pre-provisioned one, so a paid plan is
    // never unbuyable.
    purchaseState = "available"
    annualPurchaseState = annual ? "available" : "soon"
  }

  const copy = COMMERCIAL_FEATURES[id]

  return {
    id,
    commercialPlanId: id,
    name: PLAN_NAMES[id],
    tagline: PLAN_TAGLINES[id],
    priceUSD: monthly ?? 0,
    mirrorCredits: credits ?? 0,
    interval: "monthly",
    active: true,
    custom: isCustom || undefined,
    popular: id === POPULAR_PLAN || undefined,
    features: copy.features,
    notIncluded: copy.notIncluded,
    dodoProductId,
    purchaseState,
    availability: COMMERCIAL_AVAILABILITY[id],
    provisionalCredits: credits !== null,
    annualPriceUSD: annual,
    annualDodoProductId,
    annualPurchaseState,
    annualSavingsPct: annualSavingsPct(monthly ?? 0, annual),
  }
}

/**
 * The full commercial plan list, in display order.
 *
 * Rebuilt on every call: the plan objects embed the Dodo product ids read from
 * the environment, and a cached copy would keep serving a stale product id for
 * the life of the process. Building five small objects is not worth that.
 */
export function getCommercialPlans(env: NodeJS.ProcessEnv = process.env): CommercialPlan[] {
  return PLAN_ORDER.map((id) => buildCommercialPlan(id, env))
}

export function getCommercialPlanById(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): CommercialPlan | undefined {
  return getCommercialPlans(env).find((p) => p.id === id)
}

/**
 * Resolve a Dodo product id back to a commercial plan (for webhook attribution).
 * Matches both the monthly and the annual variant. Returns undefined when no
 * commercial plan maps to the product — so the legacy catalog remains the
 * authority for every pre-existing subscription.
 */
export function resolveCommercialPlanByDodoProductId(
  productId: string,
  env: NodeJS.ProcessEnv = process.env,
): CommercialPlan | undefined {
  return resolveCommercialProduct(productId, env)?.plan
}

/**
 * Defensive hard-rule-#3 guard. Drops any feature line that names a capability
 * the plan's `availability` marks as not yet launched. Applied by the card so a
 * copy slip never advertises an unfinished feature.
 */
export function filterUnlaunchedFeatures(features: string[], availability: PlanAvailability): string[] {
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
