# Atai — Phase 3 Pre-Launch Checklist (gate to flip enforcement)

**Purpose:** enumerate every condition that must be true before  
`ENTITLEMENT_ENFORCEMENT_ENABLED=true` is set. Flipping the flag earlier than  
this would risk breaking live billing or advertising capabilities that do not  
exist yet (hard rules #1 and #3).

**Current status:** the Phase 3 *machinery* is built, type-clean, and tested.  
The commercial five-plan catalog is **live and the only offering** (no flag, no
legacy fallback). Enforcement defaults to **ON**; several items below are
genuine product-owner decisions, not code tasks.

---

## 1. Migration on real data (Gate 4)

- [ ] Run `GET /api/admin/billing/entitlements/migrate` (dry-run) against the  
  production (or staging) database.
- [ ] Review `report.details`: confirm every legacy `planId` mapped to the  
  expected commercial plan; confirm `grandfathered` count is sane (legacy  
  free users with assets must be preserved, not silently downgraded).
- [ ] Confirm `report.errors` is empty; resolve any discrepancy before applying.
- [ ] Run `POST /api/admin/billing/entitlements/migrate` with `{ "mode": "apply" }`.
- [ ] Re-run dry-run: `changed` should now be 0 (idempotent).

## 2. Final credit/quota numbers (Phase 4 financial model) — BLOCKER

- [ ] Phase 4 contribution-margin model ratified the real monthly credit  
  allocations. Replace `PROVISIONAL_MONTHLY_CREDITS` in  
  `lib/billing/entitlements/catalog.ts` with ratified values (or confirm the  
  admin override path locks them). Hard rule #1: do **not** ship provisional  
  numbers as final.
- [ ] Hosting/DB/storage quotas, custom-domain inclusions, and infra ceilings  
  (`infraMax`) finalized.

## 3. Pricing page reconciliation — commercial catalog is LIVE

**Status: shipped.** The commercial five-plan catalog is the only catalog that
is displayed or sold. There is no feature flag and no legacy fallback: the
legacy six-plan rows survive only as renewal-attribution plumbing for
pre-existing Dodo subscriptions (ADR-2), and a legacy plan id is refused by
checkout.

**What is built:**

- Commercial display/checkout catalog in  
  `lib/billing/entitlements/commercial-plans.ts`, derived from the entitlement  
  `catalog.ts` (`PLAN_PRICING`, `PROVISIONAL_MONTHLY_CREDITS`, `PLAN_BASE`,  
  `availability`). It renders Explorer / Starter $89.99 / Growth $199.99 /  
  Scale $499.99 / Enterprise (custom) — matching what the entitlement service  
  enforces.
- `PlanCard` (`components/billing/plan-card.tsx`) honours `availability`  
  (defensively filters unlaunched Scale features — Agent Start/Scout/Optimize,  
  marketing automation, knowledge base — hard rule #3), `purchaseState`,  
  `provisionalCredits` (visible "provisional" note — hard rule #1), and annual  
  pricing.
- `app/pricing/page.tsx` renders the commercial catalog with commercial  
  `PLAN_GUIDANCE` and structured data.
- `app/api/billing/checkout/route.ts` bills the commercial catalog only. A
  legacy plan id is refused (`PLAN_UNAVAILABLE`); the free plan and the custom
  plan are refused as not purchasable. When the owner has provisioned a Dodo
  product (`DODO_COMMERCIAL_PRODUCT_<PLAN>[_ANNUAL]`) that product id is used
  as-is; otherwise the product is created on demand at the catalog price
  (`Atai — <Plan> — $<price>/mo|yr`) — never at a legacy price (hard rule #4).
- `lib/billing/dodo-event-processing.ts` resolves commercial plans in the  
  `subscription.plan_changed` and renewal paths, so a commercial purchase
  attributes correctly and the billing cycle is persisted.
- Tests: `commercial-plans.test.ts`, `checkout/route.test.ts` and the full
  entitlement suite are green.

**Remaining product-owner steps:**

- [ ] Decide the grandfathering price policy (do legacy paid subscribers keep  
  their old price on renewal? encoded via `grandfatheredUntil`).
- [ ] **Optional but recommended:** pre-provision the Dodo products for the  
  commercial plans (Starter / Growth / Scale, monthly and annual) so the price
  is locked and no product is created from a live checkout. Explorer is free
  signup; Enterprise is custom. Legacy Dodo products are left intact for
  existing subscribers' renewals (ADR-2: never rename the Dodo `planId`).
- [ ] Set the per-plan env vars (optional — checkout provisions on demand
  otherwise):  
  `DODO_COMMERCIAL_PRODUCT_STARTER`, `DODO_COMMERCIAL_PRODUCT_GROWTH`,  
  `DODO_COMMERCIAL_PRODUCT_SCALE` and the matching `_ANNUAL` variants.
- [ ] Ratify Phase 4 credit numbers (item 2) so `PROVISIONAL_MONTHLY_CREDITS` is
  replaced; the page already shows the "provisional" disclaimer until then.
- [x] Coherence (done): the in-app billing page (`app/settings/billing/page.tsx`)
  reads the active catalog from `/api/billing/overview` (`plans` +
  `activeCommercialPlanId`), so it renders the commercial catalog and matches
  the public pricing page.

## 4. Annual billing wiring (Gate 5)

- [ ] Dodo products for the annual variants exist (or are created on demand);
  `billingCycle` (`"monthly" | "annual"`) is populated on subscription records
  at purchase.
- [ ] `POST /api/admin/billing/entitlements/annual-sweep` is scheduled (external
  cron / worker) to run daily; verify idempotency by re-running.
- [ ] Confirm annual grants are gated on the upfront annual payment having
  succeeded (no "monthly payment failed" logic).

## 5. Downgrade + cancellation behaviour (Gate 6)

- [x] Customer-initiated downgrade flow shows consequences pre-confirmation
  (`PlanChangeDialog` renders `planCustomerInitiatedDowngrade` output — business
  cap impact, over-limit read-only count — via `PlanCard`, which is fed the
  user's `currentBusinesses` from `/api/billing/overview`).
- [ ] Webhook-driven downgrade preserves all data; over-limit businesses become
  `preserved_readonly` (no auto-delete / no silent suspension).
- [ ] Five post-cancellation states honoured (public availability, new-deploy
  permission, resource consumption, admin access, data export).

## 6. Cache & safety (ADR-8)

- [ ] If the deployment runs >1 instance, confirm whether a shared cache (Redis)
  is needed; the in-memory `EntitlementCache` is correct for a single
  instance. Multi-instance without shared cache can serve briefly stale
  entitlements — mitigate via the event-driven invalidation already wired.
- [ ] Security-sensitive ops (`createProject`, `forkProject`, `buildProduction`,
  `useAgent`) resolve **fresh** (verified in `require.ts`).
- [ ] Fail-open verified: with the flag ON but resolution throwing, the path
  degrades to last-known / planning-only, never a permissive grant.

## 7. Usage transparency (missing-area)

- [x] `computeUsageAlerts` is surfaced in the billing UI — `/api/billing/overview`
  returns `usageAlerts` and `/settings/billing` renders a near-limit (80%) /
  at-limit warning with a usage bar.

## 8. Final verification

- [x] `tsc --noEmit` clean (verified: 0 errors).
- [x] Entitlement + billing test suites green.
- [x] Admin force-invalidate endpoint: `POST /api/admin/billing/entitlements/invalidate`
  with `{ userId }` or `{ workspaceId }`.

## 9. Execution runbook (run where the DB / Dodo are reachable)

> The build agent could not execute these: its environment has **no outbound
> network** (MongoDB Atlas SRV + Dodo DNS both fail). Everything below is one
> command on a machine that can reach them.

**Migration (Gate 4):**
```bash
npx tsx --env-file=.env.local scripts/migrate-entitlements.ts dry-run   # review
npx tsx --env-file=.env.local scripts/migrate-entitlements.ts apply     # persist
npx tsx --env-file=.env.local scripts/migrate-entitlements.ts dry-run   # expect changed=0
```
(Equivalently, the admin routes `GET` / `POST {mode:"apply"}`
`/api/admin/billing/entitlements/migrate`.)

**Dodo products (optional — checkout provisions on demand otherwise):**
```bash
npx tsx --env-file=.env.local scripts/provision-commercial-dodo-products.ts          # plan only
npx tsx --env-file=.env.local scripts/provision-commercial-dodo-products.ts --apply   # create
```
Then set the printed `DODO_COMMERCIAL_PRODUCT_STARTER|GROWTH|SCALE` (and the
`_ANNUAL` variants) in your environment **and** the Vercel project.

**Annual sweep cron:** `vercel.json` now schedules
`GET /api/admin/billing/entitlements/annual-sweep` daily at 06:15 UTC. Set a
`CRON_SECRET` env var in Vercel — Vercel sends it as `Authorization: Bearer …`.

---

**`ENTITLEMENT_ENFORCEMENT_ENABLED=false` is the emergency rollback** — it
removes every plan cap, so do not set it casually. Items 2 and 3 are hard
blockers requiring product-owner decisions; they cannot be satisfied by code
alone.
