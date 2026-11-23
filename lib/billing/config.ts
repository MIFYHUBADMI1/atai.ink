/**
 * Atai — Centralized Billing Configuration
 *
 * ONE place for all billing constants, pricing, cost models, and plans.
 * No other file should hard-code billing values.
 *
 * @module lib/billing/config
 */

import type { RuntimeLedgerTransactionType } from "@/runtime/contracts/billing"

// ─── Currency ────────────────────────────────────────────────────────────────

export const DEFAULT_BILLING_CURRENCY = "USD" as const

// ─── Internal Baseline Cost Model ────────────────────────────────────────────

export interface BaselineTier {
  units: number
  costUSD: number
}

export const BASELINE_COST_MODEL_V1 = {
  version: "BASELINE_COST_MODEL_V1" as const,
  currency: "USD" as const,
  tiers: [
    { units: 200, costUSD: 20 },
    { units: 500, costUSD: 45 },
    { units: 1_000, costUSD: 85 },
    { units: 5_000, costUSD: 350 },
    { units: 15_000, costUSD: 1_000 },
  ] as BaselineTier[],
}

/**
 * Convert Atai Credits → Baseline Cost Units.
 * 1,000 Atai Credits = 1 Baseline Cost Unit
 */
export const CREDITS_PER_BASELINE_UNIT = 1_000

// ─── Pricing Model ───────────────────────────────────────────────────────────

export const PRICING_MODEL_VERSION = "ATAI_PRICING_V1" as const
export const COST_MODEL_VERSION = "BASELINE_COST_MODEL_V1" as const

// ─── Application Build Pricing ───────────────────────────────────────────────

export interface BuildTier {
  id: string
  label: string
  credits: number
  description: string
}

export const BUILD_TIERS: Record<string, BuildTier> = {
  simple: {
    id: "simple",
    label: "Simple",
    credits: 50_000,
    description: "For smaller applications and straightforward website experiences.",
  },
  medium: {
    id: "medium",
    label: "Medium",
    credits: 75_000,
    description: "For more capable full-stack applications.",
  },
  complex: {
    id: "complex",
    label: "Complex",
    credits: 100_000,
    description: "For advanced application projects.",
  },
}

// ─── Subscription Plans ──────────────────────────────────────────────────────

/** Whether a plan can be purchased through checkout right now. */
export type PurchaseState = "available" | "contact" | "soon"

/**
 * Gates UI advertising of not-yet-launched capabilities (hard rule #3).
 * Mirrors the entitlement catalog's `availability` shape.
 */
export interface PlanAvailability {
  agents: boolean
  marketingAutomation: boolean
  knowledgeBase: boolean
}

export interface SubscriptionPlan {
  id: string
  name: string
  tagline: string
  priceUSD: number
  mirrorCredits: number
  interval: "monthly" | "yearly"
  active: boolean
  custom?: boolean
  popular?: boolean
  /** Features included in this plan — rendered as a checklist */
  features: string[]
  /** Features explicitly NOT included — rendered with an X for contrast */
  notIncluded?: string[]
  /** Dodo product ID — set in environment or database */
  dodoProductId?: string
  /** Dodo price ID — set in environment or database */
  dodoPriceId?: string
  /** Display/checkout status for the commercial catalog reconciliation. */
  purchaseState?: PurchaseState
  /** Gates UI advertising of not-yet-launched features (hard rule #3). */
  availability?: PlanAvailability
  /** True when the displayed monthly credit grant is provisional (Phase 4 TBD). */
  provisionalCredits?: boolean
  /** Annual price in USD, when annual billing is offered. */
  annualPriceUSD?: number | null
  /** Approx. annual savings vs. 12× monthly, when annual is offered. */
  annualSavingsPct?: number | null
  /** Dodo product id for the annual variant, once provisioned. */
  annualDodoProductId?: string
  /** Whether the annual variant can actually be purchased right now. */
  annualPurchaseState?: PurchaseState
  /** Canonical commercial plan id (entitlement catalog). */
  commercialPlanId?: string
}

