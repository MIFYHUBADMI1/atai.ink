# Phase A7.2 — commercial catalog authoring, immutable versioning, publishing and archiving

Status: implemented. A7.2 adds database catalog authoring without changing
customer checkout, webhooks, credit grants or Dodo products. Customer reads
remain on the code catalog unless the A7.1 rollout gates are explicitly
enabled, and A7.2 never creates an active database publication.

## Scope

A7.2 makes the A7.0/A7.1 catalog manageable by administrators:

- create subscription, credit-pack and infrastructure products;
- create and edit draft versions;
- publish a validated draft;
- archive a product identity;
- inspect version history and immutable publication snapshots.

Out of scope: preview, DB customer reads, checkout migration, webhook changes,
Dodo product creation/validation, entitlement resolution from the database,
and any write to subscriptions, payments, purchased terms or the credit ledger.

## Invariants

- Published product versions are never edited in place.
- Editing a published product creates a new draft version.
- Draft editing creates a replacement draft and archives the superseded draft.
- Product ids and slugs are stable and cannot be reused after archive.
- Publishing is a separate operation from saving.
- Every route calls `requireAdmin()`.
- Every successful mutation writes an audit record through `logAuditAction()`.
- Archiving changes only the product identity; versions and Dodo mappings stay.
- No existing customer, payment, subscription or ledger record is touched.
- `CATALOG_SOURCE` and `CATALOG_DB_PUBLIC_READS` keep their A7.1 behavior.
- Publishing writes a `candidate` publication snapshot, never an `active` one.

## Schema changes

`lib/billing/catalog/types.ts`:

- Added `candidate` to `CatalogPublicationStatus`. A7.2 uses it for immutable
  authoring snapshots; the A7.1 resolver only resolves `active`.
- Added optional `archivedBy` and `archivedAt` to product identities.
- Added `CatalogVersionSummary` and extended `CatalogProductView` with:
  - `draftVersion`
  - `createdAt`, `updatedAt`, `archivedAt`, `archivedBy`
  - version copy, sale mode, change summary and checksum on summaries.

Existing A7.0 documents remain valid; the new fields are optional.

## Authoring service

New files:

- `lib/billing/catalog/authoring-schemas.ts`
  - Zod validation for product type, slug, name, description, sale mode,
    currency, prices, billing intervals, credit terms, entitlement templates
    and infrastructure terms.
  - Type-specific validation:
    - subscriptions require subscription credits and monthly billing unless
      contact-only;
    - credit packs require permanent credits, a positive one-time grant and a
      positive price;
    - infrastructure requires explicit fiat price, infrastructure terms and a
      credit charge when credit-funded.
  - Partial version payloads merge one level into credits/infrastructure.
- `lib/billing/catalog/authoring-store.ts`
  - `CatalogAuthoringStore` interface and Mongo implementation.
  - Product + initial version creation is transactional.
  - Draft replacement, publication and archive use conditional updates on
    `updatedAt` and Mongo transactions.
  - Duplicate ids, slugs, version numbers and publication versions are refused
    by unique indexes and reported as conflicts.
- `lib/billing/catalog/authoring.ts`
  - Product creation, version creation, draft replacement, publish and archive.
  - Per-product version numbering.
  - Deterministic `versionChecksum()` for every draft/published version.
  - Immutable publication snapshots with `catalogPublicationChecksum()`.
  - Audit actions:
    - `catalog.product.create`
    - `catalog.version.create`
    - `catalog.version.update`
    - `catalog.product.publish`
    - `catalog.product.archive`

### Lifecycle

1. Create product → product `draft`, version 1 `draft`, no current version.
2. Edit draft → new draft version; previous draft becomes `archived`.
3. Publish draft → version `published`; product `published`; current version
   moves to the new version; candidate publication snapshot is written.
4. Edit published product → new draft; published version is unchanged.
5. Archive product → product `archived`; versions and Dodo mappings remain.

## API routes

- `POST /api/admin/billing/catalog/products`
- `PATCH /api/admin/billing/catalog/[productId]`
- `POST /api/admin/billing/catalog/[productId]/versions`
- `POST /api/admin/billing/catalog/[productId]/publish`
- `POST /api/admin/billing/catalog/[productId]/archive`

All routes are dynamic, require `requireAdmin()`, validate JSON with Zod and
return the repository's standard `ok`/`fail` envelope. Optimistic concurrency
uses `expectedUpdatedAt`; stale requests return `CATALOG_CONFLICT` (409).

## Admin UI

`app/admin/billing/catalog/page.tsx` now renders the authoring manager in
`components/admin/catalog-manager.tsx`:

- status filters for all, draft, published and archived products;
- create-product form;
- product detail panel with current version, draft version and Dodo state;
- draft editing form that creates a replacement draft;
- version history with status, change summary and checksum;
- explicit publish and archive actions;
- read-only Dodo mapping display.

The UI never edits Dodo products or prices and contains no customer preview.

## Tests

Added:

- `lib/billing/catalog/authoring.test.ts` — 19 tests:
  - creation for all three product types;
  - duplicate identity/slug rejection;
  - invalid configuration rejection;
  - draft creation and replacement;
  - published-version immutability;
  - optimistic concurrency;
  - publication validation, checksum tamper rejection and snapshot checksum;
  - single-draft enforcement;
  - archive behavior;
  - historical version preservation;
  - per-product version numbering;
  - preservation of unexposed infrastructure resources;
  - audit records;
  - not-found and schema-error handling.
- `app/api/admin/billing/catalog/authoring-routes.test.ts` — 13 tests:
  - unauthorized access for every mutation route;
  - admin actor propagation;
  - success status codes;
  - validation and conflict responses.
- `lib/billing/catalog/published-resolver.test.ts` — added a regression test
  proving a `candidate` publication is not treated as active.

## Verification

- `npx tsc --noEmit` — passed.
- `npx vitest run` — 339 test files, 4,006 tests passed, 2 todo.
- `npm run lint` — 0 errors, 376 pre-existing warnings.
- `npm run build` — passed.

## Scope confirmation

A7.2 does not modify checkout, webhook processing, credit grants, Dodo product
creation or pricing, subscription records, payment records, purchased terms or
credit-ledger entries. Customer reads remain on the code catalog, and no
database publication is activated.

## Unresolved risks

- Candidate publication snapshots are intentionally not active. A7.4/A7.5 must
  activate a publication and satisfy the A7.1 checkout-compatibility guard.
- Mongo transactions require the deployment's existing transaction-capable
  connection; the repository already asserts transaction support at connect.
- Optimistic concurrency uses the product's monotonic `updatedAt`; clients must
  send the value they loaded.
- A7.2 has no unarchive action. Archived identities are intentionally not
  reusable.
- Entitlement-template authoring is limited to validation and preservation.
  New products may carry no entitlement template until the entitlement phase.
- Dodo mapping authoring/validation remains outside A7.2.
