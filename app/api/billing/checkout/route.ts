import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { getDodoConfig } from "@/lib/env"
import {
  commercialProductName,
  commercialProductDescription,
} from "@/lib/billing/entitlements/commercial-plans"
import {
  PublishedCatalogError,
  resolvePublicCommercialCatalog,
} from "@/lib/billing/catalog/published-resolver"
import { logger } from "@/lib/logging/logger"
import {
  getOrCreateSubscriptionProduct,
  getOrCreatePermanentProduct,
} from "@/lib/billing/dodo-service"
import { checkoutSessionLocks, checkoutRateLimiter } from "@/lib/cache/locks"
import { detectCountryFromRequest, resolveBillingCurrency } from "@/lib/billing/currency"
import { checkoutReturnUrl } from "@/lib/billing/checkout-return"
import { resolvePromotionalOffer } from "@/lib/billing/offers"
import { getPromotionalOffers } from "@/lib/billing/runtime-config"

/**
 * Create a Dodo Payments checkout session.
 *
 * Flow:
 * 1. Frontend sends POST with product details
 * 2. Backend auto-provisions Dodo product if needed (or uses cached ID)
 * 3. Backend creates Dodo checkout session via SDK
 * 4. Backend returns checkout_url to frontend
 * 5. Frontend redirects user to Dodo checkout
 * 6. Dodo handles payment → sends webhook → we grant credits
 *
 * Features:
 * - Auto-creates Dodo products if they don't exist in the environment
 * - Rate limits to prevent duplicate product creation
 * - Rate limits to prevent duplicate checkout attempts per user
 * - In-memory caching of created product IDs (5 min TTL)
 *
 * @see https://docs.dodopayments.com/developer-resources/checkout-session
 */

export const runtime = "nodejs"

