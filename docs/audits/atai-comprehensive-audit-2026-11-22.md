# Atai comprehensive audit — 2026-11-22

Status: audit and verification complete. M-22 architecture remains accepted but
**M-22 sign-off is still pending**; this document is evidence for that review, not
the sign-off itself.

## Scope and method

The audit covered the commercial billing surface end to end:

- code and database catalog publication (A7.0–A7.5);
- Dodo checkout, webhook processing, subscription activation, renewal and plan
  changes;
- credit grants, reservations, consumption, expiry and reversal;
- custom-domain and subdomain capacity reservations;
- storage reservations and hold maintenance;
- deploy/build status recovery and refund paths;
- publication preview and activation guards;
- credit-pack/top-up and referral reads where they touch billing.

Method: read the production paths, compare the database and code catalogs, run
the focused suites, then run the complete verification set. Every fix below has
a regression test or an updated assertion.

## Verification evidence

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | pass |
| Tests | `npx vitest run` | 349 files, 4,055 passed, 2 todo |
| Lint | `npm run lint` | 0 errors, 375 pre-existing warnings |
| Production build | `npm run build` | pass |
| Whitespace | `git diff --check` | clean |

## Defects found and fixed

### 1. Legacy plan resolution drifted from runtime configuration

`lib/billing/dodo-event-processing.ts` and
`lib/billing/activate-subscription.ts` imported the module-load
`LEGACY_SUBSCRIPTION_PLANS` array. Any environment-driven plan or Dodo product
change after module load could therefore attribute a purchase to the wrong
legacy plan or miss it entirely.

Fix: both paths now resolve through `getLegacySubscriptionPlans()`, and the
database runtime catalog is consulted first for commercial products. A legacy
Dodo product id is never guessed into a commercial plan; plan-alias fallback is
allowed only when checkout wrote a commercial `billingCycle` marker.

Tests: `dodo-event-processing.renewal.test.ts`,
`dodo-event-processing.plan-change.test.ts`,
`activate-subscription.catalog.test.ts`,
`activate-subscription.db-integration.test.ts`.

### 2. Checkout could sell a plan or pack whose purchase state was not available

The database catalog carries `purchaseState` and `annualPurchaseState`, and
credit packs carry `saleMode`. Checkout checked price and custom status but did
not enforce those states. A catalog entry marked `soon` or `contact` could still
reach a Dodo checkout session when the price happened to match code.

Fix: `app/api/billing/checkout/route.ts` refuses a plan whose selected cycle is
not `available`, and refuses a credit pack that is not `self_serve`.

Test: `app/api/billing/checkout/catalog.test.ts` — “refuses a plan whose purchase
state is not available”.

### 3. Subscription activation could reassign an existing subscription to another user

`activatePaidSubscription` looked up an existing record by
`dodoSubscriptionId` and then wrote the metadata `userId` into that record. A
mismatched or corrupted webhook could move a subscription between accounts.

Fix: activation now returns `user_mismatch` before any grant or update when the
existing record belongs to another user. The existing `expectedUserId` guard
remains for the sync path.

Test: `lib/billing/activate-subscription.test.ts` — “refuses to reassign an
existing subscription to another user”.

### 4. Legacy deployed projects were not counted as consuming a subdomain

The subdomain counter only looked at `deployment.status`, `productionUrl`, and
`state === "deployed"`. Older projects whose only deployment evidence is a
successful `deploymentHistory` entry were treated as having no subdomain. That
could let them reserve another slot and overrun the plan cap. The same predicate
was duplicated in the deploy route, the deploy server action, the access view,
and the hold sweep.

Fix: a successful deployment history entry now counts everywhere. The shared
database filter also includes `deploymentHistory.status: "success"`.

Tests: `lib/billing/subscription-terms.test.ts`,
`app/api/projects/[id]/deploy-claim.test.ts`,
`lib/billing/entitlements/hold-maintenance.test.ts`.

### 5. Subdomain hold overlap was approximated, not measured

Reservation counted active holds and subtracted
`min(activeHolds, deployingProjects)`. That is not the same as “holds whose
project is already counted.” With holds for failed/not-yet-persisted projects
and unrelated deploying projects, the approximation could undercount and admit
an over-cap deployment.

Fix: `reserveSlot` now lists the actual active holds and asks
`countSubdomainsAmongProjects` how many of those projects are already in the
live count. Each hold is counted exactly once.

Tests: `lib/billing/entitlements/require.test.ts`,
`lib/billing/entitlements/acceptance-matrix.test.ts`,
`lib/billing/entitlements/reservations.test.ts`.

### 6. Deployment success was not persisted on the project record

The status route and deploy poll updated deployment history but did not persist
`project.deployment.status` / `productionUrl`. As a result, a successfully
deployed project could still look like it had no subdomain to later entitlement
checks, and a retry could reserve a second slot.

Fix: success now persists the deployment record before the subdomain hold is
released. Failure paths persist a failed deployment record instead of leaving a
stale `idle`/`deploying` state.

Tests: `app/api/projects/[id]/status-refund-regression.test.ts`,
`app/api/projects/[id]/deploy-claim.test.ts`,
`lib/projects/deploy-entitlement.test.ts`.

