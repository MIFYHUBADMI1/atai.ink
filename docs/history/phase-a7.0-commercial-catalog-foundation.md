# Phase A7.0 — Commercial catalog foundation

Status: implemented, pending acceptance. A7.0 is deliberately a data foundation,
not a pricing-management UI and not a checkout cutover.

## Decision

The commercial catalog becomes database-backed before any authoring UI is
built. A7.0 creates the catalog documents, constraints and a deterministic seed
of today's code catalog, then exposes them read-only. `CATALOG_SOURCE` defaults
to `code`; checkout, pricing, webhooks, entitlement resolution and credit
grants continue to read the existing code catalog.

## What was built

- New module `lib/billing/catalog/`:
  - `types.ts` — product, immutable version, Dodo mapping and catalog
    publication documents.
  - `source.ts` — `CATALOG_SOURCE=code|db`, default `code`.
  - `code-catalog.ts` — deterministic snapshot of the current code catalog,
    stable checksums, Dodo environment handling.
  - `seed.ts` — `$setOnInsert` seed, startup bootstrap, exact verification,
    unknown Dodo identifier reporting.
  - `service.ts` — read-only list/detail views.
  - `indexes.ts` — unique and lookup indexes.
- New collections and accessors:
  - `commercial_products`
  - `commercial_product_versions`
  - `dodo_product_mappings`
  - `commercial_catalog_versions`
- Read-only admin surface:
  - `GET /admin/billing/catalog`
  - `GET /api/admin/billing/catalog`
  - `GET /api/admin/billing/catalog/[productId]`
  - Admin navigation entry under Money → Catalog.
- Operator script:
  - `scripts/seed-commercial-catalog.ts` (dry run by default, `--apply`,
    `--verify`).

No POST, PATCH or DELETE catalog endpoints exist. No create, edit, publish,
archive or delete controls exist in the page.

## Data model

Product identity is stable. A commercial change is a new version, never an
in-place edit.

- Product: `id`, `type` (`subscription`, `credit_pack`, `infrastructure`),
  `slug`, `status` (`draft`, `published`, `archived`), `currentVersionId`,
  audit timestamps.
- Version: `productId`, `version`, `status`, `effectiveAt`, `name`,
  `description`, `tagline`, `saleMode`, `currency`, `priceMinor`,
  `annualPriceMinor`, `billingIntervals`, `credits`, `entitlement`,
  `infrastructure`, `dodo`, `createdBy`, `publishedBy`, `changeSummary`,
  `notes`, `checksum`.
- Credits: `creditType` (`subscription`, `permanent`, `promotional`),
  `monthlyGrant`, `oneTimeGrant`, independent `annualTotalCredits`,
  `annualMonths`, `annualIssuance`, `expiresAfterDays`, `bonusCredits`.
- Entitlement template: `templateId`, `version`, frozen `snapshot`.
- Infrastructure: `purchaseModel` (`credit_funded`, `direct_purchase`),
  `durationDays`, `renewal`, storage label/bytes, Totalum credits, credit
  charge, included resources.
- Dodo mapping: ATAI version + cycle + environment → Dodo product id, expected
  name/price/currency/interval, validation status, last sync.
- Catalog publication: immutable version list, price-book version,
  entitlement version, publisher, status, checksum.

## Seed inventory

The seed contains every current sellable product plus archived legacy plans.
With all Dodo environment ids configured it writes 22 products, 22 versions and
16 Dodo mappings.

| Group | Products | State |
| --- | ---: | --- |
| Commercial subscriptions | 5 | Explorer free; Starter/Growth/Scale self-serve; Enterprise contact |
| Legacy subscriptions | 6 | Archived, `legacy_renewal_only` |
| Permanent credit packs | 5 | 200k, 500k, 1M, 5M, 15M |
| Infrastructure products | 6 | Testing free; Basic/Starter/Pro/Business credit-funded; Enterprise contact |
| **Total** | **22** | |

