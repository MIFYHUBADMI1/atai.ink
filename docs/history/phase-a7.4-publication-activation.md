# Phase A7.4 — explicit catalog publication activation

Status: implemented. A7.4 lets an administrator explicitly activate one
candidate publication. Activation supersedes the previous active publication in
one transaction and records the actor and time. It does **not** enable customer
database reads; `CATALOG_SOURCE` and `CATALOG_DB_PUBLIC_READS` still decide that.

## Activation rules

`activateCatalogPublication` (`lib/billing/catalog/activation.ts`):

- requires the exact candidate checksum the admin previewed;
- rejects anything that is not a candidate publication;
- rejects versions whose `effectiveAt` is in the future;
- validates the candidate with the same resolver used by customer reads;
- requires checkout compatibility with the code catalog, including prices,
  credits, Dodo product ids and sale-mode state;
- supersedes every active publication and activates the candidate in one Mongo
  transaction;
- writes an audit record `catalog.publication.activate` with the previous
  active version(s), the new version, product count and checksum.

The transaction means a failed candidate update rolls back the supersede. A
concurrent activation wins or loses atomically; the loser receives a
`CATALOG_CONFLICT`.

## Publication fields

`CommercialCatalogVersionDoc` now carries optional lifecycle evidence:

- `activatedBy` / `activatedAt` on the candidate that became active;
- `supersededBy` / `supersededAt` on the publication it replaced.

Existing A7.0–A7.3 documents remain valid.

## API

`POST /api/admin/billing/catalog/publications/[version]/activate`

Body:

```json
{ "expectedChecksum": "<candidate checksum>" }
```

- admin-only;
- `200` with `{ publicationVersion, status: "active", activatedAt, superseded }`;
- `404` for an unknown publication;
- `409` for a stale checksum, non-candidate, or concurrent activation;
- `422` when the candidate fails validation or checkout compatibility.

## Admin UI

The publication preview now has a two-step activation control:

- “Activate candidate” opens an inline confirmation;
- “Confirm activation” posts the previewed checksum;
- success shows the activated version and superseded versions;
- the preview refreshes and the candidate disappears.

The UI copy explicitly says customer reads remain on the code catalog until the
database read gates are enabled.

## Tests added

- `lib/billing/catalog/activation.test.ts` — 6 tests:
  - successful activation and supersede;
  - stale checksum refusal without mutation;
  - non-candidate refusal;
  - checkout-price incompatibility refusal;
  - future-effective version refusal;
  - unknown publication `404`.
- `app/api/admin/billing/catalog/publication-routes.test.ts` — 3 activation
  route tests added (non-admin, successful call, conflict), alongside the A7.3
  preview tests.

## Verification

- `npx tsc --noEmit` — passed.
- `npx vitest run` — 342 files, 4,022 tests passed, 2 todo.
- `npx eslint` on touched files — 0 errors.
- `npm run build` — passed; activation route present.

## Deferred

- Customer checkout/webhook/entitlement reads from the active publication
  (A7.5).
- Dodo mapping authoring and validation.
- Activation does not change the code-catalog default.