/**
 * ⚠️ LEGACY PLAN CATALOG — renewal attribution only. Not an offering.
 *
 * These are the six plans Atai sold before the commercial five-plan catalog
 * (Explorer / Starter / Growth / Scale / Enterprise). They are kept because a
 * pre-existing Dodo subscription is renewed against its ORIGINAL product id
 * and plan id — renaming or deleting these rows would break that renewal and
 * the credit grants attached to it (hard rule #4).
 *
 * Nothing new is ever sold from this list. New purchases only ever use the
 * commercial catalog in `lib/billing/entitlements/commercial-plans.ts`
 * (derived from `lib/billing/entitlements/catalog.ts`).
 *
 * The old marketing copy is deliberately gone: those feature claims described
 * a catalogue that no longer exists, and the plan capabilities that survive
 * now live in the entitlement catalog.
 */
export const LEGACY_SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  // ── Free (default for all new accounts) ────────────────────────────────
  {
    id: "free",
    name: "Free",
    tagline: "Legacy free plan.",
    priceUSD: 0,
    mirrorCredits: 0,          // No monthly grant — one-time 500-credit welcome bonus on email verification
    interval: "monthly",
    active: true,
    features: [],
  },

  // ── Explorer ────────────────────────────────────────────────────────────
  {
    id: "explorer",
    name: "Explorer",
    tagline: "Legacy paid Explorer plan.",
    priceUSD: 12,
    mirrorCredits: 50_000,
    interval: "monthly",
    active: true,
    dodoProductId: process.env.DODO_PRODUCT_EXPLORER,
    features: [],
  },

  // ── Starter ─────────────────────────────────────────────────────────────
  {
    id: "starter",
    name: "Starter",
    tagline: "Legacy Starter plan.",
    priceUSD: 79,
    mirrorCredits: 300_000,
    interval: "monthly",
    active: true,
    dodoProductId: process.env.DODO_PRODUCT_STARTER,
    features: [],
  },

  // ── Business ────────────────────────────────────────────────────────────
  {
    id: "business",
    name: "Business",
    tagline: "Legacy Business plan.",
    priceUSD: 139,
    mirrorCredits: 600_000,
    interval: "monthly",
    active: true,
    popular: true,
    dodoProductId: process.env.DODO_PRODUCT_BUSINESS,
    features: [],
  },

  // ── Professional ────────────────────────────────────────────────────────
  {
    id: "professional",
    name: "Professional",
    tagline: "Legacy Professional plan.",
    priceUSD: 219,
    mirrorCredits: 1_400_000,
    interval: "monthly",
    active: true,
    dodoProductId: process.env.DODO_PRODUCT_PROFESSIONAL,
    features: [],
  },

  // ── Enterprise ──────────────────────────────────────────────────────────
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Legacy Enterprise plan.",
    priceUSD: 499,
    mirrorCredits: 5_000_000,
    interval: "monthly",
    active: true,
    custom: true,
    dodoProductId: process.env.DODO_PRODUCT_ENTERPRISE,
    features: [],
  },
]

// ─── Permanent Credit Packs ──────────────────────────────────────────────────

export interface PermanentCreditPack {
  id: string
  credits: number
  priceUSD: number
  label: string
  popular?: boolean
  /** Dodo product ID — set in environment or database */
  dodoProductId?: string
  /** Dodo price ID — set in environment or database */
  dodoPriceId?: string
}

export const PERMANENT_CREDIT_PACKS: PermanentCreditPack[] = [
  { id: "perm_200k", credits: 200_000, priceUSD: 59, label: "200,000 Credits", dodoProductId: process.env.DODO_PRODUCT_PERM_200K },
  { id: "perm_500k", credits: 500_000, priceUSD: 119, label: "500,000 Credits", popular: true, dodoProductId: process.env.DODO_PRODUCT_PERM_500K },
  { id: "perm_1m", credits: 1_000_000, priceUSD: 219, label: "1,000,000 Credits", dodoProductId: process.env.DODO_PRODUCT_PERM_1M },
  { id: "perm_5m", credits: 5_000_000, priceUSD: 859, label: "5,000,000 Credits", dodoProductId: process.env.DODO_PRODUCT_PERM_5M },
  { id: "perm_15m", credits: 15_000_000, priceUSD: 2_499, label: "15,000,000 Credits", dodoProductId: process.env.DODO_PRODUCT_PERM_15M },
]

