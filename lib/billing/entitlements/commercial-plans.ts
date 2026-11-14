/**
 * Atai — Commercial display + checkout catalog (Phase 3 → pricing page).
 *
 * This is the CUSTOMER-FACING view of the new five-plan commercial model. It is
 * derived from the entitlement source of truth in `catalog.ts` (PLAN_PRICING,
 * PROVISIONAL_MONTHLY_CREDITS, PLAN_BASE, availability) so the page shows
 * exactly what the entitlement engine enforces.
 *
 * It deliberately does NOT replace `lib/billing/config.ts`'s `SUBSCRIPTION_PLANS`
 * (legacy billing plumbing, Dodo products, ledger types). The legacy catalog is
 * left 100% intact to honour hard rule #4 (don't break existing billing).
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
 *     via per-plan env vars (DODO_COMMERCIAL_PRODUCT_*). Until the product owner
 *     provisions those products, `purchaseState` is "contact" and the UI shows a
 *     "Contact sales" CTA instead of calling checkout at a wrong/legacy price.
 *
 * Everything is gated behind ATAI_COMMERCIAL_PRICING_ENABLED (default OFF) so
 * the live pricing page is unchanged until the owner is ready to flip.
 *
 * @module lib/billing/entitlements/commercial-plans
 */

import type { CommercialPlanId } from "./types"
import { PLAN_PRICING, POPULAR_PLAN, PROVISIONAL_MONTHLY_CREDITS } from "./catalog"
import type { PlanAvailability, PurchaseState, SubscriptionPlan } from "@/lib/billing/config"

/** Master kill-switch for the commercial pricing page. Default OFF. */
export const COMMERCIAL_PRICING_ENABLED =
  process.env.ATAI_COMMERCIAL_PRICING_ENABLED === "true"

export interface CommercialPlan extends SubscriptionPlan {
  commercialPlanId: CommercialPlanId
  provisionalCredits: boolean
  annualPriceUSD: number | null
  purchaseState: PurchaseState
  availability: PlanAvailability
  /** Approx. annual savings vs. 12× monthly, when annual is offered. */
  annualSavingsPct?: number | null
}

/** Per-plan Dodo product env var. Set by the product owner after provisioning. */
function commercialProductEnvVar(id: CommercialPlanId): string {
  return `DODO_COMMERCIAL_PRODUCT_${id.toUpperCase()}`
}

export function getCommercialDodoProductId(id: CommercialPlanId): string | undefined {
  return process.env[commercialProductEnvVar(id)] || undefined
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

const PLAN_NAMES: Record<CommercialPlanId, string> = {
  explorer: "Explorer",
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
  enterprise: "Enterprise",
}

const PLAN_TAGLINES: Record<CommercialPlanId, string> = {
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

function buildCommercialPlan(id: CommercialPlanId): CommercialPlan {
  const pricing = PLAN_PRICING[id]
  const monthly = pricing.monthly
  const annual = pricing.annual
  const credits = PROVISIONAL_MONTHLY_CREDITS[id]
  const dodoProductId = getCommercialDodoProductId(id)
  const isCustom = id === "enterprise"
  const isFree = id === "explorer"

  let purchaseState: PurchaseState
  if (isCustom) purchaseState = "contact"
  else if (isFree) purchaseState = "available" // signup, not a purchase
  else purchaseState = dodoProductId ? "available" : "contact"

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
    annualSavingsPct: annualSavingsPct(monthly ?? 0, annual),
  }
}

let cached: CommercialPlan[] | null = null

/** The full commercial plan list, in display order. */
export function getCommercialPlans(): CommercialPlan[] {
  if (cached) return cached
  cached = PLAN_ORDER.map(buildCommercialPlan)
  return cached
}

export function getCommercialPlanById(id: string): CommercialPlan | undefined {
  return getCommercialPlans().find((p) => p.id === id)
}

/**
 * Resolve a Dodo product id back to a commercial plan (for webhook attribution).
 * Returns undefined when no commercial plan maps to the product — so the legacy
 * catalog remains the authority for every pre-existing subscription.
 */
export function resolveCommercialPlanByDodoProductId(productId: string): CommercialPlan | undefined {
  if (!productId) return undefined
  return getCommercialPlans().find((p) => p.dodoProductId === productId)
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
