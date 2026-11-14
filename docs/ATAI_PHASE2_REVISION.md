# Atai — Phase 2 Architecture Revision (corrected approval package)

**Type:** Read-only architecture revision. **No application code, config, schemas, Dodo products, or billing settings were modified for this revision.**
**Date:** 2026-11-14
**Supersedes:** `docs/ATAI_PHASE2_ARCHITECTURE_DESIGN.md` for the sections listed in §Delta. Unaffected sections of the original remain valid.
**Trigger:** Product-owner review of the Phase 2 package returned 6 issues (2 critical, 2 high, 2 needs-design) plus a set of missing-area clarifications and a requirement to add workspace/team entitlement rules.

**Status of implementation:** A Phase 3 *foundation* (the entitlement service module) was previously built and is **gated OFF** (`ENTITLEMENT_ENFORCEMENT_ENABLED` defaults false). It already implements the corrected legacy-plan handling (Issue 1) and grandfathered-free handling (Issue 2). No further Phase 3 work proceeds until this revised package is approved **and** the migration script + financial model (Phase 4) are in place.

---

## 1. Corrections

### Issue 1 — Legacy `planId` / `explorer` identifier contradiction — CRITICAL

**Problem (in original):** The report suggested renaming an existing paid `explorer` subscriber's id to `legacy_explorer`. That violates the hard rule "never rename the stored `planId` that Dodo uses for renewal."

**Corrected design:**
- The stored `planId` is **preserved exactly** as it exists today (`free`, `explorer`, `starter`, `business`, `professional`, `enterprise`). Never mutated.
- `dodoProductId` (the Dodo product the customer actually purchased) is also preserved on the subscription record (add `dodoProductId?` to `SubscriptionRecord` — additive).
- New, separate fields carry the new model: `commercialPlanId` (new canonical id), `entitlementVersion`, `entitlementSnapshot`, `pricingVersion`, `grandfathered`, `grandfatheredUntil`, `migratedAt`, `migrationBatchId`.
- The legacy paid `explorer` ($12) subscriber keeps `planId: "explorer"` and is mapped via a **resolver** (not a rename) to `commercialPlanId: "starter"`. The new free `Explorer` gets a **new Dodo product id** (`DODO_PRODUCT_EXPLORER_V2`) so the two never collide.
- Migration = *add* fields + write a snapshot; never rewrite `planId`/`dodoProductId`. Renewal continues to resolve on the original id.

**Implementation impact:** The implemented `resolveCommercialPlan(legacyPlanId)` already returns `legacyPlanId` verbatim and a separate `commercialPlanId`; no rename occurs. The original report's `legacy_explorer` suggestion is **withdrawn**.

### Issue 2 — Explorer zero-business limit vs. existing free projects — CRITICAL

**Problem:** New Explorer = 0 production businesses, but legacy free users already built projects. A naive `maxBusinesses: 0` would block or appear to invalidate their assets.

**Corrected design — three distinct states:**
1. **New Explorer** (no prior assets): `planningOnly: true`, `maxBusinesses: 0`, Explorer's 500 credits are **scoped planning-only** (cannot fund production).
2. **Grandfathered legacy-free** (existing `free` user with ≥1 project or permanent credits): `planningOnly: false`, `maxBusinesses: "unlimited"` (legacy behavior — they had no cap), `grandfathered: true`, `preserveLegacyBehavior: true`. Their **existing permanent credits remain permanent** — they are NOT retroactively converted to planning-only credits. Only *new* Explorer welcome credits are scoped.
3. **Migrated subscriber** (any legacy id → new commercial id with a frozen `entitlementSnapshot`): behaves exactly per snapshot, regardless of later catalog changes.

**Rule:** existing projects/applications are never deleted, disabled, or silently capped. Grandfathered access is explicitly distinguishable from new Explorer in both the entitlement set (`preserveLegacyBehavior`) and admin tooling.

**Implementation impact:** Already implemented via `preserveLegacyBehavior` in `buildEntitlementSet` + `resolveCommercialPlan({hasProjects, hasPermanentCredits})`.

### Issue 3 — Annual credit scheduling logic — HIGH

**Problem:** The original proposed marking a monthly grant "failed" on payment failure. For an annual subscriber, there is **no monthly payment** — they paid upfront. A failed "monthly payment" cannot occur.

