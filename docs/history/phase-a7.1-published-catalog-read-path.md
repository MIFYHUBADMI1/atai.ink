# Phase A7.1 — published catalog read path

Status: implemented. Checkout, Dodo product creation, webhooks, subscription
activation, credit grants and purchased terms are unchanged.

## What changed

A single read resolver now sits in `lib/billing/catalog/published-resolver.ts`.
It returns one typed result with:

- `plans` (`SubscriptionPlan[]`)
- `packs` (`PermanentCreditPack[]`)
- `infrastructure` (published infrastructure terms)
- `entries` (the exact product/version rows used)
- the active publication record
- source, gate state and shadow-comparison differences

The four required customer surfaces now use `resolvePublicCommercialCatalog()`:

1. `/pricing` (`app/pricing/page.tsx`)
2. `/api/billing/overview`
3. `/api/billing/upgrade-options`
4. `/settings/billing` (via the overview response; no local catalog fallback)

The onboarding plan step, `PlanCard` and `CancelSubscriptionButton` were also
moved onto server-supplied plan data. They were the remaining customer read
paths that still imported the code catalog directly.

## Publication validation

The database path requires exactly one `active` publication. It rejects:

- no active publication
- multiple active publications
- a publication whose `publishedAt` is in the future
- publication checksum mismatch
- empty or duplicate publication membership
- missing product versions
- versions that are not `published`
- version checksum mismatch
- missing products
- products that are not `published`
- a product whose `currentVersionId` does not match the published version
- duplicate products in one publication
- a legacy renewal-only product in the active publication
- no currently effective products

Future-effective versions are excluded from the current offerings. Archived
legacy products are never returned as current offerings; they remain available
through `resolveHistoricalCatalogEntry()` for purchased-terms lookup.

## Rollout safety

`CATALOG_SOURCE=db` alone is not enough for customer traffic. Public reads also
require:

```dotenv
CATALOG_DB_PUBLIC_READS=enabled
```

With the gate off, public surfaces deliberately use the code catalog and the
resolver result reports `gated: true` and `requestedSource: "db"`. With the gate
on, database failure is a typed `PublishedCatalogError` (`DB_UNAVAILABLE`,
`CATALOG_UNAVAILABLE` externally) and there is no code fallback.

The A7.0 seed publication is `seeded`, not `active`. Until A7.2 publishes an
active catalog, enabling the public gate will correctly fail closed rather than
serve an unpublished snapshot.

## Checkout compatibility guard

Checkout still reads `getCommercialPlanById()` and `PERMANENT_CREDIT_PACKS`.
Public database reads therefore compare every advertised product with the code
checkout catalog before returning it:

- every code plan, pack and infrastructure item is present
- plan id must exist in checkout
- monthly and annual price must match in minor units
- monthly credit grant must match
- custom/contact status, purchase state and annual purchase state must match
- pack id, price and credits must match
- infrastructure credit charge, purchase model, duration and renewal must match

A database-only product or a changed price is refused with
`CHECKOUT_INCOMPATIBLE`; it is never displayed and then charged differently.

## Shadow comparison

`compareCatalogToCode()` reports commercial differences between the database
view and the code view. The resolver logs a warning with the publication version
and the first differences, and exposes them on `resolved.shadow`. The customer
output is the resolved database output; shadow comparison never rewrites it.

## Operational errors

`PublishedCatalogError` extends `AppError` with a server-only `reason` and
`detail`. The browser receives `CATALOG_UNAVAILABLE` and the safe message
"Pricing is temporarily unavailable. Please try again shortly." The operational
log records the reason and publication identifiers.

## Tests added

- `lib/billing/catalog/published-resolver.test.ts` — 23 tests covering active
  publication selection, gate behavior, checksums, membership, draft/archived
  and legacy products, future versions, product/version mismatch, missing
  versions, DB failure, shadow differences, checkout incompatibility, hidden
  plans, DB-only products and historical legacy lookup.
- `app/api/billing/overview/route.test.ts`
- `app/api/billing/upgrade-options/route.test.ts`
- `app/pricing/page.test.tsx`
- `app/settings/billing/page.test.tsx`
- `components/onboarding/plan-step.test.tsx`

## Verification

- `npx tsc --noEmit` — passed.
- `npx vitest run` — 337 files, 3,973 tests passed, 2 todo.
- `npm run lint` — 0 errors, 376 pre-existing warnings.
- `npm run build` — passed; `/pricing` remains dynamic.

## Deferred

- Admin create/edit/publish/archive/preview.
- A7.2 active publication and the operational production seed/verification.
- Checkout and webhook reads of the database catalog.
- A6/M-22 sign-off remains separate.