export function getPackById(id: string): PermanentCreditPack | undefined {
  return PERMANENT_CREDIT_PACKS.find((p) => p.id === id)
}

// ─── Welcome & Referral Credits ──────────────────────────────────────────────

export const WELCOME_BONUS_CREDITS = 500
export const REFERRAL_VERIFICATION_REWARD = 500
export const REFERRAL_MILESTONE_REWARD = 1_500
export const REFERRAL_MILESTONE_THRESHOLD = 75_000

// ─── Fork Pricing ─────────────────────────────────────────────────────────────

export const FORK_PRICING = {
  simple: {
    forkCost: 15_000,       // credits charged to forker
    ownerRoyalty: 5_000,    // credits awarded to project owner
    savingsPct: 45,         // "saves you X% of credits to build"
  },
  medium: {
    forkCost: 45_000,
    ownerRoyalty: 10_000,
    savingsPct: 25,
  },
  complex: {
    forkCost: 50_000,
    ownerRoyalty: 15_000,
    savingsPct: 35,
  },
} as const

export type ForkTier = keyof typeof FORK_PRICING

// ─── Credit Types ────────────────────────────────────────────────────────────

export type CreditType = "subscription" | "permanent"

/**
 * Credit consumption order: subscription credits are consumed first,
 * then permanent credits.
 */
export const CONSUMPTION_ORDER: CreditType[] = ["subscription", "permanent"]

// ─── Build Authorization Statuses ────────────────────────────────────────────

export type BuildAuthorizationStatus =
  | "pending"
  | "authorized"
  | "reserved"
  | "executing"
  | "finalized"
  | "released"
  | "failed"
  | "expired"
  | "cancelled"

// ─── Ledger Transaction Types ────────────────────────────────────────────────

/**
 * Ledger Transaction Types
 *
 * Runtime API types (runtime_usage, runtime_reservation, runtime_refund) are
 * defined additively in runtime/contracts/billing.ts and flow through
 * consumeCredits/grantCredits from Phase 9 (runtime metering); this union
 * stays the app-side source of truth. Downstream consumers should treat
 * transaction types as an open vocabulary (see isRuntimeTransactionType).
 */
export type LedgerTransactionType =
  | "signup_bonus"
  | "referral_bonus"
  | "credit_purchase"
  | "subscription_grant"
  | "subscription_renewal"
  | "build_reservation"
  | "build_finalization"
  | "build_release"
  | "build_refund"
  | "promotional_grant"
  | "admin_adjustment"
  | "subscription_expiration"
  | "refund_reversal"
  | "credit_reconciliation"
  | "other_reversal"
  | "infrastructure_purchase"
  | "fork_purchase"
  | "fork_royalty"
  | "ai_collaboration"
  | "ad_campaign_charge"
  | "ad_campaign_refund"
  | "feedback_reward"
  | RuntimeLedgerTransactionType

// ─── Payment States ──────────────────────────────────────────────────────────

export type PaymentStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "refunded"
  | "partially_refunded"
  | "disputed"

// ─── Subscription States ─────────────────────────────────────────────────────

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "cancelled"
  | "expired"
  | "payment_failed"

// ─── Internal Cost Categories (Admin Only) ───────────────────────────────────

export const ACTUAL_COST_CATEGORIES = [
  "ai_model",
  "ai_tokens",
  "firecrawl",
  "database",
  "storage",
  "compute",
  "hosting",
  "deployment",
  "bandwidth",
  "third_party_apis",
  "dodo_fees",
  "tax_reserve",
  "infrastructure",
] as const

// ─── Customer-Facing Label Helpers ───────────────────────────────────────────

export const CREDIT_UNIT_NAME = "Atai Credits"
export const BILLING_SYSTEM_NAME = "Atai Billing"

/** Format a credit amount for display. */
export function formatCredits(amount: number): string {
  return `${amount.toLocaleString()} ${CREDIT_UNIT_NAME}`
}

/** Format a USD price for display. */
export function formatUSD(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}