**Corrected monthly-issuance logic for annual subscribers:**
Each monthly grant is gated on:
1. The annual subscription is **still active** (`status` ∈ active/trialing, not cancelled/expired/past_due beyond grace).
2. The **annual payment was successfully collected** (single one-time charge at start; recorded in `payment_records`). Refund/chargeback on that charge → stop future grants and trigger recovery of already-granted months per the refund policy.
3. The subscription has **not** been cancelled or expired (`cancelAtPeriodEnd` + `currentPeriodEnd`).
4. The **current month's grant has not already been issued** (idempotency key `annual_grant_<subId>_<periodMonthIndex>`).
5. The customer is **eligible** for that month (within the 12-month paid window; grant N only after month N-1 boundary).

- Grants are anchored to the **subscription billing period**, not the calendar month. Month index derives from `currentPeriodStart`, so a sub starting mid-month still grants on its own anniversary.
- **Failure model:** there is no per-month payment to fail. The only failure modes are (a) annual renewal payment fails → stop at next period; (b) webhook delayed → recovery sweeps past-due ungranted months; (c) refund/chargeback → stop + recover. None of these is a "monthly payment failure."
- **Idempotency / recovery:** daily sweep issues any past-due ungranted month; re-runs are no-ops; cancellation/expiry halts future months but already-granted months remain valid until their normal expiry.

**Implementation impact:** The annual scheduler is a Phase 3 sub-task not yet built. The corrected logic above replaces the original §Deliverable F mistake.

### Issue 4 — Downgrade confirmation at the wrong point — HIGH

**Problem:** The original said "when a verified downgrade webhook arrives, show a confirmation screen." The event may arrive post-confirmation (Dodo already processed the change), so a blocking confirmation is unreliable.

**Corrected — two flows:**

**A. Customer-initiated downgrade (preferred):**
- Pre-confirmation UI shows consequences: which businesses exceed the new limit, domain renewal implications, infra downgrade.
- User confirms; backend schedules the downgrade to take effect at period end (or immediately per policy) via a verified Dodo plan-change.
- Webhook then reconciles; no second confirmation needed.

**B. Externally-initiated / already-confirmed downgrade (webhook-driven):**
- Process the verified event immediately.
- Preserve **all** data and applications (no auto-delete, no auto-suspend).
- Flag over-limit resources; present an in-app "choose your active businesses" selector (e.g., Growth→Starter: pick 1 of 4 to stay active; others become `preserved_readonly`).
- Block **new** creation beyond the new cap.
- Never silently suspend production apps.

**Cancellation ≠ takedown.** Explicitly distinguish five states after cancellation/expiry:
1. **Public availability** — deployed app may keep serving until `currentPeriodEnd` (or a defined grace), per policy.
2. **New deployment permission** — revoked at period end.
3. **Resource consumption** — new consumption blocked; existing within cap continues to period end.
4. **Administrative access** — retained through period end + data-export window.
5. **Data export** — available throughout; see §3 Grace/Export.

**Implementation impact:** Rewrites the downgrade section of the original §Deliverable G.

### Issue 5 — Hosting & domain lifecycle too thin — NEEDS DESIGN

**Corrected — four domain classes, each with a full lifecycle:**

| Class | Provisioning | Lifecycle events |
|---|---|---|
| **A. Atai subdomain** (`*.atai.app`) | Atai-owned DNS wildcard + automated SSL | create, collision-check, renew (free w/ plan), release on project delete |
| **B. Customer-owned (BYO DNS)** | Customer points DNS; Atai verifies via `dnsRecordsToAdd` | connect, verify, disconnect. **Not** counted against included registrations |
| **C. Atai-registered domain** | Registrar integration (TBD: Namecheap/Cloudflare/Gandi) | register, pay, verify ownership, SSL, **renewal + cost disclosure**, expiry, transfer, **failed-registration → refund**, included-registration consumption (Growth 1 / Scale 4, year 1) |
| **D. Legacy Totalum subdomain** (`*.totalum-project.com`) | Existing | Retain for backward compatibility; does **not** satisfy the commercial "free Atai subdomain" requirement |

- Hosting is **not** a working commercial entitlement until provisioning, deployment, monitoring, and usage enforcement are verified. The `app/hosting` Coming-Soon stub must not be treated as live capacity.
- SSL, DNS verification, and registrar failure/refund paths are first-class states, not afterthoughts.

**Implementation impact:** Expands original §Deliverable H; registrar selection remains an unresolved product-owner decision.

### Issue 6 — Entitlement cache must not be a single point of failure — DESIGN

**Problem:** A 60s cache could serve stale entitlements (e.g., after cancellation) for security-sensitive operations.

