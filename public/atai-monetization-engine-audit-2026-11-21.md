# Atai — Monetization Engine Audit

**Document type:** Read-only architecture / financial-systems audit. No code changed.
**Date:** 2026-11-21
**Scope:** pricing catalog, product management, subscription lifecycle, Dodo Payments integration, credit allocation and ledger, entitlements, admin configuration surfaces, financial reporting.
**Trigger:** ATAI is moving from hardcoded pricing configs to a database-driven, admin-configurable monetization engine. This audit establishes the honest current state before that move.
**Method:** full read of every billing module and route, plus call-site verification of each capability claim (a feature "exists" only if something invokes it). Every finding cites the file that proves it.

---

## 0. Verdict in one page

The **money-movement core is genuinely production-grade**: a single credit ledger with idempotency keys and Mongo transactions, verified Dodo webhooks with durable ingestion, an idempotent recovery worker, refund accounting that never rewrites history, and a reconciliation module that refuses to fabricate findings. That layer should not be rebuilt.

The **monetization layer above it is not yet a system — it is a set of constants with admin read-only views.** Concretely:

| Question a monetization engine must answer | Today |
|---|---|
| Where is the price of a plan defined? | Compile-time constants in `lib/billing/entitlements/catalog.ts`, duplicated in `lib/billing/config.ts` (legacy), `lib/infrastructure/plans.ts` (infra), and `app/terms/page.tsx` (legal copy) |
| Can an admin change a plan price or monthly credit grant? | **No.** `PATCH /api/admin/billing/configuration` cannot reach plan prices or grants |
| Is a subscriber pinned to the price/entitlements they bought? | **No.** Renewal re-reads today's code constants |
| Is there a versioned record of a pricing change? | **No.** One `app_settings` document is overwritten in place; history exists only in stdout logs |
| Does a mid-cycle upgrade charge fairly? | **No proration path at all**; upgrade = second full-price checkout, and the old plan's credits keep running alongside the new grant |
| Does a refund on a subscription claw back credits? | **No.** Subscription payment rows carry no `creditsGranted`, so reversal is `0` |
| Are the advertised plan caps enforced? | Partly: create/fork/build/deploy/launch are gated; **custom domains, subdomains, databases, storage, specialist teams, competition intel and agents are not** |
| Does a downgrade actually downgrade? | **No.** The over-limit read-only marking is a pure function with zero callers |
| Does infrastructure ("credits/month") renew? | **No.** Charged once at activation; no scheduler ever renews or expires it |
| Can we state MRR, deferred revenue, or the cost of outstanding credits? | **No.** Reporting is cash-in by currency plus ledger aggregates |

**Readiness for the DB-driven target: the ledger and webhook substrate are ready; the catalog, versioning, lifecycle and reporting layers are not.** The work is concentrated in four areas — a versioned price book, subscriber pinning, lifecycle completion (proration, downgrade persistence, infra renewal), and financial reporting — and none of it requires touching the ledger.

Severity roll-up (42 findings, §4):

| Severity | Count | Theme |
|---|---|---|
| Critical | 3 | subscriber pinning (M-06), proration/double-grant (M-09), subscription refunds (M-14) |
| High | 17 | catalog fragmentation, admin write gaps, unenforced entitlements, downgrade, infra renewal, config audit, reporting, invoices/emails |
| Medium | 17 | ledger before/after staleness, bucket invariant, dunning, disputes, fees/tax, cache, recovery scheduling, terms drift |
| Low | 5 | timing-safe compare, idempotency key shape, client bundle fallback, duplicate product names, bounded reconciliation |

---

## 1. What exists today — the seven subsystems

### 1.1 The catalog layer (three catalogs, one of them dead weight)

| Catalog | File | Sold? | Notes |
|---|---|---|---|
| Commercial five-plan | `lib/billing/entitlements/catalog.ts` → `commercial-plans.ts` | **Yes** — the only sellable catalog | `PLAN_PRICING` (monthly/annual), `PROVISIONAL_MONTHLY_CREDITS`, `PLAN_BASE` (caps), availability flags |
| Legacy six-plan | `lib/billing/config.ts:100-235` | **No** — renewal attribution only | Kept deliberately so pre-existing Dodo subscriptions keep renewing (ADR-2) |
| Infrastructure plans | `lib/infrastructure/plans.ts` | **Yes**, priced in Atai credits | `testing/basic/starter/pro/business/enterprise`, 0–95,000 credits/month |

All three live in code. `PLAN_PRICING` is `{ starter: 89.99/989.89, growth: 199.99/2199.89, scale: 499.99/5499.89 }` — annual is exactly 11× monthly, and the pricing page's FAQ claim ("yearly at 12 months for the price of 11") is therefore true, but the ratio is a hand-written constant, not a derived discount.

Customer-facing surfaces that render these constants: `app/pricing/page.tsx` (server component), `components/billing/pricing-plan-grid.tsx` (Monthly/Yearly toggle, shown when an annual variant is purchasable), `components/billing/plan-card.tsx`, `app/settings/billing/page.tsx`, `components/onboarding/plan-step.tsx`, `app/api/billing/{overview,upgrade-options}`.

### 1.2 Price → checkout → Dodo product

`app/api/billing/checkout/route.ts` is well built: it authenticates, rate-limits per user+product+cycle, resolves the plan **server-side** (the client sends a plan id, never a price), refuses custom/zero-price plans, and picks the monthly or annual variant. The price charged is `plan.priceUSD` / `plan.annualPriceUSD` from the catalog.

Product binding is environment-first: `DODO_COMMERCIAL_PRODUCT_<PLAN>[_ANNUAL]` (read by `getCommercialDodoProductId`, `commercial-plans.ts:52-58`). If the env var is absent, `getOrCreateSubscriptionProduct` (`lib/billing/dodo-service.ts`) searches Dodo by name and **creates the product on demand**, with the price embedded in the name (`Atai — Growth — $199.99/mo`) so a price change can never silently reuse a stale-priced product. This is a genuinely good design decision and should survive the migration.

Permanent credit packs take the parallel path from `PERMANENT_CREDIT_PACKS` (`config.ts:239-245`): 200k/$59, 500k/$119, 1M/$219, 5M/$859, 15M/$2,499. These are **not** admin-editable and **not** versioned.

`app/api/admin/dodo-products/route.ts` lets an admin create/update/delete products in Dodo directly — but the created product id is **never persisted** back to env or DB. The console can therefore create products that checkout will only ever find by name.

### 1.3 Webhook ingestion

`app/api/billing/webhook/route.ts` owns ingestion only: size cap, signature verification (`lib/billing/dodo-webhook.ts`, Standard Webhooks HMAC-SHA256, `timingSafeEqual`, 5-minute replay window), durable persistence keyed on a unique `webhookId`, then `processDodoEvent`. HTTP 200 means "durably recorded", not "money moved" — a deliberate and correct choice.

