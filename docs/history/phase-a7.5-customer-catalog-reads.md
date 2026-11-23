# Phase A7.5 — customer checkout, webhook and entitlement reads

Status: implemented. A7.5 moves new-purchase reads from code constants to the
active database publication when both catalog gates are enabled:

```env
CATALOG_SOURCE=db
CATALOG_DB_PUBLIC_READS=enabled
```

With either flag absent, the code catalog remains authoritative. Existing
subscriptions keep their pinned terms and are never re-priced.

## Checkout

`POST /api/billing/checkout` now resolves the public catalog through
`resolvePublicCommercialCatalog()`:

- source `code` (default, or database reads gated) → the existing code plans
  and packs, unchanged;
- source `db` → the active publication, validated with the same resolver and
  checkout-compatibility guard as customer reads;
- an invalid database catalog fails closed with `CATALOG_UNAVAILABLE` (503).
  Checkout never silently charges a different price than the one displayed.

Subscription checkout uses the database plan's display name, price, credits
and provisioned Dodo product ids. Permanent-pack checkout passes the pack's
provisioned Dodo product id to `getOrCreatePermanentProduct`; a product is
created on demand only when the catalog has no id.

## Webhooks

New helper `resolveRuntimeCatalogProduct` (`lib/billing/catalog/runtime.ts`)
maps a Dodo product id (or plan alias) to the active publication's product
version. It is used by:

- `activatePaidSubscription` — new subscriptions pin the database price,
  credit grant and entitlement snapshot;
- `handleSubscriptionRenewed` — a missing record can allocate from the
  database catalog instead of code constants;
- `handleSubscriptionPlanChanged` — a deliberate plan change re-pins from the
  database version.

Pinned terms always win. A transient catalog read failure logs a warning and
falls back to the code catalog, so a payment is never lost because Mongo is
briefly unavailable. The A7.4 activation guard keeps prices, credits and Dodo
product ids aligned with code, so that fallback cannot silently re-price a
purchase.

## Entitlements

`buildCatalogPurchasedTerms` (`lib/billing/subscription-terms.ts`) pins terms
from a database version:

- price and monthly credits from the version;
- entitlement snapshot from `version.entitlement.snapshot` when present;
- entitlement and pricing version references from the version/publication.

If a database subscription version has no entitlement template, the webhook
uses the code plan's entitlement snapshot. A database-only product cannot
reach that state because activation already rejects it. Existing subscribers
continue to read their pinned snapshot, never the live catalog.

## Dodo product ids

- `getOrCreatePermanentProduct` now accepts a provisioned product id, matching
  the existing subscription behavior. It never searches or creates a product
  when the catalog supplies one.
- Checkout compatibility compares monthly/annual/one-time Dodo product ids, so
  a database product cannot point at a different Dodo product than code.

## Admin visibility

The catalog page shows whether checkout is reading the database or code
catalog, based on the same two gates. Activation still does not flip the gates;
an operator does that explicitly after preview.

## Tests added

- `lib/billing/catalog/runtime.test.ts` — 6 tests: monthly/annual/credit-pack
  resolution, plan-alias fallback, gated reads, invalid active publication.
- `app/api/billing/checkout/catalog.test.ts` — 3 tests: database subscription,
  database credit pack with provisioned Dodo id, unavailable plan.
- `lib/billing/activate-subscription.catalog.test.ts` — 2 tests: database price,
  credits and entitlement snapshot are pinned; a credit-pack product is not
  treated as a subscription.

Existing checkout, subscription-activation, webhook and resolver suites remain
green.

## Verification

- `npx tsc --noEmit` — passed.
- `npx vitest run` — 345 files, 4,033 tests passed, 2 todo.
- `npx eslint` on touched files — 0 errors.
- `npm run build` — passed.

## Rollout checklist

1. Seed the catalog and publish a candidate.
2. Preview candidate vs active; resolve every warning.
3. Activate the candidate.
4. In Dodo test mode, verify subscription and credit-pack checkout use the
   expected product ids and prices.
5. Enable `CATALOG_SOURCE=db` and `CATALOG_DB_PUBLIC_READS=enabled` together.
6. Watch checkout `CATALOG_UNAVAILABLE` responses and webhook fallback warnings.
7. Disable `CATALOG_DB_PUBLIC_READS` to return customer reads to code without
   changing any subscription.

## Deferred

- Dodo mapping authoring/validation UI.
- Seeding entitlement/pricing version documents for fully custom database
  versions (purchased terms already embed the snapshot).
- Automatic gate promotion after activation; it remains an operator action.
