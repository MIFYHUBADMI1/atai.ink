# Phase A7.3 — catalog publication preview

Status: implemented. A7.3 adds an admin-only, read-only preview of a candidate
catalog publication against the active publication. It does not activate the
candidate, change customer reads, or touch checkout, webhooks, Dodo products,
subscriptions, payments or the credit ledger.

## What the preview shows

`previewCatalogPublication` (`lib/billing/catalog/publication-preview.ts`):

- selects the latest candidate, or a named candidate version;
- validates the candidate with the exact validator and projection used by the
  customer read path (`resolvePublicationCatalog`);
- checks the candidate against the code checkout catalog
  (`assertCheckoutCompatible`);
- reports product-level differences against the active publication:
  added, removed, and changed fields (name, description, tagline, sale mode,
  currency, prices, intervals, credits, entitlement, infrastructure, Dodo);
- reports validation errors and operational warnings, including no active
  publication, multiple active publications, future-effective versions, and an
  active publication that no longer resolves cleanly;
- returns `ready` only when validation passes and checkout compatibility holds.

The preview is deliberately non-mutating. It never writes a publication,
product, version or Dodo mapping.

## Read-path reuse

`resolvePublicationCatalog` was extracted from the A7.1 resolver so preview,
activation and customer reads share one implementation. The extraction did not
change A7.1 behavior; the resolver suite still passes.

The code catalog is now environment-aware:

- `getCommercialPlans(env)` and `getCommercialPlanById(id, env)` read Dodo ids
  from the supplied environment.
- `getPermanentCreditPacks(env)` does the same for permanent credit packs.
- `compareCatalogToCode` and `assertCheckoutCompatible` accept the same
  environment, so preview/activation tests can compare a database snapshot to
  the code catalog without mutating `process.env`.

Checkout compatibility now also guards Dodo product-id drift. A database
product cannot silently point at a different Dodo product than the code
checkout uses; activation would otherwise break webhook attribution.

## API

`GET /api/admin/billing/catalog/publications/preview?version=...`

- admin-only (`requireAdmin`);
- returns `{ preview }` in the standard `ok()` envelope;
- `404` for a named candidate that does not exist;
- read-only.

## Admin UI

`components/admin/catalog-publications.tsx` renders the preview under the
catalog manager:

- candidate and active publication summaries;
- ready/blocked and checkout-compatible badges;
- validation errors, warnings and field-level differences;
- manual refresh.

## Tests added

- `lib/billing/catalog/publication-preview.test.ts` — 4 tests:
  - checkout-compatible candidate and field diff;
  - price drift blocks activation readiness;
  - tampered publication checksum is an error;
  - no candidate returns a non-ready preview.
- `app/api/admin/billing/catalog/publication-routes.test.ts` — 3 tests:
  - non-admin refusal before reading;
  - preview response and named candidate forwarding;
  - `404` for an unknown named candidate.
- A7.1 resolver suite remains green after the extraction and Dodo-id guard.

## Verification

- `npx tsc --noEmit` — passed.
- `npx vitest run` — 341 files, 4,013 tests passed, 2 todo.
- `npx eslint` on touched files — 0 errors.
- `npm run build` — passed.

## Deferred

- Explicit activation and supersede (A7.4).
- Customer checkout/webhook/entitlement reads from the active publication
  (A7.5).
- Dodo mapping authoring and validation.