Event coverage in `lib/billing/dodo-event-processing.ts`: `payment.{succeeded,failed,processing,cancelled}`, `subscription.{active,renewed,cancelled,past_due,on_hold,expired,updated,plan_changed}`, `refund.{succeeded,failed}`, seven `dispute.*` types, four `credit.*` types. Unattributable events return an `unresolved` reason instead of guessing.

Indexes backing this: `webhook_events_webhook_id_unique`, `webhook_events_recovery_claim` (`lib/db/collections.ts:652-659`).

### 1.4 Subscription lifecycle

```
checkout → Dodo → webhook subscription.active
        → activatePaidSubscription (lib/billing/activate-subscription.ts)
             · resolve commercial product → plan (commercial-first)
             · cancel any previous active sub record (cancelAtPeriodEnd)
             · grantSubscriptionCredits(period = next_billing_date, or +1 month if annual)
             · upsert subscription_records
monthly renewal → subscription.renewed → expire THIS sub's buckets → grant again (period-keyed)
annual          → activation grants month 0; daily sweep grants months 1–11
                  (lib/billing/entitlements/annual-scheduler.ts, /api/admin/billing/entitlements/annual-sweep)
cancel          → POST /api/billing/subscription/cancel → Dodo cancel_at_next_billing_date + record flag
expiry          → subscription.expired → expireSubscriptionCredits (needs metadata.userId) + status
```

Idempotency is period-keyed: `sub_grant_${subId}_period_${dayEpoch(periodEnd)}`, shared by `active` and `renewed` so one billing period grants at most once.

### 1.5 Credit ledger

`lib/billing/credit-service.ts` is the single authority. Balance model on the `users` document: `subscriptionCredits`, `permanentCredits`, legacy `credits`, plus `creditBuckets[]` each carrying `{bucketId, subscriptionId, planId, amount, originalAmount, expiresAt}` (`lib/types/db.ts:97-113`). Consumption is subscription-first, oldest-expiry-first (`lib/billing/consume-plan.ts`), inside a transaction with `$gte` guards.

Idempotency: unique index on `credit_ledger.idempotencyKey` (`collections.ts:672`). Expiry is enforced three ways — lazy on balance read, at consumption, and by a daily cron (`vercel.json` → `/api/admin/billing/credits/expire-sweep`, `lib/billing/credit-sweep.ts`).

### 1.6 Entitlements

`lib/billing/entitlements/` computes a plan's `EntitlementSet` (businesses, production apps, subdomains, custom domains, infra tier, credits, AI tiers, marketing/BI/education flags, support tier) and answers `checkEntitlement(op)`.

**Enforcement is wired for exactly five operations**: `createProject` (`lib/projects/create-project.ts:154`), `forkProject` (`app/api/projects/[id]/fork/route.ts:87`), `buildProduction` (`lib/projects/project-actions.ts:119`, `app/api/projects/[id]/build/route.ts:51`, `launch/route.ts:45`, `lib/analysis/pipeline.ts:141`), and `deploy` (`project-actions.ts:355`, `deploy/route.ts:53`). Free/grandfathered accounts get `preserveLegacyBehavior` so no existing founder is capped by surprise — good.

The rest of the operation vocabulary is defined and unit-tested but has **no call site** (§4, M-22).

### 1.7 Admin surfaces

| Surface | Read | Write |
|---|---|---|
| `/admin/billing` overview | money by currency, payment/subscription counts, credit aggregates, revenue-by-day, top users, transaction mix | — |
| `/admin/billing/configuration` | every runtime knob + defaults | costs, rewards, runtime pricing, infra prices — **not** plan price, plan credits, or packs |
| `/admin/billing/plans` | commercial catalog | **read-only** |
| `/admin/billing/credit-packs` | packs | **read-only** |
| `/admin/billing/subscriptions` | live subs | **read-only** |
| `/admin/billing/user-billing` | per-user state | **read-only** (credit adjust lives at `/api/admin/users/[id]`) |
| `/admin/billing/webhooks` | queue health | run one recovery batch |
| `/admin/billing/audit` | ledger viewer | — |
| `/admin/billing/reconciliation` | live findings | — (read-only by design) |
| `/admin/dodo-products` | local config ↔ Dodo sync status | create/update/delete in Dodo (id not persisted) |

The one admin-configurable pricing layer is `lib/billing/runtime-config.ts`: a single `app_settings` document (`_id: "billing"`) of Zod-validated overrides layered over code defaults, 30-second per-process cache, `invalidateBillingSettings()` after a write. This is the correct pattern — it just doesn't yet cover the things that matter most.

---

## 2. Financial invariants that hold today (do not regress)

These are the load-bearing properties of the existing system. The DB-driven engine must preserve every one of them.

1. One payment grants its credits at most once (unique `idempotencyKey`).
2. One subscription billing period grants at most once (period key).
3. A failed payment never records revenue and never grants.
4. A refund is a new row; the original payment is never rewritten as if it never happened.
5. Duplicate webhook deliveries are blocked by the unique `webhookId` index *and* remain harmless because every effect is idempotency-keyed.
6. A persistence failure throws → event `failed` → replayable; an HTTP ack never implies completion.
7. Missing authoritative data produces an explicit `unresolved`, never a guessed or fabricated `0`.
8. Currencies are never summed; there is no FX source in the repo and none is performed.
9. Consumption is subscription-first, oldest-expiry-first, never partial.
10. Expiry is enforced lazily, at consumption, and by a daily sweep — three independent paths.
11. Reconciliation is read-only and bounded; "no findings" is never presented as "the books are clean".
12. Legacy plan ids are never renamed or deleted, so pre-existing Dodo renewals keep resolving.

---

## 3. Current state vs. the DB-driven target

Target capability, stated as the property the business needs:

> An admin can define a plan's price, credit grant, caps and product mapping in the database; publish it with an effective date; have every surface (pricing page, checkout, webhook grants, entitlements) read the published version; keep every existing subscriber pinned to the version they bought; roll back a bad publish; and read MRR, deferred revenue and credit liability without a deploy.