interface CheckoutRequest {
  /** 'subscription' for plan purchases, 'permanent' for credit pack purchases */
  type: "subscription" | "permanent"
  /** Plan ID (for subscriptions) or pack ID (for permanent credits) */
  productId: string
  /** Billing cycle — commercial subscriptions only. Default monthly. */
  billingCycle?: "monthly" | "annual"
  returnPath?: string
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 },
      )
    }

    const body = (await req.json()) as CheckoutRequest

    if (!body.type || !body.productId) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "type and productId are required" } },
        { status: 400 },
      )
    }

    // ─── Rate limit: prevent duplicate checkout attempts per user+product ───
    // Window is 15s (long enough to cover a Dodo API round-trip) with a limit
    // of 2 so a genuine double-click is absorbed but a second deliberate attempt
    // after the first one fails is still allowed.
    const rateLimitKey = `${body.type}:${body.productId}:${body.billingCycle ?? "monthly"}:${user.id}`
    if (!checkoutRateLimiter.allowed(rateLimitKey)) {
      return NextResponse.json(
        { ok: false, error: { code: "RATE_LIMITED", message: "A checkout is already in progress. Please wait a moment before trying again." } },
        { status: 429 },
      )
    }

    const catalog = await resolvePublicCommercialCatalog()
    // An offer only adds bonus credits; it never changes the catalog price.
    // A failed settings read must not block a checkout.
    const promotionalOffers = await getPromotionalOffers().catch(() => [])

    const { apiKey, environment } = getDodoConfig()

    // Detect the user's country and resolve the preferred billing currency.
    // Dodo's Adaptive Currency feature will display prices in the local currency
    // and unlock local payment methods. Falls back to USD if country is unknown
    // or the currency isn't in Dodo's supported list.
    const countryCode = await detectCountryFromRequest(req)
    const billingCurrency = resolveBillingCurrency(countryCode)

    logger.info("checkout", "Resolved billing currency", {
      userId: user.id,
      countryCode,
      billingCurrency: billingCurrency ?? "USD (base)",
    })

    // Dynamically import dodopayments to avoid SSR issues
    const { default: DodoPayments } = await import("dodopayments")
    const client = new DodoPayments({
      bearerToken: apiKey,
      environment: environment as "test_mode" | "live_mode",
    })

    const returnUrl = checkoutReturnUrl(body.returnPath)

    // Use a lock to deduplicate concurrent checkout requests for the same user+product.
    // acquire() returns null if the lock is already held — we return 429 and the
    // client shows a friendly message. The lock is always released in the finally block.
    const sessionLockKey = `checkout:${body.type}:${body.productId}:${body.billingCycle ?? "monthly"}:${user.id}`
    const releaseSessionLock = checkoutSessionLocks.acquire(sessionLockKey)
    if (releaseSessionLock === null) {
      return NextResponse.json(
        { ok: false, error: { code: "BUSY", message: "A checkout session is already being created. Please wait a moment." } },
        { status: 429 },
      )
    }

    try {
      if (body.type === "subscription") {
        // The commercial five-plan catalog is the only sellable catalog. The
        // legacy plan ids are not purchasable any more — existing
        // subscriptions keep renewing on their original Dodo product, but no
        // new checkout may be created against a legacy plan or price.
        const plan = catalog.plans.find((candidate) => candidate.id === body.productId)
        if (!plan) {
          return NextResponse.json(
            { ok: false, error: { code: "PLAN_UNAVAILABLE", message: "That plan is no longer available. Choose Explorer, Starter, Growth or Scale." } },
            { status: 400 },
          )
        }

        const cycle: "monthly" | "annual" = body.billingCycle === "annual" ? "annual" : "monthly"

        // A custom plan is priced by contract, so it has no checkout price at
        // all — it must be refused before the free-plan check, because a custom
        // plan carries a price of 0 (no public price) and would otherwise be
        // mistaken for a free plan.
        if (plan.custom) {
          return NextResponse.json(
            { ok: false, error: { code: "PLAN_UNAVAILABLE", message: `${plan.name} is a custom contract. Email support@atai.ink to arrange it.` } },
            { status: 400 },
          )
        }

        const purchaseState = cycle === "annual" ? plan.annualPurchaseState : plan.purchaseState
        if (purchaseState && purchaseState !== "available") {
          return NextResponse.json(
            { ok: false, error: { code: "PLAN_UNAVAILABLE", message: `${plan.name} is not available for checkout yet.` } },
            { status: 400 },
          )
        }

        if (plan.priceUSD === 0) {
          return NextResponse.json(
            { ok: false, error: { code: "INVALID_REQUEST", message: `${plan.name} is free and is applied to every account — there is nothing to purchase.` } },
            { status: 400 },
          )
        }

        if (cycle === "annual" && !plan.annualPriceUSD) {
          return NextResponse.json(
            { ok: false, error: { code: "CYCLE_UNAVAILABLE", message: "Annual billing is not available for this plan." } },
            { status: 400 },
          )
        }

        const chargeUSD = cycle === "annual" ? (plan.annualPriceUSD as number) : plan.priceUSD
        const offer = resolvePromotionalOffer(promotionalOffers, "subscription", plan.id)

        // A pre-provisioned product id is used as-is. Without one, the product
        // is created on demand at the catalog price — never at a legacy price.
        const productId = cycle === "annual" ? plan.annualDodoProductId : plan.dodoProductId
        const product = await getOrCreateSubscriptionProduct(
          plan.id,
          commercialProductName(plan, cycle),
          commercialProductDescription(plan, cycle),
          chargeUSD,
          plan.mirrorCredits,
          productId,
          cycle,
        )

        logger.info("checkout", "Creating subscription checkout session", {
          userId: user.id,
          planId: plan.id,
          billingCycle: cycle,
          productId: product.productId,
          autoCreated: !productId,
        })

        const session = await client.checkoutSessions.create({
          product_cart: [{ product_id: product.productId, quantity: 1 }],
          return_url: returnUrl,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(billingCurrency ? { billing_currency: billingCurrency as any } : {}),
          metadata: {
            userId: user.id,
            type: "subscription",
            planId: plan.id,
            credits: String(plan.mirrorCredits),
            billingCycle: cycle,
            ...(offer
              ? { offerId: offer.id, offerBonusCredits: String(offer.bonusCredits) }
              : {}),
          },
        })

        return NextResponse.json({
          ok: true,
          data: { checkoutUrl: session.checkout_url, sessionId: session.session_id },
        })
      }

      if (body.type === "permanent") {
        const pack = catalog.packs.find((p) => p.id === body.productId)
        if (!pack) {
          return NextResponse.json(
            { ok: false, error: { code: "INVALID_REQUEST", message: "Unknown credit pack ID" } },
            { status: 400 },
          )
        }
        if (pack.saleMode && pack.saleMode !== "self_serve") {
          return NextResponse.json(
            { ok: false, error: { code: "PLAN_UNAVAILABLE", message: "That credit pack is not available for self-serve checkout." } },
            { status: 400 },
          )
        }

        const offer = resolvePromotionalOffer(promotionalOffers, "credit_pack", pack.id)
        const bonusCredits = offer?.bonusCredits ?? 0

        // Auto-provision the product if not configured
        const product = await getOrCreatePermanentProduct(
          pack.id,
          `Atai — ${pack.label}`,
          `${pack.credits.toLocaleString()} permanent Atai Credits. Never expire.`,
          pack.priceUSD,
          pack.credits,
          pack.dodoProductId,
        )

        logger.info("checkout", "Creating permanent credit checkout session", {
          userId: user.id,
          packId: pack.id,
          productId: product.productId,
          autoCreated: !pack.dodoProductId,
          offerId: offer?.id,
          bonusCredits,
        })

        const session = await client.checkoutSessions.create({
          product_cart: [{ product_id: product.productId, quantity: 1 }],
          return_url: returnUrl,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(billingCurrency ? { billing_currency: billingCurrency as any } : {}),
          metadata: {
            userId: user.id,
            type: "permanent",
            packageId: pack.id,
            baseCredits: String(pack.credits),
            credits: String(pack.credits + bonusCredits),
            ...(offer
              ? { offerId: offer.id, offerBonusCredits: String(offer.bonusCredits) }
              : {}),
          },
        })

        return NextResponse.json({
          ok: true,
          data: { checkoutUrl: session.checkout_url, sessionId: session.session_id },
        })
      }

      return NextResponse.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "Invalid checkout type" } },
        { status: 400 },
      )
    } finally {
      releaseSessionLock?.()
    }
  } catch (error) {
    if (error instanceof PublishedCatalogError) {
      logger.error("checkout", "Catalog unavailable for checkout", {
        reason: error.reason,
      })
      return NextResponse.json(
        { ok: false, error: { code: "CATALOG_UNAVAILABLE", message: error.message } },
        { status: 503 },
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    const isConfig = message.includes("not configured") || message.includes("PAYMENT_UNAVAILABLE")
    logger.error("checkout", "Failed to create checkout session", {
      error: message,
      isConfigError: isConfig,
    })
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: isConfig ? "PAYMENT_UNAVAILABLE" : "INTERNAL_ERROR",
          message: isConfig
            ? "Payment processing is not available right now. Please try again later."
            : "Failed to create checkout session. Please try again.",
        },
      },
      { status: isConfig ? 503 : 500 },
    )
  }
}
