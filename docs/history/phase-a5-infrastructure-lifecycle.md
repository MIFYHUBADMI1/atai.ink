# Phase A5 — Infrastructure Subscription Renewal and Expiration Lifecycle (M-26)

## 1. Audit findings

The audit established the actual product model before changing anything:

1. **How infrastructure plans are purchased.** A founder chooses a plan in
   `components/infrastructure-manager.tsx` (project Plan page). The browser
   calls `POST /api/projects/[id]/infrastructure`; `activatePlan` in
   `lib/infrastructure/service.ts` charges Atai Credits through the existing
   ledger (`consumeCredits`, transaction type `infrastructure_purchase`) and
   applies a Totalum infrastructure-credit cap. This is **not** a Dodo
   checkout and has no Dodo product or subscription id.
2. **Durable subscription records.** The entitlement is the embedded
   `project.infrastructure` subdocument (`InfrastructureSubscription` in
   `lib/types/project.ts`). There is no separate infrastructure-subscription
   collection and no provider subscription record.
3. **Start and expiration dates.** `startedAt` and `expiresAt` are epoch
   milliseconds (UTC). A period is 30 days. `expiresAt` is the paid-through
   timestamp. Admin overrides and the free Testing initialization also write
   these fields.
4. **Renewal payments.** None. `autoRenew` is always `false`; no renewal
   endpoint or UI existed, and re-selecting the active plan was rejected.
   There is no recurring infrastructure billing in the provider integration.
5. **Failed or missing renewal payments leaving access active.** Yes, before
   this phase: `handleExpiration` existed but had no caller and no scheduler,
   so a paid plan remained active indefinitely after `expiresAt`.
6. **Cancellation preventing future renewal.** The status union included
   `cancelled`, but there was no cancellation route/service and no renewal
   process to prevent. `autoRenew` was already false.
7. **Expiration removing/restricting entitlements.** No. The dead
   `handleExpiration` function downgraded a plan only if something called it;
   no cron, route, or request-time check did.
8. **Refunds affecting infrastructure access.** No infrastructure refund path
   exists. A3 credit reversals operate on subscription credit grants and do
   not change `project.infrastructure` or its paid-through date. A credit
   refund must not grant or revoke infrastructure access.
9. **Duplicate webhooks duplicating infrastructure entitlements.** There is
   no infrastructure webhook. Duplicate purchase requests could retry the
   credit charge idempotently, but the old activation path always wrote a new
   `expiresAt`, so a whole-operation retry could extend twice.
10. **Historical purchase terms.** Existing records store `planId`,
    `planName`, `storageLimitBytes`, `totalumInfrastructureCreditLimit`,
    `startedAt` and `expiresAt`; there was no explicit purchased-terms
    snapshot. Records without a trustworthy `expiresAt` are ambiguous and must
    not be expired or repriced from today's catalog.

## 2. Lifecycle architecture

### Before

```
POST /api/projects/[id]/infrastructure
  -> activatePlan()
       -> consumeCredits(infrastructure_purchase)
       -> write project.infrastructure (startedAt, expiresAt = now + 30d)
       -> applyTotalumCap()
  -> no renewal flow
  -> no expiration caller / no cron
  -> no request-time paid-access gate
```

`handleExpiration` existed as dead code. Paid access therefore survived its
paid-through date.

### After

```
POST /api/projects/[id]/infrastructure
  -> activatePlan() [purchase or { renewal: true }]
       -> acquire infrastructure.lifecycleLock (5 min TTL)
       -> idempotent purchase key + lastPurchaseKey
       -> consumeCredits(infrastructure_purchase)
       -> write project.infrastructure.purchasedTerms, expiresAt
       -> applyTotalumCap()
       -> release lock

POST /api/projects/[id]/infrastructure/cancel
  -> cancelInfrastructurePlan()
       -> status = cancelled, autoRenew = false
       -> paid-through access remains

GET /api/admin/infrastructure/expire-sweep  (Vercel cron, 07:00 UTC)
  -> runInfrastructureLifecycleSweep()
       -> paid records at/past expiresAt, plus failed-cap retries
       -> handleExpiration() under the same lifecycle lock
            -> mark status = expired
            -> apply Testing Totalum cap (5 infrastructure credits)
            -> write Testing plan / clear paid entitlement
            -> cap failure => syncStatus = failed, retried next run

Request-time enforcement
  -> infrastructureDenial(project.infrastructure)
       -> blocks build, follow-up edit, deploy, database, server restart
       -> blocks as soon as expiresAt <= now, even before the cron runs
```