Exact commercial prices and grants seeded:

| Plan | Monthly | Annual | Monthly credits | Annual total |
| --- | ---: | ---: | ---: | ---: |
| Explorer | $0.00 | $0.00 (not billed annually) | 500 | none |
| Starter | $89.99 | $989.89 | 150,000 | 1,800,000 |
| Growth | $199.99 | $2,199.89 | 400,000 | 4,800,000 |
| Scale | $499.99 | $5,499.89 | 1,200,000 | 14,400,000 |
| Enterprise | Custom | Custom | Negotiated | none |

Legacy plans keep their historical monthly prices and mirror credits
(Explorer $12/50k, Starter $79/300k, Business $139/600k, Professional
$219/1.4M, Enterprise $499/5M). They are archived and never offered for new
purchases.

Permanent packs keep their prices and one-time grants. Infrastructure keeps the
current storage, Totalum credit and Atai credit charge for each plan. Enterprise
storage/credits are stored as `null` (custom), not `Infinity`.

## Constraints

- `commercial_products.id` unique.
- `commercial_products.slug` unique.
- `commercial_product_versions.id` unique.
- `(productId, version)` unique.
- `(productVersionId, cycle, environment)` unique.
- `(environment, dodoProductId)` unique.
- `commercial_catalog_versions.version` unique.

The seed uses `$setOnInsert` only. Re-running creates missing rows and leaves
existing product/version rows untouched. A changed code definition is reported
by verification, never silently overwritten.

## Exact comparison and Dodo reconciliation

`verifyCommercialCatalogSeed()` compares the code snapshot with the database:

- products: identity, type, slug, status, current version, creator;
- versions: all commercial fields and checksum, excluding seed-time timestamps;
- mappings: version/cycle/environment identity, Dodo id, expected price,
  currency, interval and status;
- catalog publication: version, status, product-version list, price-book and
  entitlement versions, checksum.

A missing or extra row is a mismatch. The verifier also scans existing
subscription and payment records for Dodo product ids that have no catalog
mapping and reports them with source and count. It never validates with Dodo in
A7.0; imported mappings stay `unvalidated`.

## Behavior preservation

- `CATALOG_SOURCE` defaults to `code`.
- No checkout, webhook, subscription, payment, credit-ledger or entitlement
  code path was changed.
- No Dodo API call, product creation or price update is performed.
- No subscription, payment or ledger write is performed. The only billing reads
  are Dodo product ids used for reconciliation.
- Legacy plans are archived and marked renewal-only.
- The seeded catalog publication is `seeded`, not `active`; nothing is activated
  for customer traffic.

## Verification

- `npx tsc --noEmit` — passed.
- `npx vitest run` — 331 files passed, 3,945 tests passed, 2 todo.
- `npm run lint` — 0 errors (376 pre-existing warnings).
- `npm run build` — passed.

## Rollback

A7.0 has no customer-facing effect, so rollback is a no-op: leave
`CATALOG_SOURCE=code`. The four catalog collections can be left in place; they
are not read by checkout or entitlements. Do not delete the collections while
A7.1 is being developed.

## Known findings for A7.1

- `.env.example` still lists old pack variable names (`DODO_PRODUCT_PERM_50K`,
  `100K`, `300K`, `600K`, `1M`, `5M`) while `lib/billing/config.ts` uses
  `200K`, `500K`, `1M`, `5M`, `15M`. A7.0 imports the real code keys and
  reports any old/unknown Dodo ids for review. The example file was not changed
  in this phase.
- Build tiers (`BUILD_TIERS`) are internal credit costs, not sellable products;
  they were inspected but not seeded as catalog products.
- Legacy free uses `preserveLegacyBehavior` so its archived template does not
  retroactively impose the new Explorer planning-only cap. Existing purchased
  terms remain authoritative.
- A7.1 should introduce the published resolver, draft/version authoring and
  explicit activation. A7.0 does not.