### 7. Subdomain holds leaked on several terminal deploy failures

Holds were released on the normal provider error and the successful/errored
status branches, but not when:

- the provider reported `PROJECT_NOT_FOUND` during a deploy poll;
- the status route found an orphaned `deploying` project with no
  `totalumProjectId`.

Those holds could consume a slot for up to six hours after the deployment was
already impossible. A transient provider-status read failure deliberately keeps
the hold: the deployment may still be alive, so releasing it would risk an
over-cap.

Fix: every terminal deploy path now releases the subdomain hold after the
failed state is persisted. A retryable credit-refund failure still returns 503
first, so the hold is kept until the refund can be retried.

Tests: `app/api/projects/[id]/status-refund-regression.test.ts` — orphaned
deployment releases the hold; existing success/error ordering assertions.

### 8. Hold maintenance ordering and history awareness

The sweep read holds without a deterministic order and did not recognize a
successful deployment history entry as a realized subdomain.

Fix: the sweep sorts by `expiresAt` (expired first) and treats successful
deployment history as realized. This makes repeated runs stable and releases
holds for legacy deployed projects.

Test: `lib/billing/entitlements/hold-maintenance.test.ts`.

### 9. Publication preview could report “ready” for an activation that must fail

Activation rejects a candidate containing versions effective in the future.
Preview only warned and still returned `ready: true` when the rest of the
candidate resolved and was checkout-compatible.

Fix: preview now returns `ready: false` for future-effective versions and says
activation is blocked until they are due. The warning also no longer claims
entitlements are compared by checkout compatibility; they are intentionally not
compared because a database purchase pins its own entitlement snapshot.

Test: `lib/billing/catalog/publication-preview.test.ts` — “blocks a candidate
that contains versions effective in the future”.

## Reviewed with no additional defect found

- **Catalog publication and activation.** Candidate checksum, publication
  checksum, product/version membership, current-version checks, legacy-renewal
  exclusion, and supersede-all-active transaction behavior are consistent
  between preview, activation, and customer reads.
- **Checkout compatibility.** Code and database plans must agree on monthly and
  annual price, monthly credit grant, Dodo product ids, custom status, purchase
  states, and pack price/credits/sale mode. Infrastructure products are checked
  for price, purchase model, duration, renewal and sale mode.
- **Pinned subscription terms.** Existing `purchasedTerms` always win. A missing
  record can allocate from the database catalog; a failed catalog read falls
  back to code so a payment is not lost. Annual activation grants month 0 and
  anchors the period for the annual sweep.
- **Credit ledger.** Grants and subscription grants use an in-transaction
  idempotency lookup plus a unique key, read balances inside the transaction,
  and refuse to write a ledger entry for a non-existent user. Legacy `credits`
  is incremented/decremented alongside the split fields.
- **Top-ups.** The legacy top-up service is read-only; it cannot grant credits.
- **Referrals.** Reward issuance claims the referral row inside the same
  transaction as the grant, so duplicate polls cannot double-pay; hard fraud
  flags still block even after a partial review approval.

## Residual risks and follow-ups

1. **Legacy deployment evidence older than the 50-entry history cap.** A project
   with neither persisted deployment fields nor a successful entry in its last
   50 deployments cannot be recognized as already deployed. A one-time data
   backfill of `deployment.status`/`productionUrl` from provider state would
   remove this edge.
2. **Hold sweep starvation.** The sweep sorts by expiry and applies a global
   limit. A very large population of active storage holds can delay scanning a
   later-expiring slot hold. It is a latency issue, not a cap bypass; splitting
   the sweep into expired, slot, and storage passes would make it deterministic.
3. **Referral debug logging.** `lib/referrals/referrals.ts` still contains
   `console.log` statements that include referral codes and user ids. They are
   not financial, but they are logging-hygiene debt and should move to the
   structured logger or be removed.
4. **M-22 sign-off.** The architecture remains accepted, but the formal sign-off
   is still outstanding. This audit supplies test and code evidence only.

## Files with audit changes

- `app/api/billing/checkout/route.ts`
- `app/api/projects/[id]/deploy/route.ts`
- `app/api/projects/[id]/status/route.ts`
- `lib/billing/activate-subscription.ts`
- `lib/billing/catalog/publication-preview.ts`
- `lib/billing/entitlements/hold-maintenance.ts`
- `lib/billing/entitlements/presentation.ts`
- `lib/billing/entitlements/require.ts`
- `lib/billing/entitlements/reservations.ts`
- `lib/billing/entitlements/service.ts`
- `lib/projects/project-actions.ts`

Tests added or updated:

- `app/api/billing/checkout/catalog.test.ts`
- `app/api/projects/[id]/deploy-claim.test.ts`
- `app/api/projects/[id]/status-refund-regression.test.ts`
- `lib/billing/activate-subscription.test.ts`
- `lib/billing/catalog/publication-preview.test.ts`
- `lib/billing/entitlements/acceptance-matrix.test.ts`
- `lib/billing/entitlements/hold-maintenance.test.ts`
- `lib/billing/entitlements/require.test.ts`
- `lib/billing/subscription-terms.test.ts`