There is no automatic recurring billing. Renewal is an explicit, user-initiated
credit purchase. `autoRenew` remains `false`.

## 3. Files changed

- `lib/infrastructure/service.ts` — lifecycle, purchase/renewal, lock,
  cancellation, expiration, sweep.
- `lib/infrastructure/access.ts` — new paid-access policy and denial helper.
- `lib/types/project.ts` — purchased terms, review, renewal, expiry, lock fields.
- `lib/db/collections.ts` — infrastructure lifecycle index.
- `app/api/projects/[id]/infrastructure/route.ts` — renewal flag and access view.
- `app/api/projects/[id]/infrastructure/cancel/route.ts` — new cancellation route.
- `app/api/admin/infrastructure/expire-sweep/route.ts` — new admin/cron sweep.
- `app/api/admin/infrastructure/[projectId]/plan/route.ts` — admin overrides
  store terms and clear review/expiry state.
- `lib/projects/project-actions.ts` — build, follow-up and deploy gates.
- `app/api/projects/[id]/build/route.ts` — build gate.
- `app/api/projects/[id]/deploy/route.ts` — deploy gate.
- `app/api/projects/[id]/server/restart/route.ts` — server restart gate.
- `app/api/projects/[id]/database/{query,records,tables}` and dynamic record
  routes — database access gates.
- `components/infrastructure-manager.tsx` — renewal/cancel controls, review and
  expired display.
- `vercel.json` — daily sweep schedule.
- `AGENTS.md` — lifecycle note.
- `lib/infrastructure/lifecycle.test.ts` — new lifecycle suite.
- `app/api/projects/[id]/deploy-claim.test.ts` — expired-infrastructure route
  enforcement case.

## 4. Data migration requirements

**No destructive migration and no backfill.**

- Existing records with a valid `expiresAt` are trusted as the paid-through
  date and are handled by the sweep.
- Existing records without a trustworthy `expiresAt` (or with an unknown /
  enterprise plan) are marked `needsReview` by the sweep. Their access is
  preserved; no date is invented and no price is reconstructed.
- `purchasedTerms` is written on new purchases, renewals and admin overrides.
  Legacy records continue to use their stored plan/limit fields; they are not
  repriced from today's catalog.
- The only storage change is an additive index on
  `infrastructure.status` + `infrastructure.expiresAt`; index creation is
  best-effort through the existing `ensureIndexes` bootstrap.

## 5. Renewal and expiration behavior

### Purchase

- Paid plans charge the existing Atai credit ledger at the admin-configured
  runtime price.
- The purchase key is `infra_${intentKey}` when the route supplies a scoped
  request id; otherwise a minute-bucketed fallback is used.
- The whole operation is idempotent through the ledger key plus
  `infrastructure.lastPurchaseKey`. A retry after a successful charge does not
  extend the period twice.
- Purchased terms are stored in `purchasedTerms` (plan, storage, Totalum cap,
  credits paid, purchase time, duration).

### Renewal

- Explicit `{ renewal: true }` on the same active plan extends from the
  existing paid-through date, not from today.
- If the plan already lapsed, renewal starts a new period at `now`.
- A different plan is an upgrade: it starts a new period at `now`.
- A failed or insufficient renewal leaves the existing expiry untouched.
- There is no automatic renewal. Cancellation sets `status: "cancelled"` and
  preserves access through `expiresAt`; the sweep then downgrades it.

### Expiration

- Due at `expiresAt <= now` using UTC epoch milliseconds. No expiration happens
  before that timestamp.
- The lifecycle lock serializes expiration against purchase/renewal.
- The record is marked `expired` before the provider call, so request-time
  access is denied even if the provider sync fails.
- The real Totalum cap is changed from the paid plan's cap to the Testing
  plan's 5 infrastructure credits.
- On success the plan becomes Testing (`status: "active"`, `expiredAt`
  recorded). Customer data and deployments are not deleted.
- On cap failure the record stays `expired` + `syncStatus: "failed"`; the next
  sweep retries. The sweep also selects those retry rows.
- Free Testing plans are not expired by this lifecycle.

## 6. Entitlement enforcement evidence

- **Real provider cap:** `applyTotalumCap` calls
  `PATCH /projects/:projectId/credit-limits` with
  `maxInfrastructureCreditsPerMonth: 5` on expiration. The lifecycle test
  asserts the exact call.
- **Request-time gate:** `infrastructureDenial` returns
  `INFRASTRUCTURE_EXPIRED` (HTTP 402) when the paid-through date has passed or
  the status is `expired`/`past_due`. It is wired into build, follow-up edit,
  deploy, database access and server restart. The deploy route test proves the
  gate fires before a build slot is claimed or credits reserved.
