/**
 * Provision Dodo products for the commercial plan catalog.
 *
 *   npx tsx --env-file=.env.local scripts/provision-commercial-dodo-products.ts          # plan only (no writes)
 *   npx tsx --env-file=.env.local scripts/provision-commercial-dodo-products.ts --apply   # create products
 *
 * It creates/finds a product per paid commercial plan (Starter / Growth / Scale)
 * using the environment's `DODO_PAYMENTS_ENVIRONMENT` (test_mode or live_mode),
 * then prints the `DODO_COMMERCIAL_PRODUCT_*` env lines to add to your
 * environment and Vercel project.
 *
 * The display name includes the price so it never collides with a legacy Dodo
 * product of the same plan name — and checkout uses the explicit product id from
 * the env var, so the name is cosmetic.
 *
 * NOTE: provisioning against test_mode is safe and reversible; live_mode creates
 * real, purchasable products. Only run --apply in live_mode once the Phase 4
 * credit numbers are ratified (hard rule #1).
 */
import {
  getCommercialPlans,
  commercialProductName,
  commercialProductDescription,
} from "@/lib/billing/entitlements/commercial-plans"
import { getOrCreateSubscriptionProduct } from "@/lib/billing/dodo-service"

async function main() {
  const apply = process.argv.includes("--apply")
  const paid = getCommercialPlans().filter((p) => p.priceUSD > 0 && !p.custom)

  if (paid.length === 0) {
    console.log("No paid commercial plans to provision.")
    return
  }

  console.log(`Environment: ${process.env.DODO_PAYMENTS_ENVIRONMENT ?? "(unset)"}`)
  console.log("")

  if (!apply) {
    for (const p of paid) {
      console.log(
        `would create: ${p.name} — $${p.priceUSD}/mo, ${p.mirrorCredits.toLocaleString()} credits  -> DODO_COMMERCIAL_PRODUCT_${p.id.toUpperCase()}`,
      )
      if (p.annualPriceUSD) {
        console.log(
          `would create: ${p.name} — $${p.annualPriceUSD}/yr, ${p.mirrorCredits.toLocaleString()} credits/mo -> DODO_COMMERCIAL_PRODUCT_${p.id.toUpperCase()}_ANNUAL`,
        )
      }
    }
    console.log("\nPlan only (no writes). Re-run with --apply to create the products.")
    return
  }

  const lines: string[] = []
  for (const p of paid) {
    // Same name/description helpers the checkout route uses, so a product
    // created here and one created on demand are always the same product.
    const info = await getOrCreateSubscriptionProduct(
      p.id,
      commercialProductName(p, "monthly"),
      commercialProductDescription(p, "monthly"),
      p.priceUSD,
      p.mirrorCredits,
      p.dodoProductId,
      "monthly",
    )
    lines.push(`DODO_COMMERCIAL_PRODUCT_${p.id.toUpperCase()}=${info.productId}`)
    console.log(`created/found ${p.name} (monthly): ${info.productId}`)

    if (p.annualPriceUSD) {
      const annual = await getOrCreateSubscriptionProduct(
        p.id,
        commercialProductName(p, "annual"),
        commercialProductDescription(p, "annual"),
        p.annualPriceUSD,
        p.mirrorCredits,
        p.annualDodoProductId,
        "annual",
      )
      lines.push(`DODO_COMMERCIAL_PRODUCT_${p.id.toUpperCase()}_ANNUAL=${annual.productId}`)
      console.log(`created/found ${p.name} (annual): ${annual.productId}`)
    }
  }

  console.log("\nAdd these to your environment (and Vercel project settings):")
  for (const line of lines) console.log(line)
}

main().catch((e) => {
  console.error("PROVISIONING FAILED:", e)
  process.exit(1)
})