| # | Capability | State | Evidence |
|---|---|---|---|
| 1 | Single price book | ✗ 3 catalogs + legal copy | §1.1 |
| 2 | Admin edits plan price | ✗ | `app/api/admin/billing/configuration/route.ts` PATCH schema |
| 3 | Admin edits monthly credit grant | ✗ (`setPlanCreditAllocation` referenced at `catalog.ts:41` does not exist) | grep: comment only |
| 4 | Admin edits credit packs | ✗ | `config.ts:239-245` |
| 5 | Promotions / coupons / trial periods | ✗ (no primitive; Dodo `discount: 0` hardcoded) | `dodo-service.ts` |
| 6 | Versioned config with history | ✗ (single doc, overwritten) | `runtime-config.ts:446-482` |
| 7 | Publish / rollback | ✗ | — |
| 8 | Effective-dated prices | ✗ | — |
| 9 | Subscriber price pinning | ✗ | `dodo-event-processing.ts:370` |
| 10 | Subscriber entitlement pinning | ✗ (snapshot only from the migration script) | `service.ts:148-160` |
| 11 | Grandfathering mechanism | ⚠ partial (`grandfathered`/`grandfatheredUntil` fields, `preserveLegacyBehavior`) | `billing-types.ts`, `catalog.ts` |
| 12 | Product↔plan mapping in DB | ✗ env vars only | `commercial-plans.ts:52-58` |
| 13 | Proration on plan change | ✗ | no code path |
| 14 | Downgrade persistence | ✗ | `downgrade.ts:123` unused |
| 15 | Infra plan renewal | ✗ | `service.ts:275` unused |
| 16 | Full entitlement enforcement | ⚠ 5 of ~15 ops | §1.6 |
| 17 | Revenue recognition / deferred revenue | ✗ (explicitly out of scope today) | `docs/implementation/atai-finance-phase-3-report.md` invariant 10 |
| 18 | Credit liability valuation | ✗ | no code |
| 19 | MRR / ARR / churn / LTV | ✗ | no code |
| 20 | Contribution margin per plan | ✗ (`creditsToBaselineUnits` has no caller) | `credit-service.ts:1445` |
| 21 | Customer invoices / receipts | ✗ | `payment_records` is admin-only |
| 22 | Billing notifications | ✗ | `lib/email/templates.ts` has no billing template |
| 23 | Config change audit trail in DB | ✗ | stdout log only |
| 24 | Automated webhook recovery | ✗ (manual batch only) | `vercel.json` has no recovery cron |