**Corrected cache strategy:**
- **Abstraction, not a bare Map.** Define an `EntitlementCache` interface (`get/set/invalidate`) with a default in-memory implementation and an optional Redis backing only if existing infra supports it (do not assume Redis).
- **Invalidation on lifecycle events:** every Dodo `subscription.*`, `plan_changed`, credit grant/expire, admin entitlement change, and downgrade must call `invalidateEntitlements`. Webhook handlers are the single invalidation source of truth.
- **Safe failure:** if the cache and/or DB are unavailable, fall back to the **last known snapshot** if within a freshness bound; only if no snapshot exists, fall back to planning-only Explorer. Never fail *open to a permissive state*.
- **Security-sensitive operations bypass or re-validate:** `createProject`, `forkProject`, `buildProduction`, `registerCustomDomain`, `authorizeAgent` must resolve **fresh** (or enforce with a forced invalidation + fresh read) rather than trust a 60s cache. Cheap ops (UI rendering) may use the cache.
- **TTL:** keep short (≤60s); for sensitive paths, treat as advisory only.

**Implementation impact:** The current Phase 3 implementation uses a simple in-memory Map (placeholder). Before enforcement is enabled, it will be replaced by this abstraction; sensitive paths already call `authorize()` which will be made fresh-read.

---

## 2. Workspace & team entitlement model (new)

The original treated the subscription as attached to a single `userId`. Atai is multi-user (founders + collaborators), so entitlements must be **workspace-scoped**.

**Ownership model:**
- A **subscription attaches to a Workspace**, not a person. `resolveEntitlements(workspaceId)` is the canonical call; `userId` resolution is derived from workspace membership.
- `workspaces` collection: `{ id, ownerUserId, subscriptionRecordId, planInheritedFrom }`.
- `workspaceMembers`: `{ workspaceId, userId, role: owner|admin|member }`.

**How limits apply:**
- **Business/project count, credit pool, infra allowances, domain counts** are **workspace-scoped** (shared), not per-member.
- All members operate within the workspace's plan; a `member` cannot exceed the workspace cap even if they have their own account.
- **Credits:** the workspace has one shared subscription-credit pool + permanent pool; members draw from it. Per-member sub-accounts are out of scope for v1.
- **Collaborators & allowances:** adding a member does not increase any limit. The plan belongs to the workspace owner's subscription.

