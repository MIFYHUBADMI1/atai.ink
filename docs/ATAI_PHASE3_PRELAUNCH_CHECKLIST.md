# Atai — Phase 3 Pre-Launch Checklist (gate to flip enforcement)

**Purpose:** enumerate every condition that must be true before  
`ENTITLEMENT_ENFORCEMENT_ENABLED=true` is set. Flipping the flag earlier than  
this would risk breaking live billing or advertising capabilities that do not  
exist yet (hard rules #1 and #3).

**Current status:** the Phase 3 *machinery* is built, type-clean, and tested.  
The flag is **OFF**. Several items below are genuine product-owner decisions,  
not code tasks.

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

## 3. Pricing page reconciliation — BLOCKER (found during Phase 3)

**Status: code built & gated.** The reconciliation is implemented but OFF by  
default. Flipping it requires the product-owner steps below (new Dodo products).

**What was built (no live change until the flag is on):**

- New commercial display/checkout catalog in  
  `lib/billing/entitlements/commercial-plans.ts`, derived from the entitlement  
  `catalog.ts` (`PLAN_PRICING`, `PROVISIONAL_MONTHLY_CREDITS`, `PLAN_BASE`,  
  `availability`). It renders Explorer / Starter $89.99 / Growth $199.99 /  
  Scale $499.99 / Enterprise (custom) — matching what the entitlement service  
  enforces.
- `PlanCard` (`components/billing/plan-card.tsx`) now honours `availability`  
  (defensively filters unlaunched Scale features — Agent Start/Scout/Optimize,  
  marketing automation, knowledge base — hard rule #3), `purchaseState`  
  ("Contact sales" CTA when a plan's Dodo product is not yet provisioned),  
  `provisionalCredits` (visible "provisional" note — hard rule #1), and annual  
  pricing.
- `app/pricing/page.tsx` renders the commercial catalog when  
  `ATAI_COMMERCIAL_PRICING_ENABLED=true`, with commercial `PLAN_GUIDANCE` and  
  structured data. **Flag is OFF → the live page is unchanged (zero regression).**
- `app/api/billing/checkout/route.ts` prefers the commercial catalog and passes  
  the plan's pre-provisioned Dodo product id straight through  
  (`getOrCreateSubscriptionProduct(..., existingProductId)`), so a commercial plan  
  never reuses or collides with a legacy product/price (hard rule #4).
- `lib/billing/dodo-event-processing.ts` now resolves commercial plans in the  
  `subscription.plan_changed` and renewal paths, so a provisioned commercial  
  purchase attributes correctly.
- Tests: `commercial-plans.test.ts` (8) green; full entitlement suite (62) green;  
  `tsc --noEmit` clean.

**Remaining product-owner steps before flipping the flag (cannot be done in code):**

- [ ] Decide the grandfathering price policy (do legacy paid subscribers keep  
  their old price on renewal? encoded via `grandfatheredUntil`).
- [ ] **Provision the new Dodo products** for the commercial plans (Starter /  
  Growth / Scale at the new prices; Explorer is free signup; Enterprise is  
  custom). Legacy Dodo products are left intact for existing subscribers'  
  renewals (ADR-2: never rename the Dodo `planId`).
- [ ] Set the per-plan env vars:  
  `DODO_COMMERCIAL_PRODUCT_STARTER`, `DODO_COMMERCIAL_PRODUCT_GROWTH`,  
  `DODO_COMMERCIAL_PRODUCT_SCALE` (and `_ENTERPRISE` if self-serve). Until  
  these exist, the plans render a "Contact sales" CTA and checkout refuses  
  with `PLAN_UNAVAILABLE` — so no wrong/legacy price can ever be charged.
- [ ] Ratify Phase 4 credit numbers (item 2) so `PROVISIONAL_MONTHLY_CREDITS` is  
  replaced; the page already shows the "provisional" disclaimer until then.
- [ ] Flip `ATAI_COMMERCIAL_PRICING_ENABLED=true` (and, separately,  
  `ENTITLEMENT_ENFORCEMENT_ENABLED=true` once items 1–7 are checked).
- [x] Coherence (done): the in-app billing page (`app/settings/billing/page.tsx`)
  now reads the active catalog from `/api/billing/overview` (`plans` +
  `activeCommercialPlanId`), so it renders the commercial catalog whenever
  `ATAI_COMMERCIAL_PRICING_ENABLED=true` and matches the public pricing page.
  Legacy behaviour is unchanged while the flag is OFF.

## 4. Annual billing wiring (Gate 5)

- [ ] Dodo products for annual variants exist and are linked; `billingCycle`  
  |  |  |  
  | --- | --- |  
  (`"monthly" | "annual"`) is populated on subscription records at purchase.
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
- [x] Entitlement + billing test suites green (62 entitlement/upgrade tests, 158 billing tests).
- [x] Admin force-invalidate endpoint: `POST /api/admin/billing/entitlements/invalidate`
  with `{ userId }` or `{ workspaceId }`.

---

**Do not flip `ENTITLEMENT_ENFORCEMENT_ENABLED=true` until items 1–7 are  
checked.** Items 2 and 3 are hard blockers requiring product-owner decisions and  
a separate pricing-page task; they cannot be satisfied by code alone.