- **UI truth:** `GET /api/projects/[id]/infrastructure` now returns the access
  decision; the manager shows `expired`/`needs review` instead of implying an
  active paid plan.
- **Historical protection:** a missing/invalid expiry is `needsReview`, not
  `expired`; access is preserved and the cap is not downgraded.
- **Known pre-existing gap:** `storageUsedBytes` is not synced from Totalum and
  `checkStorageLimit` has no caller, so the storage-quota bar is display-only.
  This phase does not invent a storage meter. Expiration enforcement is through
  the real Totalum infrastructure cap and the request-time gates above.

## 7. Idempotency and concurrency guarantees

- Purchase/renewal: ledger idempotency key + `lastPurchaseKey` prevents a
  duplicate charge or a second period extension. The bounded
  `appliedPurchaseKeys` history is retained across expiry, rebuild and admin
  override, so replaying an older purchase key after a newer purchase cannot
  grant a fresh paid period without a charge.
- Expiration: state transition to `expired` + `expiredAt` + `syncStatus` is
  repeatable; a second worker sees the Testing plan and stops.
- Lock: `infrastructure.lifecycleLock` (5-minute TTL) serializes purchase,
  renewal, cancellation and expiration. A stale lock is reclaimed after the
  TTL, so an interrupted worker is retried.
- Provider failure: cap failure is explicit (`syncStatus: "failed"`) and
  retried; the app-level gate denies paid operations in the meantime.
- No cross-system transaction is claimed: Totalum is external. The sequence is
  mark-expired → apply cap → downgrade state, with retry. This is deliberate:
  it never leaves a paid plan silently usable after the paid-through date.
- Missing/ambiguous payment records: there is no infrastructure payment record
  to infer. Historical entitlements without trustworthy terms are review-only.

## 8. Tests and verification

Added/updated:

- `lib/infrastructure/lifecycle.test.ts` — 20 tests covering initial purchase,
  duplicate purchase retry, renewal from the paid-through date, failed renewal,
  renewal racing expiration, exact/early/after expiry, duplicate worker,
  cap-failure replay, missing historical terms, cancellation, lock contention,
  stale-lock recovery, sweep reporting, credit-balance independence and access
  policy.
- `app/api/projects/[id]/deploy-claim.test.ts` — expired infrastructure is
  refused before claiming a deploy slot or reserving credits.

Verification:

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 313 files, 3,838 passed, 2 todo.
- `npm run lint` — 0 errors (pre-existing warnings remain).

The test harness is an in-memory model of the Mongo subset used by the service;
the workspace has no replica-set-backed test database. Real transaction and
provider behavior remain production verification items.

## 9. Remaining production-only risks

1. Verify the sweep and purchase lock against a real MongoDB replica set,
   including write conflicts and retry behavior.
2. Verify the Totalum `PATCH /credit-limits` call with a real project; confirm
   the Testing cap takes effect at the provider boundary.
3. A provider cap failure is retried, but until it succeeds the external
   provider cap can remain at the paid value even though the app denies access.
   Monitor `infrastructure.syncStatus: "failed"` and `cap_failed` sweep reports.
4. `CRON_SECRET` must be configured; otherwise the sweep is admin-triggered only.
5. Vercel cron is daily, so access is denied request-time immediately but the
   provider cap may lag until the next run.
6. Storage quota remains display-only (pre-existing); no storage meter is
   invented here.
7. Admin plan overrides are manual and do not acquire the lifecycle lock; an
   operator should avoid overriding while a sweep is visibly in progress.
8. Enterprise/custom plans remain manual (`needsReview` / no automatic expiry).
9. There is no automatic recurring infrastructure billing. Do not add one
   without a provider-supported recurring integration and a separate phase.

## 10. M-26 status

**M-26 is resolved for the infrastructure billing model that actually exists**
(fixed-duration, credit-funded purchases with no recurring provider billing):

- paid purchases store their terms and paid-through timestamp;
- explicit renewal is idempotent and extends the correct period;
- a daily sweep expires paid plans and changes the real Totalum cap;
- request-time gates deny paid infrastructure operations after expiry even
  before the sweep;
- duplicate purchases and duplicate expiration runs do not duplicate
  entitlements;
- historical records without trustworthy terms are preserved and marked for
  review rather than guessed or repriced;
- customer data and deployments are never deleted on expiration.

Production verification of the replica-set transaction path and the live
Totalum cap remains required before release, but there is no remaining
code-level lifecycle gap in the supported model.
