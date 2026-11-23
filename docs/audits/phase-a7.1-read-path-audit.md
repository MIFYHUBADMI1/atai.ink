# Phase A7.1 — published catalog read-path audit

Status: audit completed before implementation. A7.1 is a read-path phase only.
Checkout, Dodo product creation, webhooks, subscription activation, credit
grants and existing purchased terms are out of scope. Implementation outcome:
`docs/history/phase-a7.1-published-catalog-read-path.md`.

## A7.0 foundation reviewed

- `lib/billing/catalog/types.ts` defines product, immutable version, Dodo
  mapping and catalog-publication documents.
- `lib/billing/catalog/code-catalog.ts` builds the deterministic code snapshot,
  version checksums and publication checksums.
- `lib/billing/catalog/seed.ts` seeds with `$setOnInsert`, verifies exact
  equality and reads existing subscription/payment Dodo ids only for
  reconciliation.
- `lib/billing/catalog/service.ts` is the A7.0 admin read model.
- `lib/billing/catalog/source.ts` defaults `CATALOG_SOURCE` to `code`.
- The A7.0 publication is `seeded`, not `active`. There is no active publication
  in production yet; A7.2 owns explicit activation.

## Customer read-path findings

| Surface | Current source | Finding |
| --- | --- | --- |
| `/pricing` (`app/pricing/page.tsx`) | `getCommercialPlans()` at module scope; `PERMANENT_CREDIT_PACKS` | Plans and top-up packs are hardcoded. Plan JSON-LD is also built from the module-scope list. |
| `/api/billing/overview` | `getCommercialPlans()` | Returns hardcoded plans to Settings → Billing. It does not return packs, so the client imports them directly. |
| `/api/billing/upgrade-options` | `getCommercialPlans()`; `PERMANENT_CREDIT_PACKS` | Credit-gate recommendations are hardcoded. |
| `/settings/billing` | `/api/billing/overview`, then `getCommercialPlans()` fallback; `PERMANENT_CREDIT_PACKS` | The client can silently render the code catalog when the API fails. Packs bypass the server entirely. |
| Onboarding plan step (`components/onboarding/plan-step.tsx`) | `getCommercialPlans()` at module scope | A fifth customer surface reads the code catalog directly. It must use the same publication as the four required surfaces. |
| `PlanCard` | `getCommercialPlans()` fallback when `allPlans` is absent | Duplicate catalog resolution in a client component. |
| `CancelSubscriptionButton` | `getCommercialPlans()` | Cancellation guidance resolves its own plan list instead of the server catalog. |
| Checkout (`app/api/billing/checkout/route.ts`) | `getCommercialPlanById()`; `PERMANENT_CREDIT_PACKS` | Intentionally unchanged in A7.1. This is why DB public reads must be gated and checkout-compatible. |
| Admin billing configuration / Dodo products | Code constants | Admin-only read models; not customer-facing and outside A7.1. |
| `lib/billing/packages.ts` | Deprecated alias of `PERMANENT_CREDIT_PACKS` | No customer runtime use found. |

## Code-catalog dependencies

- `PLAN_PRICING`, `PROVISIONAL_MONTHLY_CREDITS`, `PLAN_BASE` live in
  `lib/billing/entitlements/catalog.ts`.
- `getCommercialPlans()` in `lib/billing/entitlements/commercial-plans.ts`
  assembles the customer-facing five-plan view from those constants.
- `PERMANENT_CREDIT_PACKS` lives in `lib/billing/config.ts`.
- `INFRASTRUCTURE_PLANS` lives in `lib/infrastructure/plans.ts`.
- `COMMERCIAL_PRICE_BOOK_MINOR` and `LEGACY_PRICE_BOOK_MINOR` live in
  `lib/billing/entitlements/price-book.ts`.

## Proposed A7.1 changes

1. Add `lib/billing/catalog/published-resolver.ts` with one typed result:
   `plans`, `packs`, `infrastructure`, publication and entries.
2. Require an `active` publication; reject multiple active publications,
   invalid publication/version checksums, duplicate membership, missing
   products/versions and mismatched product/version relationships.
3. Exclude draft, archived, future-effective and unpublished products.
4. Keep legacy renewal-only products out of sellable lists and expose a
   separate historical resolver.
5. Add `CATALOG_DB_PUBLIC_READS=enabled` as the explicit public rollout gate.
   Default is off. With the gate off, public surfaces use the code catalog
   deliberately; with the gate on, DB failure is typed and fails closed.
6. Add a checkout-compatibility guard for public DB reads: every DB product
   advertised must exist in the code checkout catalog with the same price and
   credit grant. A DB-only product or a changed price is refused, never shown.
7. Add shadow comparison against the code catalog. Differences are logged and
   returned in the resolver result; customer output is not altered.
8. Route `/pricing`, `/api/billing/overview`, `/api/billing/upgrade-options`
   and `/settings/billing` through the resolver. Also route the onboarding plan
   step, `PlanCard` and `CancelSubscriptionButton` through server-supplied plan
   data so no customer surface keeps a second catalog implementation.
9. Add `CATALOG_UNAVAILABLE` as the safe external error code for a selected but
   invalid/unavailable DB catalog.

## Non-goals

- No admin create/edit/publish/archive/preview.
- No checkout or webhook change.
- No subscription, payment, ledger or purchased-terms change.
- No automatic activation of the A7.0 `seeded` publication.