**Implementation impact:** This is a Phase 3/5 requirement. The current `resolveEntitlements(userId)` must be extended to `resolveEntitlements({ workspaceId })` (or `resolveForUser` that looks up the user's primary workspace). Projects already carry `userId`; they will additionally carry `workspaceId` so counts and limits are computed at workspace scope. Flagged as a known gap in the current foundation.

---

## 3. Missing-area clarifications (reviewer's table)

| Area | Resolution |
|---|---|
| **Business ownership** | Subscription → Workspace → businesses/projects are workspace-owned (§2). `workspaceId` added to projects. |
| **Team collaboration** | Limits apply to the workspace, shared by all members; members inherit plan, cannot exceed workspace cap. |
| **Credit transparency** | User billing UI shows: available / consumed-this-period / expiring-soon / permanent. Source = `creditBuckets` + `CreditBalance` (already in ledger). |
| **Add-ons** | Optional infra upgrades (existing `INFRASTRUCTURE_PLANS`) remain purchasable up to the plan's `infraMax` ceiling (Option C). Add-on purchase does not change subscription plan. |
| **Refunds / chargebacks** | Refund on annual payment → stop future monthly grants + recover granted months per policy; `payment_records.originalPaymentId` linkage already tracks this. |
| **Usage alerts** | Pre-exhaustion warning at e.g. 80% of monthly credits / business cap; emitted by the grant/expiry + creation paths. |
| **Grace periods** | Defined per state in §Issue 4B: public availability, deploy permission, consumption, admin access, export each have explicit post-cancellation behavior. |
| **Data export** | Available through `currentPeriodEnd` + a defined export window; never gated by downgrade. |
| **Feature availability** | `availability.*` flags drive both entitlement enforcement AND pricing-page rendering so unavailable capabilities never appear active. |
| **Admin operations** | Admin console inspects `SubscriptionRecord` + `entitlementSnapshot`; can re-run migration mapping, force invalidate, and correct discrepancies with full audit logging. |

---

## 4. Revised ADRs

- **ADR-1:** Preserve credit ledger / Dodo pipeline / Runtime metering. (unchanged)
- **ADR-2 (revised):** Never rename stored `planId`/`dodoProductId`. Map via resolver + additive `commercialPlanId` + snapshot. (`legacy_explorer` rename explicitly withdrawn.)
- **ADR-3:** Hybrid infrastructure model (Option C). (unchanged)
- **ADR-4:** Explorer planning-only via scoped `planning` credit bucket. (unchanged)
- **ADR-5:** All plan/price interpretation server-side only. (unchanged)
- **ADR-6 (revised):** Grandfathering via frozen `entitlementSnapshot`; **explicitly distinguishes** new Explorer (0 businesses, scoped credits) from grandfathered legacy-free (assets preserved, permanent credits stay permanent).
- **ADR-7 (new):** Entitlements are **workspace-scoped**, not per-user.
- **ADR-8 (new):** Cache is an abstraction with event-driven invalidation; security-sensitive ops resolve fresh and never trust stale data.
- **ADR-9 (new):** Annual grants are anchored to the subscription billing period and gated on annual-payment status, not a (non-existent) monthly payment.

---

## 5. Updated risk register

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | Renaming plan IDs breaks renewals | CRIT | ADR-2: never rename; map + snapshot |
| R2 | Legacy free users silently downgraded | CRIT | ADR-6: grandfathered state; permanent credits stay permanent |
| R3 | Credit allocations invented w/o model | HIGH | Phase 4 financial model gates all `PENDING` values |
| R4 | Scale features advertised but absent | HIGH | `availability.*` gates UI + enforcement |
| R5 | Infra name collision | HIGH | Rename infra ids to disjoint namespace |
| R6 | Dead storage enforcement | MED | Writer + wire `checkStorageLimit` |
| R7 | No Atai-owned subdomain | MED | Provision `*.atai.app` |
| R8 | Annual billing logic error | HIGH→fixed | §Issue 3 corrected scheduler |
| R9 | Downgrade confirmation too late | HIGH→fixed | §Issue 4 two-flow model |
| R10 | Stale cache grants post-cancel access | HIGH | ADR-8: invalidate + fresh-read for sensitive ops |
| R11 | Workspace vs per-user entitlement ambiguity | HIGH | ADR-7: workspace-scoped |
| R12 | Hosting treated as live before verified | MED | §Issue 5: verify before commercial claim |
| R13 | Admin accidental zero/unlimited | MED | Validation + confirmation |

---

## 6. Delta vs. original Phase 2 report

**Changed/withdrawn:**
- Withdrawn: `legacy_explorer` rename suggestion (Issue 1).
- Rewritten: Annual billing scheduler logic (Issue 3).
- Rewritten: Downgrade confirmation flow (Issue 4).
- Expanded: Hosting/domain lifecycle (Issue 5).
- Rewritten: Entitlement cache strategy (Issue 6).
- Added: Workspace/team entitlement model (§2).
- Added: Missing-area clarifications (§3).
- Revised: ADRs R2/R6 and new ADR-7/8/9; risk register R8–R13.

**Unchanged and still approved:**
- Centralized entitlement service (`resolveEntitlements`/`authorize`).
- Preserve Dodo pipeline, credit ledger, Runtime metering.
- Hybrid infrastructure reconciliation (Option C).
- Grandfathering principle (now made explicit per Issue 2).
- `available:false` for unfinished Scale features.
- Phased roadmap (Phase 3→9) and testing strategy.
- Financial-model requirements (defer final credit/quota numbers).

---

## 7. Phase 3 gate

Further Phase 3 implementation is **paused** pending approval of this revision. When approved, the sequence is:

1. Apply the additive `SubscriptionRecord` fields (incl. `dodoProductId`) — already partially done.
2. Implement `EntitlementCache` abstraction per ADR-8; make sensitive paths fresh-read.
3. Extend `resolveEntitlements` to workspace scope (ADR-7).
4. Build the legacy→commercial migration script (dry-run → reconcile → idempotent production run) using the resolver (no rename).
5. Build annual monthly-issuance scheduler per corrected §Issue 3 logic.
6. Build downgrade two-flow per §Issue 4.
7. Only then flip `ENTITLEMENT_ENFORCEMENT_ENABLED=true` after migration + financial-model sign-off.

---

## 8. Read-only confirmation

- ✅ No source code modified for this revision.
- ✅ No application files created/deleted/renamed.
- ✅ No database records or schemas modified (additive field list is a *proposal*; already-applied additive fields from the prior foundation remain and are compatible).
- ✅ No migrations run; no Dodo products/config/env changed.
- ✅ No pricing pages or frontend modified.
- ✅ No dependencies installed.

**This is a revised design package. Do not begin (or resume) Phase 3 implementation until it is explicitly approved.**