Score: **0 of 24 fully met, 2 partial (#11 grandfathering fields, #16 partial enforcement), 22 absent.** The engine substrate (ledger, webhooks, idempotency, expiry) is ready; the *configuration and lifecycle* layer the target describes does not exist yet.

---

## 4. Findings register

Each finding: **ID · severity · what · evidence · impact · recommendation**. "Impact" is stated in money or customer trust wherever it can be.

### A. Catalog and pricing source of truth

**M-01 · High · Three parallel plan catalogs with colliding names.**
`lib/billing/config.ts` (legacy), `lib/billing/entitlements/catalog.ts` (commercial), `lib/infrastructure/plans.ts` (infra) all define `starter`/`business`/`enterprise` with different meanings and different prices. A reader — human or code — cannot answer "what does Starter cost?" without knowing which catalog is meant.
*Impact:* wrong-surface pricing bugs and confused support conversations; the exact class of bug the commercial-first resolution in `dodo-event-processing.ts:355-372` was written to prevent.
*Recommendation:* one price book keyed by `(productKind, planId, cycle, version)`; the other catalogs become read-only projections of it.

**M-02 · High · Plan price and credit grant are compile-time constants.**
`PATCH /api/admin/billing/configuration` (`route.ts:200-300`) accepts costs, rewards, runtime pricing and infra prices — never `PLAN_PRICING` or `PROVISIONAL_MONTHLY_CREDITS`. `catalog.ts:41` documents an admin override function `setPlanCreditAllocation` that **does not exist anywhere in the repo** (grep: one comment, zero definitions).
*Impact:* every price or grant change requires a code change, review, deploy and a new Dodo product (the price is in the product name). The business cannot respond to a competitor or a currency shift in an afternoon.
*Recommendation:* make plan price/grant a first-class row in the price book; delete the dangling comment or implement it.

**M-03 · High · "Provisional" credit quantities are advertised to customers.**
`COMMERCIAL_FEATURES` in `commercial-plans.ts` renders lines such as `"150,000 Atai Credits / month (provisional)"` on `/pricing` and `/settings/billing`, and `provisionalCredits: true` is carried on the plan object.
*Impact:* a paying customer reads "provisional" next to what they are being charged for. That is a trust and consumer-law exposure (a price/quantity that the seller labels as not final), and it undercuts the whole point of a monetization engine.
*Recommendation:* ratify the grants (Phase 4 margin model) and remove the word from customer copy; keep the internal flag for tooling only.

**M-04 · Medium · No discount or promotion primitive.**
Annual pricing is `monthly × 11` written as a literal; `createSubscriptionProduct`/`createOneTimeProduct` hardcode `discount: 0`; there is no coupon, promo code, trial or first-month-off concept anywhere (grep for `coupon|promo|discount_code` returns only referral codes).
*Impact:* no launch offer, no win-back offer, no annual-upsell lever, no partner pricing.
*Recommendation:* add a `promotions` model (code, kind, value, applies-to, window, max redemptions) resolved server-side at checkout and recorded on the payment row.

**M-05 · Medium · Admin-created Dodo products are orphaned.**
`POST /api/admin/dodo-products` creates a product in Dodo and returns it; nothing writes the id back to env or DB. Checkout will only ever bind to it through `findProductByName` if the names match exactly.
*Impact:* an operator believes they have wired a product; checkout may create a second one. Duplicate products in Dodo, split revenue attribution.
*Recommendation:* persist `{planId, cycle, dodoProductId}` in the price book; treat the admin console as the *writer* of that mapping.

### B. Subscriber pinning and grandfathering

**M-06 · Critical · Existing subscribers are not pinned to the price or grant they bought.**
On renewal, the credit amount is resolved from **today's code constant**: `const credits = plan?.mirrorCredits ?? positiveIntegerCredits(metadata?.credits) ?? 0` (`dodo-event-processing.ts:370`), where `plan` comes from `resolveCommercialProduct(product_id)` → `getCommercialPlans()` → `PROVISIONAL_MONTHLY_CREDITS`. The `mirrorCredits` stored on `subscription_records` is ignored. `subscription.plan_changed` (`:483-505`) likewise rewrites `priceUSD`/`mirrorCredits` from the live catalog.
*Impact:* editing one constant silently re-prices every existing subscriber's next grant, with no version record, no notice and no way to honour a promise made at signup. This is the single most dangerous property in the system for a business that is about to start editing prices regularly.
*Recommendation:* resolve grants from the *subscription's pinned version* (`subscription.priceBookVersion`), falling back to the current version only for new activations. Backfill a version onto every live subscription.

**M-07 · High · `pricingVersion` / `entitlementVersion` reference collections that do not exist.**
`SubscriptionRecord` declares `entitlementVersion`, `pricingVersion`, `entitlementSnapshot`, `grandfathered`, `grandfatheredUntil`, `migratedAt`, `migrationBatchId` (`lib/billing/billing-types.ts:160-186`) pointing at `plan_catalog_versions` / `entitlement_versions`. Those collections appear **only** in `docs/ATAI_PHASE2_ARCHITECTURE_DESIGN.md`.
*Impact:* the schema implies versioning that the runtime cannot perform; any code that trusts `pricingVersion` is trusting a field nothing maintains.
*Recommendation:* create the collections (Phase B) and populate the fields, or delete the fields so the gap is visible.

**M-08 · High · Commercial subscribers activated by checkout get no frozen entitlement snapshot.**
`computeSet` uses a stored snapshot when present, otherwise rebuilds from today's catalog (`service.ts:145-180`). Only the migration script writes snapshots. So a checkout-activated Growth customer's caps change the moment `PLAN_BASE` changes.
*Impact:* a price/entitlement publish silently alters what an existing customer can do — including potentially removing capability they are paying for.
*Recommendation:* write the snapshot at activation, and treat the snapshot as authoritative for the life of the pinned version.

### C. Subscription lifecycle

**M-09 · Critical · No proration, and upgrades double-grant credits.**
"Switch to X" from `plan-card.tsx` posts a fresh checkout (`plan-card.tsx:379-397`). `activatePaidSubscription` then marks the previous subscription `cancelled, cancelAtPeriodEnd: true` (`activate-subscription.ts:106-114`) but **does not expire its credit buckets**, and grants a full new period immediately.
*Impact:* (a) the customer is charged a full second price mid-cycle with no credit for the unused time — a fairness and chargeback risk; (b) both grants are spendable until the old bucket's `expiresAt`, so the platform hands out up to one extra period of credits on every upgrade — a direct margin leak that scales with upgrade volume.
*Recommendation:* implement an explicit plan-change operation: compute the unused-time credit, apply it as a proration (or a Dodo proration if the provider supports it), expire or convert the old bucket atomically, and record the whole transition on the subscription.

**M-10 · High · `subscription.plan_changed` moves the label, not the money.**
The handler (`dodo-event-processing.ts:483-505`) updates `planId`, `planName`, `priceUSD`, `mirrorCredits`, `commercialPlanId`, `billingCycle` — and grants nothing, expires nothing.
*Impact:* after a provider-side plan change the record says Scale while the purse still holds Starter credits, and the *next* renewal grants Scale credits against a period boundary set by the old plan. Entitlements (read from `commercialPlanId`) jump immediately; credits do not. Two sources of truth disagree.
*Recommendation:* route `plan_changed` through the same plan-change operation as M-09 (grant/expire deltas, reset the period), or reject the event and require our own change flow.

**M-11 · Medium · `past_due` is entitled indefinitely.**
`getActiveSubscriptionForScope` accepts `["active", "trialing", "past_due"]` (`service.ts:94,101`) with no grace window and no dunning.
*Impact:* a customer whose card fails keeps every capability forever while Dodo retries. No revenue recovery communication exists either (M-38).
*Recommendation:* add a grace window (e.g. 7 days) with a dated entitlement cliff, plus dunning emails.

**M-12 · Medium · Expiry handler depends on webhook metadata.**
`handleSubscriptionExpired` only expires credits when `metadata.userId` is present in the payload (`dodo-event-processing.ts:458-471`). The overdue-bucket sweep covers this case, so it self-heals — but the handler alone would leave expired credits spendable.
*Impact:* low in practice (three expiry paths exist); a latent trap if the sweep is ever removed or narrowed.
*Recommendation:* resolve `userId` from `subscription_records` by `dodoSubscriptionId` rather than trusting payload metadata.

**M-13 · Medium · No reactivation, pause or resume.**
Cancellation is one-way in the product (`POST /api/billing/subscription/cancel`); there is no "undo cancellation" before period end and no pause/resume despite `paused` being a status.
*Impact:* lost retention lever; the single cheapest save in subscription businesses is unavailable.

### D. Refunds, disputes, revenue protection

**M-14 · Critical · Refunding a subscription payment claws back nothing.**
`handlePaymentSucceeded` writes subscription payments as `paymentType: "subscription"` with **no** `creditsGranted` (`dodo-event-processing.ts:216-231`); the refund handler reverses `originalPayment.creditsGranted ?? 0` (`:566`).
*Impact:* a chargeback or goodwill refund on a renewal leaves the granted credits fully spendable. Every subscription refund is a pure loss of the credit value.
*Recommendation:* record the granted amount on the subscription payment row (it is known at renewal time), or resolve the reversal from the `sub_grant_*` ledger row for that period.

**M-15 · High · `reverseCredits` breaks the bucket invariant.**
`reverseCredits` (`credit-service.ts:1253-1350`) debits `subscriptionCredits` and `credits` but never adjusts `creditBuckets`, while `lib/types/db.ts:107-113` documents that bucket sum equals the flat subscription balance and `expireSubscriptionCredits` computes amounts *from the buckets*.
*Impact:* after any subscription-credit reversal the two representations diverge; a later expiry can pull buckets worth more than the remaining flat balance (capped by the `$gte` filter, but the ledger then records a misleading amount) or leave flat credits with no bucket (never expiring).
*Recommendation:* make reversal bucket-aware — deduct oldest-expiry buckets first, mirroring consumption — or derive the flat field from the buckets instead of maintaining both.

**M-16 · Medium · Disputes have no financial effect.**
All seven `dispute.*` events are logged only (`dodo-event-processing.ts:157-164`). No credit hold, no exposure figure, no automated reversal on `dispute.lost`.
*Impact:* chargeback exposure is invisible until an operator reads the reconciliation screen; credits remain spendable during a dispute.
*Recommendation:* on `dispute.opened` place a soft hold on the granted credits for that payment; on `dispute.lost` apply the refund path.

**M-17 · Medium · No provider-fee or tax-reserve ledger.**
`ACTUAL_COST_CATEGORIES` includes `dodo_fees` and `tax_reserve` (`config.ts`), but nothing writes either. All reported revenue is gross.
*Impact:* margin is overstated by payment fees and sales tax/VAT, which on a $199.99 plan is a material percentage. No tax reserve is visible to the business.
*Recommendation:* capture Dodo's fee and tax lines from the payment object into a cost ledger keyed to the payment, and report net.

### E. Ledger integrity

**M-18 · High · Subscription grants record stale `balanceBefore`/`balanceAfter`.**
`grantSubscriptionCredits` reads the balance *before* opening the transaction (`credit-service.ts:775`) and writes those numbers into the ledger entry, whereas `grantCredits` deliberately reads inside the transaction (`credit-service.ts:300-306`) with a comment explaining why. Under concurrent grants or a renewal racing an admin adjustment, subscription ledger rows do not chain: the next entry's `before` will not equal the previous entry's `after`.
*Impact:* the audit trail — the thing reconciliation and any future liability report depend on — cannot be replayed to a balance for subscription credits.
*Recommendation:* move the read inside the transaction, exactly as `grantCredits` does; add a test that two concurrent grants produce a chained ledger.

**M-19 · Medium · Legacy `credits` field can resurrect a phantom balance.**
Every grant/debit writes both the split fields and legacy `credits`; `getBalance` returns `newTotal > 0 ? newTotal : legacyCredits` (`credit-service.ts:88-93`).
*Impact:* a user whose split fields are legitimately 0 but whose legacy field is stale sees and can spend credits that the split model says do not exist (the fallback is per-read, so the ledger and the balance can disagree).
*Recommendation:* finish the migration — backfill split fields for every user, then make the fallback read-only for display or remove it behind a flag with a divergence alarm.

**M-20 · Medium · Buckets are only removed by expiry.**
No refund, plan change or reversal trims buckets (see M-15); only `expireSubscriptionCredits` and `expireOverdueBuckets` pull them.
*Impact:* bucket count per user grows with every plan change and every renewal-with-leftover, and the bucket list stops describing the purse.
*Recommendation:* single `applyCreditDelta(userId, type, amount, {reason, subscriptionId})` that mutates flat fields and buckets together, used by grant, consume, reverse and expire.

**M-21 · Low · Admin adjustment idempotency key can silently swallow a legitimate second adjustment.**
`adminAdjustCredits` derives the key from `admin + user + amount + first 20 base64 chars of reason` (`credit-service.ts:1364`). Two genuine adjustments of the same amount with the same reason prefix collapse into one.
*Impact:* an operator grants twice and only one lands, with no error (the call returns success from the existing entry).
*Recommendation:* require an explicit operation id from the caller (the admin UI already has a submit boundary), or include a client-generated nonce.

### F. Entitlements

**M-22 · High · Seven entitlement operations are unenforced.**
`registerCustomDomain`, `connectSubdomain`, `provisionDatabase`, `useStorage`, `useSpecialistTeam`, `useCompetitionIntel`, `useAgent` are defined in `catalog.ts`, asserted in `entitlements.test.ts`, and **never called** by any route, service or job (grep across `app/`, `lib/` excluding `lib/billing/entitlements/`).
*Impact:* custom domains and storage are sold as plan features (Starter "0 custom domains", Growth "1 custom domain", Scale "4") and nothing stops an Explorer account from registering one or a Starter account from provisioning a database. The commercial promise is unbacked in exactly the areas customers can self-serve.
*Recommendation:* wire each operation at its single entry point (`app/api/domain/*`, `app/api/projects/[id]/infrastructure`, storage writers, agent routes), with the same `authorizeProductionWork`-style denial → 402 pattern already used for builds.

**M-23 · High · Downgrade does not downgrade.**
`applyWebhookDowngrade` (`downgrade.ts:123`) returns the business ids that should become `preserved_readonly`; it has **no caller**, and no project status of that name exists in the schema. The confirmation UI (`plan-card.tsx` + `downgrade.ts` copy) tells the customer that over-limit businesses "will become read-only".
*Impact:* a customer who downgrades from Growth (4 businesses) to Starter (1) keeps all four running. The seller loses the upgrade incentive and the customer was told something untrue. This is the highest-value enforcement gap after M-22 because it is the one the UI explicitly promises.
*Recommendation:* implement the persistence: a project status (or `entitlementsPausedAt`) applied by the same code path that applies the plan change, plus the "choose which to keep" selector, plus a reversal on upgrade.

**M-24 · Medium · Infrastructure plans are a second entitlement axis that nothing gates.**
`PLAN_BASE.*.infraDefault/infraMax` exist in the commercial catalog, but `activatePlan` (`lib/infrastructure/service.ts:99`) performs no entitlement check — any user with credits can buy the `enterprise` infra tier (which it rejects for a different reason: manual setup).
*Impact:* the plan's "included infrastructure tier" is decorative; a Starter customer can buy Business infrastructure and consume credits the plan did not budget.
*Recommendation:* check `infraMax` in `activatePlan`, and decide explicitly whether infra is included (no extra charge up to the tier) or add-on (charged). Today it is silently add-on, which contradicts the "included" reading of the plan table.

**M-25 · Medium · Contradictory instructions for the enforcement switch.**
`ENTITLEMENT_ENFORCEMENT_ENABLED` defaults **ON** (`require.ts:22`, `!== "false"`), while the migration route's own doc says the flag "stays off until the migration is [run]" (`app/api/admin/billing/entitlements/migrate/route.ts:12-13`).
*Impact:* an operator reading the migration route believes enforcement is dormant; it is live. Any pre-migration account whose `planId` doesn't resolve is treated as free — the safe direction, but not what the operator was told.
*Recommendation:* one source of truth for the switch, documented in one place, and state the current value in the admin console.

### G. Infrastructure monetization

**M-26 · High · Infrastructure plans never renew and never expire.**
`activatePlan` charges `plan.AtaiPrice` once and sets `expiresAt = now + MONTH_MS` (`service.ts:180,232`). `handleExpiration` (`service.ts:275`) — the function that would stop or downgrade an expired plan — has **no caller**, and no cron exists for it.
*Impact:* "5,000 credits/month" is charged exactly once and then runs free forever. That is systematic under-collection on every infrastructure customer, and a storage/DB quota that never resets.
*Recommendation:* a daily infra sweep (the cron substrate now exists in `vercel.json`) that renews active plans from credits and expires lapsed ones, with an idempotency key per `(projectId, periodStart)`.

**M-27 · Medium · Storage quota is still unenforced dead code.**
`checkStorageLimit` (`service.ts:344`) has zero callers; `storageUsedBytes` has no writer, so `overQuota` can never be true.
*Impact:* every plan advertises a storage limit that nothing measures or enforces. On a multi-tenant DB this is also a capacity risk.
*Recommendation:* write usage from the Totalum/DB layer, call the check on the write path, and surface it in the project's infrastructure card.

### H. Admin and operations

**M-28 · High · The admin console cannot perform the operations the business needs.**
No admin write path exists for: plan price, plan credit grant, credit pack definition, promotion, subscriber plan change, period extension, goodwill credit (exists per-user only), refund issuance, or grandfathering.
*Impact:* every commercial decision becomes an engineering ticket and a deploy. This is precisely the gap the DB-driven migration exists to close.
*Recommendation:* Phase B admin surface: price book editor with draft → publish → rollback, pack editor, promotions, and a per-subscriber "pin/extend/change plan" action — each writing an audited record.

**M-29 · High · No versioned config history, no rollback, no approver.**
`updateBillingSettings` merges a patch into one `app_settings` document (`runtime-config.ts:446-482`) and logs the patch to stdout. There is no before/after snapshot, no version number, no author record beyond the log line, no rollback.
*Impact:* "who changed the deploy cost and when, and what was it before?" cannot be answered from the database. For a pricing system this is an audit failure, not a convenience gap.
*Recommendation:* `billing_config_versions` collection: `{version, effectiveFrom, author, diff, snapshot, status: draft|published|superseded}`; writes go through it; rollback = publish a previous version.

**M-30 · Medium · Config cache is per-process with a 30-second TTL.**
`loadSettings` caches for 30s per process; `invalidateBillingSettings()` clears only the calling instance.
*Impact:* on serverless/multi-instance deployment, two requests in the same second can see different prices — the pricing page and the checkout can disagree, briefly. The price-in-product-name rule prevents charging a stale Dodo price, but not a stale *displayed* price.
*Recommendation:* include a `configVersion` in the cached value and revalidate cheaply (or store the version in a shared cache), so publish → propagate is deterministic rather than time-based.

**M-31 · Medium · Webhook recovery has no scheduler.**
`runRecoveryBatch` is invoked only by `POST /api/admin/billing/webhooks` (operator-triggered). `vercel.json` schedules four crons — expiry sweep, annual sweep, domain recheck, claim notices — but not recovery. The route's own comment still says "the repository has no cron/job substrate", which is now stale.
*Impact:* a failed event (e.g. a refund arriving before its payment) waits for a human. Money-affecting discrepancies are discovered by the customer or by reconciliation, not by the system.
*Recommendation:* add a recovery cron (e.g. hourly) with a bounded batch, and fix the stale comment.

**M-32 · Low · Non-timing-safe secret comparison in the expiry cron.**
`cronAuthorized` compares `Authorization` with `===` (`app/api/admin/billing/credits/expire-sweep/route.ts`), unlike the timing-safe comparison used for webhooks and the newer cron helper.
*Impact:* theoretical timing oracle on a bearer secret; inconsistent with the repo's own standard.
*Recommendation:* use the shared constant-time comparison helper.

### I. Financial reporting

**M-33 · High · No SaaS metrics.**
No MRR, ARR, ARPU, churn, net revenue retention, LTV, or plan mix. The admin overview reports money by currency, counts and ledger aggregates.
*Impact:* the business cannot answer "is revenue growing, and is it growing for a good reason?" without exporting data. Pricing decisions (the entire purpose of this migration) are made blind.
*Recommendation:* a `lib/finances/metrics.ts` computing MRR/ARR from active subscription records at their pinned prices, churn from cancellations/expiries, ARPU by plan, and a monthly cohort table — all derived, none stored.

**M-34 · High · No credit liability and no deferred revenue.**
Outstanding subscription + permanent credits are not valued anywhere; annual subscribers' 11 unissued months are an unrecorded obligation; the `net` figure is explicitly *not* recognized revenue (documented in `docs/implementation/atai-finance-phase-3-report.md`, invariant 10).
*Impact:* the cost of unspent credits is invisible — the largest hidden liability in a credit-based business — and annual cash cannot be separated from earned revenue.
*Recommendation:* compute (a) outstanding credit liability = Σ remaining credits × blended unit cost, and (b) deferred revenue = Σ unissued annual months × monthly price. Report both monthly; do not attempt a full revenue-recognition standard yet, but state the method.

**M-35 · Medium · The baseline cost model is decorative.**
`BASELINE_COST_MODEL_V1` is returned by the admin configuration API (`route.ts:180-183`) and `creditsToBaselineUnits` (`credit-service.ts:1445`) has no callers. Nothing maps a plan's grant to a cost, so no contribution margin exists.
*Impact:* credit grants remain unratified numbers (M-03). This is the prerequisite the Phase 1 report called out as hard rule #1, still unmet.
*Recommendation:* a per-plan margin model: grant × credit→cost rate vs. price − fees − tax, with a what-if view in admin; publish the ratified grants through the price book.

**M-36 · Low · Reconciliation findings are ephemeral.**
Reconciliation is bounded-window and computed on request; findings are not persisted, so there is no trend, no regression detection, no "was this open last week?".
*Impact:* an operator cannot tell whether a discrepancy class is growing.
*Recommendation:* persist a daily snapshot of finding counts by type/severity (a small collection), and chart it.

### J. Customer-facing completeness

**M-37 · High · No invoices, receipts or payment history for customers.**
`/settings/billing` shows balance, credit ledger history and plans. `payment_records` (amount, currency, status, refunds, `refundedAmountMinor`) is admin-only.
*Impact:* a customer cannot see what they paid, download a receipt, or dispute a charge with evidence. For a paid SaaS this is table stakes and often a legal requirement (VAT invoices).
*Recommendation:* a user-scoped `GET /api/billing/invoices` returning their payment rows plus a link to Dodo's hosted invoice/receipt, rendered on `/settings/billing`.

**M-38 · High · No billing emails.**
`lib/email/templates.ts` has verification, reset, email-change, session-code, and two domain-claim templates — nothing for payment succeeded, renewal, cancellation, payment failure, dunning, refund or annual month issued. The mailer works and is used by other subsystems.
*Impact:* silent renewals and silent failures. Failed-payment recovery (the highest-ROI email in subscriptions) is impossible; renewal surprises drive cancellations and chargebacks.
*Recommendation:* add the six templates and fire them from the webhook handlers *after* the financial effect commits, with a failure that never rolls back the money.

**M-39 · Medium · Terms page hardcodes the commercial prices.**
`app/terms/page.tsx:464-466` restates "$89.99/mo", "$199.99/mo", "$499.99/mo" as legal copy.
*Impact:* the first price change makes the terms of service disagree with the price charged — a legal exposure, not just a copy bug.
*Recommendation:* render from the price book (or a generated include), and add a test asserting terms ⊆ catalog.

**M-40 · Low · Client component imports the server catalog as a fallback.**
`app/settings/billing/page.tsx` is `"use client"` and imports `getCommercialPlans()` (`:10,91`) for a fallback when the API hasn't answered.
*Impact:* catalog constants ship in the client bundle and the fallback can be stale relative to server config — the exact divergence a DB-driven catalog must eliminate.
*Recommendation:* remove the fallback; render a skeleton until `/api/billing/overview` answers.

### K. Security and correctness edges

**M-41 · Medium · Grant amounts can fall back to webhook/checkout metadata.**
Both `activatePaidSubscription` (`activate-subscription.ts:93`) and `handleSubscriptionRenewed` (`dodo-event-processing.ts:370`) accept `metadata.credits` when the plan can't be resolved.
*Impact:* the metadata originates from our own checkout, but nothing verifies it against the product actually purchased. A dashboard edit in Dodo, a leaked session, or a legacy product with different economics changes the grant. Money-affecting input should be derived, not read from a mutable field.
*Recommendation:* resolve credits from the price book by `product_id`; treat metadata as a *hint* only, and record a reconciliation finding when the hint disagrees with the catalog.

**M-42 · Low · Product lookup by name can bind a stale product.**
`findProductByName` (`dodo-service.ts`) takes the first name match across all Dodo products. The price-in-name convention makes a *price change* safe, but a reverted price (A → B → A) can match the older A product.
*Impact:* low (prices rarely revert); nonzero revenue risk if it does.
*Recommendation:* prefer the persisted `dodoProductId`; fall back to name only for provisioning, and never for an existing paid plan.

---

## 5. Target architecture for the DB-driven engine

The design goal: **code holds the schema and the defaults; the database holds the decisions.** Nothing below requires changing the ledger, the webhook pipeline, or the consumption planner.

### 5.1 Data model (new collections)

```
price_book_versions        // one document per published catalog version
  _id, version (monotonic), status: "draft" | "published" | "superseded"
  effectiveFrom, publishedAt, publishedBy, note
  plans: [{
    planId, name, tagline, kind: "subscription" | "infra"
    price: { monthly, annual }            // integer minor units, never floats
    grant: { monthlyCredits, annualMonthlyCredits }
    caps: { businesses, productionApps, subdomains, customDomains, infraMax, ... }
    features: [...], notIncluded: [...], availability: {...}
    products: { monthly?: dodoProductId, annual?: dodoProductId }
    purchaseState, popular, custom
  }]
  packs: [{ packId, credits, price, label, popular, dodoProductId }]
  rewards: { welcomeBonus, referralVerificationReward, ... }
  costModel: { version, creditToCostRate, tiers }

promotions                 // additive, does not mutate the price book
  code, kind: "percent" | "amount" | "trial_days", value
  appliesTo: { planIds[], packIds[] }, window { from, to }, maxRedemptions
  stackable: false, status

billing_config_versions    // audit of every published change (extends today's app_settings)
  version, effectiveFrom, author, diff, snapshot, status

subscription_price_locks   // or fields on subscription_records
  subscriptionId, priceBookVersion, grantLocked: true, lockedAt
```

Keep `app_settings` exactly as it is for the operational knobs it already owns (collaborate/build/mirror/fork/infra prices, runtime pricing). The price book is a *different* concern: it is customer-facing commercial data with legal weight, and it needs versioning that a single merged document cannot give.

### 5.2 Resolution order (one function, used everywhere)

```
resolvePlan(planId, { cycle, at = now, forSubscriptionId? })
  1. If forSubscriptionId → use its locked priceBookVersion          (pinning)
  2. Else → the published version with effectiveFrom <= at           (effective dating)
  3. Else → code default (PLAN_BASE / PLAN_PRICING)                  (bootstrapping, tests)
  4. Validate the resolved plan with the same Zod schema as the default
     → any invalid field falls back to the default field, never to undefined
```

Every consumer — pricing page, plan card, checkout, webhook grant, entitlement build, admin console, terms page — calls this. There is no second path to a price.

### 5.3 Publish workflow

1. Admin opens a **draft** (clone of the current published version).
2. Edits price, grant, caps, features, product mapping.
3. A **preview diff** shows old → new per field, plus the impact list: *N subscriptions pinned to older versions*, *M subscribers whose next grant changes if unpinned*, *plans whose Dodo product must be provisioned*.
4. Validation gate: prices are integers, annual ≥ monthly, grant > 0 for paid plans, no customer-visible "provisional" copy, every paid plan has a product mapping (or is explicitly flagged "create on demand").
5. **Publish** writes a new immutable version with `effectiveFrom` and a required `note`.
6. **Rollback** = publish a new version whose content equals an older one. History is never mutated.

### 5.4 Propagation

Include `configVersion` in every cached value. Each process caches for a short TTL **and** compares a cheap version probe (a single-document read or a shared cache key) on cache hit; a mismatch forces a reload. That makes publish → consistent across instances bounded by one probe, not by a 30-second timer.

### 5.5 Product provisioning

Provisioning becomes an explicit, recorded step rather than an implicit side effect:

```
plan published with no dodoProductId
  → admin action "provision products" (or the provisioning script)
  → creates in Dodo at the published price
  → writes {planId, cycle, dodoProductId} into the price book version (as a new version)
  → checkout refuses a paid plan with no product instead of silently creating one
```

This removes M-05 and M-42 at the root: the mapping is data, and only data.

### 5.6 What must NOT change

The 12 invariants in §2, the `credit_ledger` schema and its idempotency index, the webhook ingestion contract (durable-then-process, 200 ≠ money moved), the `unresolved`-instead-of-guess rule, the commercial-first product resolution, and the legacy catalog's role as renewal authority for pre-existing subscriptions.

---

## 6. Phased roadmap

Sequenced so that each phase is independently shippable, and so that nothing in Phase B can be built on a known leak from Phase A.

### Phase A — Stop the leaks (highest value per line of code)

| # | Item | Findings | Done when |
|---|---|---|---|
| A1 | Pin subscription grants to the subscription's own recorded amount/version | M-06, M-07, M-08 | Changing a code constant changes nothing for an existing subscriber; a test proves it |
| A2 | Record `creditsGranted` on subscription payment rows; make refunds reverse them | M-14 | A refunded renewal removes its credits, idempotently |
| A3 | Make `reverseCredits` bucket-aware (single delta function) | M-15, M-20 | Bucket sum equals flat subscription balance after grant/consume/reverse/expire, asserted by test |
| A4 | Read the balance inside the subscription-grant transaction | M-18 | Two concurrent grants produce a chained ledger |
| A5 | Infrastructure renewal + expiry sweep on a cron | M-26 | A paid infra plan is charged monthly; a lapsed one stops |
| A6 | Wire the seven unenforced entitlement ops | M-22 | Each op has a call site and a 402 test |
| A7 | Persist downgrade read-only marking | M-23 | Growth→Starter leaves 3 businesses read-only and reversible on upgrade |
| A8 | Schedule webhook recovery; fix the stale comment | M-31 | A failed event self-heals within an hour |

### Phase B — The price book (the actual migration)

| # | Item | Findings |
|---|---|---|
| B1 | `price_book_versions` + `resolvePlan()` + Zod-validated fallbacks | M-01, M-02, M-07 |
| B2 | Migrate `PLAN_PRICING`, `PROVISIONAL_MONTHLY_CREDITS`, `PLAN_BASE`, packs, rewards into v1 | M-01 |
| B3 | Admin editor: draft → diff → validate → publish → rollback | M-28, M-29 |
| B4 | Product mapping as data; provisioning as a recorded action | M-05, M-42 |
| B5 | Effective dating + `configVersion` propagation | M-30 |
| B6 | All surfaces read `resolvePlan()`; delete the client fallback | M-40 |
| B7 | Terms page renders from the price book (+ a test) | M-39 |
| B8 | Remove "provisional" from customer copy once grants are ratified | M-03, M-35 |

### Phase C — Lifecycle completion

| # | Item | Findings |
|---|---|---|
| C1 | Explicit plan-change operation with proration and atomic bucket transition | M-09, M-10 |
| C2 | Route `subscription.plan_changed` through C1 (or reject it) | M-10 |
| C3 | Grace window + dunning for `past_due` | M-11 |
| C4 | Reactivation / pause / resume | M-13 |
| C5 | Promotions primitive resolved at checkout and recorded on the payment | M-04 |
| C6 | Dispute hold + `dispute.lost` reversal | M-16 |

### Phase D — Financial truth

| # | Item | Findings |
|---|---|---|
| D1 | Provider fee + tax capture; net margin reporting | M-17 |
| D2 | MRR/ARR/ARPU/churn/cohorts | M-33 |
| D3 | Credit liability + deferred revenue | M-34 |
| D4 | Per-plan contribution-margin model; ratify grants | M-35, M-03 |
| D5 | Persist reconciliation snapshots; trend view | M-36 |
| D6 | Finish the legacy `credits` migration; remove the phantom fallback | M-19 |
| D7 | Infra-as-included vs add-on decision, enforced | M-24, M-27 |

### Phase E — Customer surfaces

| # | Item | Findings |
|---|---|---|
| E1 | Invoices/receipts/payment history | M-37 |
| E2 | Billing emails (six templates) | M-38 |
| E3 | Plan-change UI reflecting proration and downgrade consequences truthfully | M-09, M-23 |
| E4 | Explicit admin operation id for adjustments | M-21 |
| E5 | Timing-safe cron secret comparison | M-32 |

**Recommended order of attack:** A1 → A2 → A3 → A4 (correctness of money already moving), then A5 → A6 → A7 (stop the leaks), then B1–B3 (the engine), then the rest. Nothing in B should ship before A1 and A2, because a price book that publishes grants into a system that ignores them per subscriber would make M-06 worse, not better.

---

## 7. Acceptance criteria for the target state

The migration is complete when all of these are true and tested:

1. **One price source.** Grep finds no price literal outside the price book, the code defaults it bootstraps from, and generated legal copy.
2. **Admin can change a price without a deploy.** Publish a new version → `/pricing`, `/settings/billing`, checkout and the terms page all show the new price within one cache probe.
3. **Existing subscribers are unaffected by a publish.** A subscriber on version N keeps version N's price, grant and caps until they change plan.
4. **Rollback works.** Publishing a previous version restores every surface, and the audit log shows both publishes.
5. **Every grant is derived.** No grant amount is read from webhook metadata when a catalog product resolves.
6. **Refunds reverse what was granted** for packs *and* subscriptions.
7. **Buckets and flat fields never diverge** — asserted after grant, consume, reverse, expire and plan change.
8. **Every sold cap is enforced** — businesses, apps, subdomains, domains, infra tier, storage, teams, agents — each with a denial test.
9. **Downgrade is real** — over-limit businesses become read-only, reversible on upgrade, with the customer's selection honoured.
10. **Infra plans renew monthly** and lapse when unpaid.
11. **A failed webhook self-heals** without an operator.
12. **The business can read MRR, credit liability, deferred revenue and per-plan margin** from the admin console, each with a stated method.
13. **A customer can see what they paid** and receives an email for every money event.
14. **No customer-facing copy says "provisional"**, and terms match the price book.
15. **The 12 invariants in §2 still hold**, with their existing tests unchanged and green.

---

## 8. Test plan for the migration

Existing coverage is strong where the money moves (22 billing test files, ledger grant/reversal/expiry, webhook recovery, refunds, reconciliation, checkout return, currency, consume planning). New tests needed, by risk:

| Risk | Test |
|---|---|
| Publish changes an existing subscriber | Pin a subscription to v1, publish v2, renew → assert v1 grant |
| Proration double-grants | Upgrade mid-cycle → assert exactly one purse's worth of credits |
| Refund on subscription | Renewal → refund → assert credits removed once, replay is a no-op |
| Bucket drift | Property test: random sequence of grant/consume/reverse/expire → bucket sum == flat field, always |
| Ledger chaining | Two concurrent subscription grants → `before[n] == after[n-1]` |
| Enforcement gaps | One denial test per entitlement op at its route |
| Downgrade | Growth(4)→Starter(1) → 3 read-only; upgrade back → all active |
| Infra renewal | Two monthly sweeps → two charges, not one, not three |
| Config propagation | Publish → every surface reads the new version within one probe |
| Terms ⊆ catalog | Parse the terms page prices, compare to the price book |

Keep the existing suites as the regression fence: they encode the invariants in §2 and must pass unchanged.

---

## 9. Appendix

### A. Environment drift (`.env.example` vs code)

`.env.example` lists `DODO_PRODUCT_PERM_50K / 100K / 300K / 600K` — none of which exist in the code, which reads `DODO_PRODUCT_PERM_200K / 500K / 1M / 5M / 15M` (`config.ts:239-245`). It also omits `DODO_COMMERCIAL_PRODUCT_EXPLORER` and `DODO_COMMERCIAL_PRODUCT_ENTERPRISE`, both of which the code reads through `commercialProductEnvVar` (`commercial-plans.ts:52-58`). An operator following `.env.example` would provision the wrong pack products and leave two commercial plans unbound.

### B. Documented-vs-actual drift

| Doc claim | Reality |
|---|---|
| `catalog.ts:41` "overridable per-plan via admin app_settings (setPlanCreditAllocation)" | function does not exist |
| `migrate/route.ts` "the flag stays off until the migration is [run]" | flag defaults ON (`require.ts:22`) |
| `webhooks/route.ts` "the repository has no cron/job substrate" | `vercel.json` schedules four crons |
| `billing-types.ts` `pricingVersion` / `entitlementVersion` → `plan_catalog_versions` | collections exist only in `docs/ATAI_PHASE2_ARCHITECTURE_DESIGN.md` |
| `docs/CREDIT_SYSTEM.md` / `DATABASE_SCHEMA.md` | predate the commercial catalog; treat as historical |

### C. File index (authoritative paths)

**Catalog:** `lib/billing/config.ts`, `lib/billing/entitlements/{catalog,commercial-plans,types,service,require,downgrade,migrate,migration-map,annual-scheduler}.ts`, `lib/infrastructure/plans.ts`
**Money movement:** `lib/billing/{credit-service,consume-plan,activate-subscription,build-auth,credit-sweep,runtime-config,dodo-service,dodo-webhook,dodo-event-processing,webhook-recovery}.ts`
**Routes:** `app/api/billing/{checkout,webhook,overview,upgrade-options,subscription/cancel}`, `app/api/admin/billing/**`, `app/api/admin/dodo-products`, `app/api/admin/users/[id]`
**Reporting:** `lib/finances/{reconciliation,revenue-accounting,platform-finances,net-position,dodo-earnings}.ts`
**UI:** `app/pricing/page.tsx`, `components/billing/{pricing-plan-grid,plan-card,checkout-button,plan-change-dialog,cancel-subscription-button}.tsx`, `app/settings/billing/page.tsx`, `app/terms/page.tsx`
**Admin UI:** `app/admin/billing/**`, `app/admin/dodo-products/page.tsx`, `components/admin/admin-nav-config.ts`
**Schema:** `lib/types/db.ts`, `lib/billing/billing-types.ts`, `lib/db/collections.ts`

### D. Verification log

Verified by reading and grepping this tree on 2026-11-21: every finding above cites a file that was read in full or in the cited region; every "no caller" claim was checked with a repo-wide grep excluding tests and `node_modules`; every "defaults to" claim was read from the constant's definition.

**Not verified (outside this repository):** the live Dodo dashboard configuration (which products exist, in which mode), whether the `DODO_*` environment variables are set in Vercel, and any production data (actual subscription counts, balances, or reconciliation findings). Conclusions about revenue impact are therefore stated as mechanism, not as measured loss.

---

*Read-only audit. No code, config, schema or data was modified.*
