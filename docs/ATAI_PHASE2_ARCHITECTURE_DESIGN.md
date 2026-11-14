# Atai — Phase 2: Pricing, Subscription & Entitlement Architecture Design

**Type:** Read-only architecture & design package (Phase 2 of the Atai Pricing spec)
**Date:** 2026-11-14
**Input:** Phase 1 Readiness Report (this repo, `docs/ATAI_PRICING_PHASE1_READINESS_REPORT.md`)
**Scope:** Architecture only. No source code, configuration, database records, schemas, Dodo products, or billing settings were modified.
**Status:** Proposed for review. **Do not begin Phase 3 (implementation) until this package is explicitly approved.**

---

## 1. Executive summary

Phase 1 concluded the platform is **NOT READY** to ship the new commercial spec: the billing/credit/Dodo/Runtime core is production-grade and reusable, but the plan catalog, centralized entitlements, subscription migration, and infrastructure limits are missing or partially built.

Phase 2 resolves the *architecture* so that implementation can proceed without breaking existing customers, billing, credits, or infrastructure. The core decisions:

1. **Preserve the protected core.** The credit ledger, Dodo webhook pipeline, and Runtime metering are treated as protected infrastructure and are extended, never replaced (Phase 1 hard rule #4).
2. **Build one centralized entitlement service** as the single authority for "what can this account do," consumed by every route, job, runtime endpoint, and server action.
3. **Do not rename legacy plan IDs in Dodo.** Existing subscriptions keep their `planId`/`dodoProductId` for renewal resolution. A new `commercialPlanId` + `entitlementVersion` + `entitlementSnapshot` layer maps legacy subscriptions to the new entitlement model. This is the key migration safety mechanism.
4. **Reconcile the two plan systems via a hybrid model (Option C).** The account subscription defines the *ceiling* (max projects, max infra tier, max domains, AI tier, etc.); the existing project-level infrastructure plans become the *actual provisioned allocation within that ceiling*, defaulting to the plan's included tier and optionally purchasable as add-ons. The name collision is resolved by renaming the infrastructure-tier identifiers to a non-overlapping namespace (`infra_testing`, `infra_basic`, …) at implementation time, decoupled from the subscription plan IDs.
5. **Explorer planning-only credits** are enforced by adding a scoped `planning` credit bucket type with an allowlist/denylist of operation scopes, reusing the existing bucket + consumption-order machinery. Production operations are tagged and rejected when only a planning bucket is available.
6. **Annual billing** requires new yearly Dodo products (created by admins, out of Phase 2 scope to execute) plus a monthly credit-issuance scheduler service keyed by subscription+month with full idempotency and missed-run recovery.
7. **Grandfathering is explicit and data-preserving.** Every migrated/existing subscriber retains an entitlement snapshot; future pricing changes cannot silently rewrite their benefits.

**Verdict of this phase:** the architecture is *design-complete and implementable*. The remaining unknowns are commercial (exact credit allocations, exact hosting/DB/storage quotas, registrar selection, support SLAs) and are flagged in §Unresolved Decisions — they are intentionally left undecided per the spec's hard rules #1 and #3.

---

## 2. Architecture findings (what the codebase actually is)

Verified against source during this phase (read-only):

- **Plan catalog** (`lib/billing/config.ts:98-253`): six plans `free / explorer($12) / starter($79) / business($139, popular) / professional($219) / enterprise($499)` — all `interval:"monthly"`, credit-quantity tiers + free-text `features`. No `Growth`/`Scale`. `explorer` is *paid* and advertises production builds.
- **Subscription record** (`lib/billing/billing-types.ts:126-153`): `planId, planName, priceUSD, mirrorCredits, status, currentPeriodStart/End, nextBillingDate, cancelAtPeriodEnd, cancelledAt, expiredAt, metadata`. **No** migration/grandfather/entitlement-version fields.
- **Project creation** (`lib/projects/create-project.ts:98-233`): no plan check; only `checkRateLimit` 10/hr. No `businessId`; a project *is* the business. Confirmed no `businesses` collection.
- **Infrastructure plans** (`lib/infrastructure/plans.ts:13-93`): `testing/basic/starter/pro/business/enterprise`, project-level, credit-purchased, with `storageBytes`, `AtaiPrice`, `totalumInfrastructureCredits`. Already admin-price-configurable (`getInfrastructurePlanWithRuntimePrice`). Name collision with subscription plans confirmed.
- **Dodo integration** (`lib/billing/dodo-service.ts`, `dodo-event-processing.ts`, `dodo-webhook.ts`): webhook signature verification + idempotency are solid; renewal resolves plan by `planId`; `subscription.plan_changed` only rewrites 4 fields (no proration/credit re-grant). Month interval hardcoded.
- **Entitlement enforcement:** absent at every layer except credit balance + HTTP rate limits.
- **Storage enforcement:** `checkStorageLimit` (`lib/infrastructure/service.ts:344-352`) has zero callers; `storageUsedBytes` has no writer → `overQuota` permanently false. Hosting is a `ComingSoonPage` stub.
- **Credit ledger / Runtime metering:** production-grade, reusable (per Phase 1).

---

## 3. Recommended target architecture

```
                         Dodo webhooks (verified, idempotent)
                                       │
                                       ▼
                    ┌──────────────────────────────────┐
                    │  SubscriptionRecord (extended)    │  LEGACY planId preserved
                    │  + commercialPlanId               │  for Dodo renewal
                    │  + entitlementVersion             │
                    │  + entitlementSnapshot            │
                    │  + pricingVersion                 │
                    │  + grandfatheredAt                │
                    └──────────────────────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────┐
                    │   Plan Catalog (versioned, DB)   │  NEW: replaces hard-coded
                    │   (Explorer/Starter/Growth/      │  SUBSCRIPTION_PLANS for
                    │    Scale/Enterprise)             │  entitlement computation
                    └──────────────────────────────────┘
                                       │
                                       ▼
        ┌──────────────────────────────────────────────────────────┐
        │              ENTITLEMENT SERVICE  (single authority)      │
        │  resolveEntitlements(userId) -> EntitlementSet            │
        │  • account/workspace  • credits/AI  • hosting/infra       │
        │  • domains  • BI  • marketing  • education  • agents  • support
        └──────────────────────────────────────────────────────────┘
                  ▲                                   ▲
   consumed by    │                                   │   caches (TTL + invalidation
   every:         │                                   │   on webhook/grant events)
   • API routes   │                                   │
   • server actions                                   │
   • background jobs                                   │
   • runtime endpoints                                 │
   • build/deploy/infra/domain/AI/marketing/SEO/…      │
                                       │
                                       ▼
        ┌──────────────────────────────────────────────────────────┐
        │  Enforcement layer (server-side, per-operation guards)     │
        │  authorize(op) -> { allowed, reason, auditEvent }          │
        └──────────────────────────────────────────────────────────┘
                                       │
                                       ▼
        ┌──────────────────────────────────────────────────────────┐
        │  Existing protected core (EXTEND, never replace):         │
        │   credit ledger • Dodo pipeline • Runtime metering        │
        │   • infra plans (renamed namespace) as provisioned alloc  │
        └──────────────────────────────────────────────────────────┘
```

**Key principle:** the frontend NEVER computes or trusts plan state. It renders from a server-provided entitlement projection. The entitlement service is the only place plan IDs, prices, and allowances are interpreted.

---

## DELIVERABLE A — Executive architecture decision report

See §1 (executive summary) and §3 (target architecture). Additional decisions:

- **Major decision: legacy plan IDs are never renamed in Dodo.** Migration maps rather than renames, so renewals and credit grants keep working. (See Deliverable E.)
- **Major decision: hybrid entitlement model (Option C).** (See Deliverable D.)
- **Critical risk:** free/Explorer capability inversion — current `free` users can build/deploy; new `Explorer` cannot. Must be grandfathered, not silently reduced. (See Deliverable E, R-section.)
- **Critical risk:** any rename of `business`/`professional`→`growth`/`scale` without migration breaks live renewals. Mitigated by §E.
- **Dependencies:** Phase 4 must complete the cost model *before* final credit allocations are set (hard rule #1). Registrar selection + yearly Dodo products are prerequisites for Scale domains + annual billing but are execution tasks, not architecture blockers.

---

## DELIVERABLE B — New plan catalog specification

Stable identifiers (`planId`) are lowercase, stable, and **distinct from infra-plan identifiers**:

| planId | Name | Monthly | Annual | Interval support | Popular |
|---|---|---:|---:|---|---|
| `explorer` | Explorer | Free | Free | n/a | — |
| `starter` | Starter | $89.99 | $989.89 | monthly + yearly | — |
| `growth` | Growth | $199.99 | $2,199.89 | monthly + yearly | **YES (flagship)** |
| `scale` | Scale | $499.99 | $5,499.89 | monthly + yearly | — |
| `enterprise` | Enterprise | Custom | Custom | contract | — |

> **NOTE on identifier reuse:** the current `explorer` id is a *paid $12* plan. To avoid confusing Dodo mappings, the new free `explorer` should get a **new Dodo product id** (`DODO_PRODUCT_EXPLORER_V2`) while legacy paid `explorer` subscribers retain their legacy `planId` until migrated (Deliverable E). The `planId` *string* in our DB can be reused only because legacy paid-explorer subscribers are grandfathered under a distinct legacy id (`legacy_explorer`).

**Numeric allowances — approved vs. pending financial model:**

| Entitlement | Explorer | Starter | Growth | Scale | Enterprise |
|---|---|---|---|---|---|
| Max businesses/projects | 0 (planning only) | 1 | 4 | Unlimited* | Negotiated |
| Production apps | 0 | 1 | Expanded** | Expanded** | Negotiated |
| Free Atai subdomain | 0 | 1 | 1 (incl.) | 1 (incl.) | Negotiated |
| Custom domain registration | 0 | 0 | 1 (yr 1) | 4 (yr 1) | Negotiated |
| Production DB | No | Standard | Expanded | Highest std | Negotiated |
| Hosting | No | Standard | Expanded | Premium | Negotiated |
| Storage | No prod storage | Standard | Expanded | Higher | Negotiated |
| Monthly credits | 500 planning-only | **PENDING** | **PENDING** | **PENDING** | Negotiated |
| AI Co-founder tier | Limited | Core | Advanced | Premium | Custom |
| Specialist teams | — | Core | Expanded | Premium + customization | Custom |
| Agents (Start/Scout/Optimize) | No | No | No | Yes*** | Custom |
| Competition intel (monitoring) | Research only | No | Yes | Yes | Custom |
| Marketing automation | No | No | No | Yes*** | Custom |
| Knowledge base | No | No | No | Yes*** | Custom |
| Membership/learning paths | Selected | Selected | Full | Full + customization | Custom |
| Support | Community | Standard | Direct/priority | Premium | Dedicated |
| Compute priority | No | No | No | Yes (where supported) | Custom |

\* Subject to fair-use and infrastructure ceilings (NOT unlimited infra).
\*\* "Expanded" = the plan's provisioned infra tier (Deliverable D), TBD exact quota by cost model.
\*\*\* **Implementation status flag (hard rule #3):** Agent Start/Optimize, continuous app improvement, marketing automation, and knowledge base are **ABSENT/UNVERIFIED** in code. The catalog records them as entitlement *slots* but the pricing page MUST NOT advertise them as available until Phase 6–7 implements and verifies them. Recommended: gate these behind an `available: false` capability flag consumed by both the entitlement service and the pricing UI.

All `PENDING` numeric values are resolved by Deliverable J (financial model) before launch.

---

## DELIVERABLE C — Centralized entitlement architecture

**Service responsibilities:**
- `resolveEntitlements(userId): Promise<EntitlementSet>` — authoritative computation.
- `authorize(userId, op: EntitlementOp): Promise<{allowed, code?, reason?, audit}>` — per-operation guard.
- `getEntitlementProjection(userId)` — server-provided object the frontend renders (no logic).
- `invalidateEntitlements(userId|subscriptionId)` — called on webhook/grant/downgrade events.

**EntitlementSet schema (proposed):**

```ts
type EntitlementOp =
  | "createProject" | "forkProject" | "buildProduction" | "deploy"
  | "provisionDatabase" | "useStorage" | "connectSubdomain" | "registerCustomDomain"
  | "useAICofounder" | "useSpecialistTeam" | "useAgent" | "useCompetitionIntel"
  | "useMarketingAutomation" | "publishSocial" | "useSEO" | "useKnowledgeBase"
  | "accessLearningPath" | "accessBI" | "accessAds"

interface EntitlementSet {
  planId: string                 // commercialPlanId (new) OR legacy-mapped
  planTier: "explorer"|"starter"|"growth"|"scale"|"enterprise"
  legacyPlanId?: string          // original Dodo-linked id, if grandfathered
  entitlementVersion: string
  businesses: { max: number | "unlimited"; current: number }
  productionApps: { max: number | "unlimited"; current: number }
  subdomains: { max: number; current: number }
  customDomainsIncluded: { max: number; consumed: number; renewalsTracked: string[] }
  infra: {
    maxTier: InfraTierId        // ceiling permitted by this plan
    defaultTier: InfraTierId    // auto-provisioned per project
    storageBytes: number        // alias of defaultTier cap
    computePriority: boolean
  }
  credits: {
    monthlyGrant: number | "pending"   // PENDING until financial model
    planningOnly: number               // explorer = 500
    consumptionOrder: ["subscription","permanent"]
    fairUseMonthlyCap?: number
  }
  ai: {
    cofounderTier: "limited"|"core"|"advanced"|"premium"
    teams: "none"|"core"|"expanded"|"premium"
    teamCustomization: boolean
    agents: { start: boolean; scout: boolean; optimize: boolean } // capability flags
  }
  marketing: { seo: boolean; content: boolean; ads: boolean; automation: boolean; socialPublish: boolean }
  bi: { financial: boolean; analytics: boolean; competitionMonitoring: boolean; multiBusiness: boolean; customerInsights: boolean }
  education: { paths: boolean; lessons: "selected"|"full"; playbooks: boolean }
  support: "community"|"standard"|"direct"|"priority"|"premium"
}
```

**Caching & invalidation:** in-memory/Redis cache keyed by `${subscriptionId}:${updatedAtHash}`, TTL 60s. Invalidated on: Dodo webhook events (`subscription.*`, `plan_changed`), credit grant/expire, admin entitlement change, explicit `invalidateEntitlements`. Cache misses recompute from the extended `SubscriptionRecord` + `plan_catalog_versions` + `entitlement_versions`. **Trust:** computed only from server-side `SubscriptionRecord`; never from client payloads.

**Error behavior:** `authorize` returns `{allowed:false, code:"ENTITLEMENT_DENIED", reason}` → API returns 402/403 with machine-readable code; frontend shows upgrade CTA. Every denial emits an audit event (see Deliverable K).

**Security:** the entitlement service is the *only* interpreter of plan state. All plan/price/credit values in client requests are ignored. Existing Dodo signature verification + idempotency are preserved.

---

## DELIVERABLE D — Existing infrastructure-plan reconciliation

**Problem:** account subscriptions (`config.ts`) and project infrastructure plans (`plans.ts`) are two systems with colliding names (`starter`, `business`, `enterprise`) and different semantics.

**Evaluated options:**

- **Option A (subscription determines infra directly):** Simplest mentally, but destroys the existing credit-purchased per-project upgrade path and forces every project to the same tier. Poor for customers who want a higher-tier project on a lower plan. High migration risk to existing infra allocations.
- **Option B (subscription baseline + separate infra add-ons):** Preserves existing infra plans as purchases, but leaves "what does my plan include?" ambiguous and risks customers paying twice. Admin complexity high.
- **Option C — HYBRID (RECOMMENDED):** The account subscription sets the **ceiling** (max infra tier reachable, max projects, max domains, AI tier). The project-level infrastructure plan becomes the **actual provisioned allocation within that ceiling**, auto-defaulting to the plan's included tier and remaining available as an *optional paid upgrade* up to the ceiling.

**Justification for C:**
- Preserves working infra provisioning + Totalum cap (`service.ts:72-92`) with minimal change.
- Resolves name collision by renaming infra identifiers to a disjoint namespace (`infra_testing`, `infra_basic`, `infra_starter`, `infra_pro`, `infra_business`, `infra_enterprise`) and mapping each subscription plan to a `defaultTier` + `maxTier`:

| Subscription plan | defaultTier | maxTier (upgrade ceiling) |
|---|---|---|
| explorer | — (no prod) | none |
| starter | infra_starter | infra_starter |
| growth | infra_business | infra_business (+1 custom-domain reg) |
| scale | infra_enterprise | infra_enterprise |
| enterprise | custom | custom |

- Customer experience: Starter gets standard hosting/DB automatically; Growth gets expanded; Scale gets highest — exactly the spec. Power users on lower plans can still buy an infra upgrade up to the plan ceiling.
- Billing: subscription price covers the included tier; optional infra upgrades remain credit-purchased (existing flow).
- Fair-use: Scale "unlimited businesses" still bounded by per-project infra ceilings and `fairUseMonthlyCap`.
- Migration: existing project infra plans keep working; new subscriptions simply set `defaultTier` automatically at first build.

**No existing customer infra allocation is deleted** — the infra collection and `applyTotalumCap` flow continue; only the *naming* and the *subscription→tier mapping* are added.

---

## DELIVERABLE E — Legacy subscription migration plan

**Legacy → commercial mapping proposal (do NOT blindly equate):**

| Legacy id | Legacy price | Legacy credits | Proposed commercial | Rationale |
|---|---|---|---|---|
| `free` | $0 | 500 perm (unrestricted) | `explorer` (free, planning-only) | **Capability DOWNGRADE** → must grandfather |
| `explorer` (paid) | $12 | 50k perm | `starter` (capability-equivalent builder) | Price jump → grandfather price |
| `starter` | $79 | 300k | `starter` ($89.99) | Same name; minor price change → grandfather price |
| `business` ($139, popular) | $139 | 600k | `growth` ($199.99) | Closest builder; extra entitlements (4 biz, domain) are a bonus; price change → notify |
| `professional` | $219 | 1.4M | `scale` ($499.99) | Closest high tier; price change → notify |
| `enterprise` | $499 (fixed) | 5M | `enterprise` (custom) | Keep $499 grandfathered until renegotiated |

**Critical safety rule:** **never rename the stored `planId` that Dodo uses.** Instead extend `SubscriptionRecord`:

```ts
interface SubscriptionRecord { // EXTENSION only
  // …existing fields…
  commercialPlanId: string      // new canonical id (explorer/starter/growth/scale/enterprise)
  legacyPlanId: string          // original id for Dodo renewal resolution
  entitlementVersion: string    // references entitlement_versions
  entitlementSnapshot: EntitlementSet   // frozen at migration/activation
  pricingVersion: string        // references plan_catalog_versions
  grandfathered: boolean
  grandfatheredUntil?: number   // e.g., keep old price until next renewal
  migratedAt?: number
  migrationBatchId?: string
}
```

Renewal credit grants read `entitlementSnapshot.credits.monthlyGrant` (or legacy `mirrorCredits`), **not** the new catalog, so existing subscribers keep their grant amounts. `commercialPlanId` drives the *new* entitlement computation (capabilities), while `legacyPlanId` + Dodo product id drive renewal. If `commercialPlanId` is absent (not yet migrated), a resolver maps `legacyPlanId → commercialPlanId` via a static map and applies grandfathering.

**Customer classification & handling:**
1. Active subscribers → migrate in place, preserve `legacyPlanId`, snapshot entitlements, keep price via `pricingVersion`.
2. Cancelled (cancelAtPeriodEnd) → migrate; on period end, entitlement expires normally.
3. Expired → migrate record only; no active grant.
4. Free accounts → convert to `explorer`; **grandfather existing built projects + 500 credits** so they are not silently reduced (see R-section). New free signups get planning-only Explorer.
5. Permanent credit balances → untouched (separate buckets).
6. Active subscription credit buckets → untouched until natural expiry; new grants follow snapshot.
7. Multiple existing projects → counted against new cap; if over cap (e.g., legacy user with 3 projects downgraded to Starter=1), apply downgrade-preservation (Deliverable G), not deletion.
8. Project infra-plan users → infra collection unchanged; `defaultTier` applied going forward.
9. Custom domains → preserved; renewal tracked.
10. Historical billing records → read-only, never rewritten.

**Migration sequence (idempotent, reversible, auditable, testable):**
1. Create `plan_catalog_versions` + `entitlement_versions` collections (new, versioned).
2. Backfill `commercialPlanId`, `legacyPlanId`, `entitlementVersion`, `entitlementSnapshot`, `pricingVersion` on all `subscriptionRecords` via a **dry-run** script that reports counts per mapping and any `UNMAPPED` rows.
3. Reconcile: every legacy id must map; zero `UNMAPPED` before production run.
4. Production run uses the same idempotent writer (re-running is a no-op where fields already set).
5. Verify: sample renewals resolve; no `missing_plan`/`unresolved` events; credit grants match snapshot.
6. Rollback: the extension is additive — setting `commercialPlanId=legacyPlanId` and ignoring new fields restores old behavior; no destructive step.

**Dry-run & reconciliation:** a read-only report enumerates per-legacy-plan counts, projected commercial plan, price delta, credit delta, and flags any subscriber whose new entitlement would be *lower* than legacy (these require explicit product-owner approval, not silent reduction).

---

## DELIVERABLE F — Annual billing architecture

**Annual product representation:** each paid plan needs **two Dodo products**: a monthly and a yearly (interval = year, price = $989.89 / $2,199.89 / $5,499.89). Creation is an admin/Dodo-console task (not Phase 2). `dodo-service.ts` must be extended to emit `subscription_period_interval: "Year"` for yearly checkouts (currently hardcoded `"Month"`).

**Monthly credit issuance for annual subscribers:** a `credit_issuance_schedule` collection:

```ts
{ subscriptionId, userId, year, months: [{ month: 1..12, dueDate, status: "pending"|"granted"|"failed", grantIdempotencyKey, grantedAt }] }
```

A scheduler service (new; Phase 3 implements) runs daily:
- For each annual sub with a `pending` month whose `dueDate <= now`, issue the monthly grant using `sub_grant_<subId>_period_<year>-<month>` idempotency key (reuses `grantSubscriptionCredits` with `expiresAt` = month end).
- **Missed execution:** the daily sweep catches any past-due pending month on the next run → customer is never permanently deprived.
- **Duplicate execution:** idempotency key makes a second attempt a no-op.
- **Delayed webhook / downtime:** recovery worker reprocesses; `webhook-recovery.ts` pattern reused.
- **Cancellation:** stop scheduling future months at `currentPeriodEnd`; already-granted months remain.
- **Payment failure:** mark month `failed`, alert, do not grant; standard dunning applies.
- **Renewal:** new 12-month schedule created on `subscription.renewed`.
- **Time zones:** store `dueDate` as UTC epoch; compute month boundaries in UTC.

Annual billing does **not** provide unrestricted usage; each monthly grant expires per normal rules (hard rule: annual = 11 payments for 12 months, credits issued monthly).

---

## DELIVERABLE G — Downgrade and upgrade lifecycle

**Upgrade (immediate vs scheduled):**
- Same-interval upgrade (e.g., Starter→Growth, monthly): activate immediately on verified Dodo `subscription.plan_changed`/`active`; compute new `entitlementSnapshot`; grant prorated? **Recommend: no proration of credits** — new monthly grant begins next period; existing subscription credits remain until expiry. Infrastructure `defaultTier` upgrades on next build. Included custom domain benefit becomes available immediately (Growth/Scale). Communicate clearly.
- Monthly→Annual or Annual→Monthly: handled as plan change with interval; preserve paid-through period; reissue schedule for annual.
- Dodo sync: use the verified `plan_changed`/`active` event as the single trigger; never trust client.

**Downgrade safeguards (must never delete data):**
1. On a verified downgrade event, compute `overLimit = currentBusinesses - newMax`.
2. **Before** applying, present a confirmation UI listing: which businesses are over limit, that data/apps are preserved, that only *new* creation is blocked, domain renewal consequences, and infrastructure consequences.
3. Preserve all customer data and applications. Mark over-limit businesses as `status: "preserved_readonly"` (config + data intact; new deploys/resource consumption blocked) rather than deleting.
4. Block new business/project creation beyond the new cap via `authorize("createProject")`.
5. Let the user choose which N businesses stay "active" (for Starter, 1 of 4) or purchase an add-on / upgrade; until they choose, all are preserved read-only.
6. Record the decision + audit event.
7. Domains: included-domain registrations remain owned by customer; renewals communicated. Infrastructure: over-capacity projects throttled to new `maxTier` (or preserved at old tier if grandfathered).
8. Do **not** auto-suspend production apps without explicit policy + warning.

**Examples:**
- Growth(4 businesses) → Starter(1): 3 businesses flagged `preserved_readonly`; user picks 1 active or buys add-on; no deletion.
- Scale → Growth: domains beyond 1 become "pay-to-keep" (renewal cost) but remain owned; businesses >4 preserved read-only.
- Cancellation / expired / failed payment: entitlement expires at `currentPeriodEnd`; data preserved; projects switch to read-only/no-new-consumption, matching existing `handleExpiration` pattern (`service.ts:275-329`).

---

## DELIVERABLE H — Infrastructure entitlement design

- **Project limits:** `authorize("createProject")` counts owned non-deleted projects (including forks and archived — archive does NOT free a slot; only explicit delete, which is warned, frees one). Counted atomically within the project-creation transaction to prevent race bypass.
- **Hosting:** replace the `ComingSoonPage` stub with a real allocation tied to `infra.defaultTier`. Hosting eligibility + count enforced server-side.
- **Database:** per-project Totalum DB already provisioned; bind its cap to the subscription's `defaultTier`/`maxTier` rather than a separate purchase for included plans.
- **Storage:** **fix the dead code** — implement a real `storageUsedBytes` writer (on upload/deploy/DB ops) and wire `checkStorageLimit` into the write path; enforce against `infra.defaultTier.storageBytes`. Until the writer exists, no quota is trustworthy (per Phase 1).
- **Subdomains:** provision Atai-owned domain (e.g., `*.atai.app`) — DNS wildcard + automated SSL; `connectSubdomain` checks `subdomains.current < subdomains.max` and prevents collisions. Totalum's `*.totalum-project.com` does NOT satisfy the commercial "free Atai subdomain" requirement.
- **Custom domain registration:** current flow is BYO DNS only (`domain/route.ts:15-67`) — **not** registration. Registration requires a **registrar integration** (Namecheap / Cloudflare Registrar / Gandi). Design the `domain_entitlements` lifecycle: `eligibleTLDs`, `registrationCost`, `renewalCost`, `ownership`, `transfer`, `expiry`, `refundOnFailure`, `includedConsumed`. BYO DNS remains as "connect your own domain" (uncounted against included registrations). Registrar selection is an **unresolved decision** (§Unresolved).
- **Fair use:** Scale "unlimited businesses" bounded by per-project infra ceilings + `fairUseMonthlyCap` (a soft credit ceiling). Excess → throttling or paid add-on, never silent unlimited consumption.

---

## DELIVERABLE I — Administrative management design

Extend the existing DB-driven `app_settings` model (already used by `runtime-config.ts`) with a **versioned `plan_catalog_versions`** document:

```ts
{
  version: "PCAT_v2",
  effectiveAt: number,
  plans: { [planId]: { name, priceUSD, annualUSD, intervalSupport, visibility, entitlements: EntitlementSet-partial, flags:{agentsAvailable, automationAvailable,...} } },
  createdBy, createdAt, status: "draft"|"published"|"rolledback"
}
```

- **Versioning:** new subscribers use `latestPublished`; existing subscribers keep their `pricingVersion` snapshot. A pricing change cannot alter a grandfathered subscriber.
- **Admin UI:** form to edit prices, intervals, visibility, entitlements, credit allocations (once financial model approves them), AI/marketing/learning/support tiers, fair-use.
- **Preview before publish:** admins see a diff + projected impact (how many subscribers affected, any whose entitlements would *decrease* → flagged for approval).
- **Validation:** reject zero/unlimited where inappropriate (e.g., cannot set `maxBusinesses` to `unlimited` for non-Scale; cannot set credits to 0 for a paid plan without explicit override confirm).
- **Audit log:** every change → `admin_audit_log` (actor, before, after, timestamp, reason).
- **Rollback:** publish flips `status`; rollback reactivates previous published version; no record is destroyed.
- **RBAC:** admin role required; high-impact changes require a second confirmation.

---

## DELIVERABLE J — Financial model requirements

**Do NOT set final credit allocations here** (hard rule #1). Define the model Phase 4 implements.

**Required cost inputs per plan (sources already partially available: `lib/finances/project-economics.ts`, `lib/runtime/control/breakdown.ts`, `runtime_usage`, `credit_ledger`):**
- AI provider cost (per model, tokens) — from `runtime_usage.providerCostUsd`
- Firecrawl / external research cost
- Hosting cost (per infra tier)
- Database cost (per tier)
- Storage cost (per GB)
- Bandwidth (where measurable)
- Build infrastructure cost
- Dodo transaction fees (percentage + fixed)
- Tax reserve **15%**
- Refund exposure (historical rate)
- Support cost (per-tier estimate)
- Operational overhead allocation

**Scenarios:** normal / heavy / expensive (e.g., agent-heavy Scale user). For each plan compute:
`Gross revenue → −payment fees → −tax reserve → −infra → −AI/API → −support → Contribution margin ($ and %)`. Derive **break-even usage** and **sustainable monthly credit allocation** per plan.

**Separation:** third-party advertising spend is NOT Atai revenue — keep ad budgets distinct from subscription margin.

**Approval:** admins review the model output, set `credits.monthlyGrant` per plan in `plan_catalog_versions`, with the rationale recorded. Allocations remain admin-configurable post-launch.

---

## DELIVERABLE K — Security and testing strategy

**Threat analysis (mitigations):**
- Client-side plan manipulation → all plan state server-side; client values ignored. ✔ (entitlement service is authority)
- Forged plan/credit IDs → Dodo-verified events only update entitlements; client requests carry no entitlement fields.
- Unauthorized project creation → `authorize("createProject")` in creation transaction.
- Fork-based limit bypass → forks counted as projects; same guard.
- Runtime entitlement bypass → Runtime endpoints call `authorize` via the same service.
- Replay / duplicate webhook → existing signature + idempotency preserved.
- Concurrent credit consumption → existing `withTransaction` + idempotency keys.
- Concurrent project creation → count+insert in one transaction (or `findAndModify` counter).
- Stale subscription cache → TTL + event-driven invalidation.
- Expired access → `currentPeriodEnd` checked; grace handled explicitly.
- Unauthorized admin config → RBAC + audit + confirmation.
- Incorrect grandfathering → `entitlementSnapshot` frozen at migration; reconcvalidation.
- Duplicate monthly grants → idempotency key per month.
- Missing credit expiration → scheduler + recovery (F).

**Test scenarios (Phase 9 implements):**
- Plan resolution: all 5 types, unknown id, missing config, historical version, grandfathered.
- Authorization: Explorer prod-block; Starter 1-business; Growth 4-business; Scale fair-use; runtime/domain/infra limits.
- Concurrency: simultaneous creation; concurrent credit consumption; duplicate grants; duplicate webhooks.
- Billing: monthly; annual; renewal; failed payment; cancellation; upgrade; downgrade; refund; delayed webhook; recovery.
- Preservation: existing apps/projects/permanent credits/subscription buckets/infra allocations/domains/grandfathered price.
- Security: forged client plan IDs; unauthorized admin; API/runtime entitlement bypass; fork bypass.

---

## DELIVERABLE L — Phased implementation roadmap

- **Phase 2 (this):** architecture + migration design. *Done — pending approval.*
- **Phase 3 — Billing & Dodo:** yearly Dodo products; `dodo-service` interval support; in-place plan-change route with proration policy; user invoice/receipt/payment history; billing notifications; reconcile infra naming. *Files: `dodo-service.ts`, `dodo-event-processing.ts`, `checkout/route.ts`, new `subscription/change/route.ts`, `app/api/billing/invoice/*`. DB: extend `SubscriptionRecord`.*
- **Phase 4 — Credits & cost model:** build financial model (J); set allocations via `plan_catalog_versions`; Explorer planning-only bucket (scope gate); proactive expiry scheduler; annual monthly-issuance scheduler (F); fair-use caps. *Files: `credit-service.ts` (scope gate), `consume-plan.ts`, new `credit-issuance/*`, `runtime-config.ts`.*
- **Phase 5 — Business/project/infra limits:** `authorize` guards in `create-project.ts`, `fork/route.ts`, `build/route.ts`, `deploy/route.ts`, `domain/route.ts`; Atai subdomain provisioning; storage writer + `checkStorageLimit` wiring; hosting allocation; compute priority. *Files: `create-project.ts`, `infrastructure/service.ts`, new subdomain service.*
- **Phase 6 — AI Co-founder/teams/agents:** deep audit `lib/cofounder/`; implement or confirm Agent Start/Scout/Optimize; continuous improvement; knowledge base; plan-gate all AI. Do NOT advertise unfinished features.
- **Phase 7 — Marketing/education/BI:** plan-gate SEO/content/ads/competition/lessons; competition monitoring scheduler; AI BI; multi-business comparison; marketing automation substrate (scheduler/queue/OAuth/publishing); support tiers.
- **Phase 8 — Pricing page & checkout:** new 5-plan page, monthly/yearly toggle, Growth flagship, comparison table, Enterprise separate; annual checkout.
- **Phase 9 — Test/security/financial validation:** regression + security + per-plan margin validation. **Do not release until margin is positive at normal/heavy/expensive scenarios.**

Each phase: own PR, tests, acceptance criteria, rollback (additive schema changes; feature flags for entitlement gating).

---

## Architecture decision records (ADRs)

- **ADR-1:** Preserve credit ledger / Dodo pipeline / Runtime metering. *Rationale:* Phase 1 verified them production-grade; replacing risks billing breakage (hard rule #4).
- **ADR-2:** Never rename legacy Dodo `planId`; extend record + map. *Rationale:* renewal resolution depends on it; rename = broken grants.
- **ADR-3:** Hybrid entitlement model (Option C). *Rationale:* preserves infra provisioning, resolves name collision, matches spec tiers, supports upgrades.
- **ADR-4:** Explorer planning-only via scoped `planning` bucket. *Rationale:* reuses bucket architecture; minimal ledger change; clear operation-scope gate.
- **ADR-5:** All plan/price interpretation server-side only. *Rationale:* eliminates client-trust vulnerabilities.
- **ADR-6:** Grandfather existing subscribers via frozen `entitlementSnapshot`. *Rationale:* no silent reduction; future pricing changes can't rewrite benefits.

---

## Risk register

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | Renaming plan IDs breaks live renewals | CRIT | ADR-2: never rename; map + extend. |
| R2 | `free`→`explorer` capability inversion (build→planning only) | CRIT | Grandfather existing free users' projects + credits; new signups planning-only. |
| R3 | Credit allocations invented w/o cost model | HIGH | Phase 4 financial model gates all `PENDING` values (hard rule #1). |
| R4 | Scale features advertised but absent | HIGH | `available:false` capability flags; pricing UI gated (hard rule #3). |
| R5 | Infra name collision | HIGH | Rename infra ids to disjoint namespace (D). |
| R6 | Dead storage enforcement | MED | Implement writer + wire `checkStorageLimit` (H/Phase 5). |
| R7 | No Atai-owned subdomain | MED | Provision `*.atai.app` (H). |
| R8 | Annual billing absent | MED | Yearly Dodo products + scheduler (F/Phase 3–4). |
| R9 | Concurrent creation bypass | MED | Transactional count+insert (H/Phase 5). |
| R10 | Misleading enforcement copy | MED | Fix `database-terms` copy or implement (Phase 5). |
| R11 | Admin accidental zero/unlimited | MED | Validation + confirmation (I). |

---

## Unresolved decisions requiring product-owner approval

1. **Exact monthly credit allocations** for Starter/Growth/Scale — pending Phase 4 financial model. (Do not set now.)
2. **Exact hosting/DB/storage quotas** per tier — pending cost model + hosting cost data.
3. **Registrar selection** for custom-domain registration (Namecheap / Cloudflare / Gandi) and supported TLD eligibility + renewal pricing.
4. **Support SLAs** (response times) for direct/priority/premium tiers — currently no ticketing system exists.
5. **Grandfathering price policy:** keep legacy prices indefinitely, until next renewal, or align to new on next billing? (Affects revenue; needs commercial decision.)
6. **Proration policy** on upgrades/downgrades (recommend: no credit proration; new grant next period).
7. **Agent Start/Scout/Optimize scope & permissions** — build vs. defer (Phase 6).
8. **Marketing automation substrate** — build scheduler/queue + OAuth, or defer (Phase 7).

---

## Proposed implementation sequence (post-approval)

1. Approve Phase 2 package + resolve §Unresolved items 5–6 (grandfathering/proration) as commercial policy.
2. Phase 3 (billing/Dodo) — non-destructive, builds on protected core.
3. Phase 4 (credits + cost model) — requires financial model sign-off before setting allocations.
4. Phase 5 (limits) — entitlement enforcement goes live behind feature flag.
5. Phase 6 → 7 (AI/marketing) — only advertise what is implemented.
6. Phase 8 (pricing page) — reflects real, enforced entitlements.
7. Phase 9 (validation) — margin + security + regression; release gate.

---

## Final confirmation

- ✅ No source code modified.
- ✅ No application files created, deleted, or renamed.
- ✅ No database records or collections modified (schema extensions are *proposed*, not applied).
- ✅ No migrations run.
- ✅ No subscription configurations, Dodo products, or billing settings changed.
- ✅ No environment variables changed.
- ✅ No pricing pages or frontend components modified.
- ✅ No dependencies installed.
- ✅ No billing/Runtime provider replaced.
- ✅ No code, config, or production data changed.

**This is a design package only. Phase 3 implementation must not begin until this document is explicitly approved by the product owner.**
