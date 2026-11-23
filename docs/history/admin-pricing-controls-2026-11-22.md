# Admin pricing controls and checkout offers

Date: 2026-11-22
Status: implemented, awaiting user acceptance

## Why

Billing numbers are no longer hardcoded on customer surfaces, but the admin
side had three gaps:

1. The welcome/referral reward editor existed as a component but was never
   rendered.
2. Visual-generation pricing (markup, charging rate, fallback and estimate)
   was still code-only.
3. There was no way to create a promotional offer, and no obvious route from
   the billing hub to catalog, runtime, advertising or reconciliation controls.

## What changed

### Pricing control centre

`/admin/billing/configuration` now has:

- a rendered `RewardsCard` for the welcome bonus and referral rewards;
- a `VisualPricingCard` for markup, credits-per-dollar, no-cost fallback,
  UI estimate and default-model credits;
- a related-controls grid linking to Catalog authoring, Offers & campaigns,
  Runtime API pricing, Advertising packages, Dodo products and Reconciliation;
- an anchor rail for every editable section.

`/admin/billing` gains the same links, including Offers & campaigns and
Advertising packages. The admin sidebar adds `Offers & campaigns` under Money
and `Ad packages` under Operate.

### Checkout offers

New `/admin/billing/offers` page and `GET|POST|DELETE
/api/admin/billing/offers`.

An offer has a name, description, status, target (plans, packs or both),
optional product ids, bonus credits and an optional start/end window. Only
`active` offers inside their window are live. If several match, the highest
bonus wins; ties go to the most recently edited offer.

Checkout stamps the quoted offer on the Dodo metadata. The webhook grants what
was quoted, not what the offer says today:

- credit packs: bonus is added to the permanent `credits` grant;
- plans: bonus is added to the first subscription grant, so it follows that
  grant's expiry and is reversed with it on refund.

Public pricing shows live offers with their bonus and end date. The public
config includes `offers` and `visualPricing`.

### Visual pricing

`getVisualPricing()` is now part of runtime billing settings. The
generate-visual route uses it for the upfront balance check and the final
charge. The collaboration estimate reads the public config.

## Files

- `lib/billing/offers.ts`, `lib/billing/offers.test.ts`
- `lib/billing/runtime-config.ts`
- `lib/billing/public-config.ts`, `lib/billing/public-config-types.ts`
- `lib/billing/visual-pricing.ts`
- `app/api/billing/checkout/route.ts`
- `lib/billing/activate-subscription.ts`
- `app/api/admin/billing/offers/route.ts` (+ test)
- `app/admin/billing/offers/page.tsx`
- `app/admin/billing/configuration/page.tsx`
- `app/admin/billing/page.tsx`
- `components/admin/admin-nav-config.ts`
- `app/pricing/page.tsx`
- `components/collaborate/expected-visuals.tsx`
- `app/api/projects/[id]/generate-visual/route.ts`

## Verification

- `npx tsc --noEmit` — clean
- `npx vitest run` — 375 files passed, 1 skipped; 4,349 tests passed
- `npm run lint` — 0 errors, 369 warnings (pre-existing debt; two fewer than
  before this change)
- `npm run build` — production build succeeded

## Acceptance

Pending. The user asked for the admin UI, navigation and offer creation after
accepting the public billing-config centralization.
