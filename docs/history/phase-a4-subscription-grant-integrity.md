# Phase A4 — Subscription grant transaction integrity (M-18)

## Root cause

`grantSubscriptionCredits` read the user's balance before opening its MongoDB
transaction:

```ts
const balance = await getBalance(params.userId)
const newBalance = balance.total + params.amount
```

The grant then incremented `subscriptionCredits` / `credits`, pushed the new
bucket, and wrote the ledger inside the transaction, but recorded
`balanceBefore: balance.subscription` and
`balanceAfter: balance.subscription + params.amount` from that pre-transaction
read. A concurrent consumption, reversal, expiry or renewal could commit
between the read and the transaction, so the ledger described a balance the
grant never applied to. The pre-read also opened a second balance path (and a
lazy expiry sweep) before the transaction that owned the write.

The generic `grantCredits` path had already been corrected in an earlier pass.
The subscription-specific path — used by activation, renewal and the annual
monthly-issuance sweep — still had the stale read.

## Files changed

- `lib/billing/credit-service.ts`
  - `grantSubscriptionCredits`: removed the pre-transaction `getBalance` /
    `newBalance`; reads the user and both balances inside the transaction;
    records the applied subscription and total before/after values.
  - `expireSubscriptionCredits`: reads the user, buckets and subscription
    balance inside its transaction (the old early-out read is gone), and takes
    an optional `expiresAtOrBefore` cutoff for renewal expiry so a bucket
    granted by the annual sweep for the new period is not removed by the
    renewal's old-period cleanup. Omitting the cutoff keeps the existing
    full-subscription expiry behavior.
- `lib/billing/dodo-event-processing.ts`
  - renewal expiry passes `expiresAtOrBefore: now`.
- `lib/billing/credit-service.grant.test.ts`
  - direct subscription-grant coverage: one in-transaction balance read,
    applied before/after, bucket metadata, idempotent replay.
- `lib/billing/subscription-payment-grants.test.ts`
  - in-memory transaction harness extended with `$push`, bucket-push failure,
    ledger failure and one-shot transaction retry; A4 concurrency and rollback
    tests added.
- `AGENTS.md`
  - records the A4 invariant and test location.

## Grant transaction before and after

Before:

```text
getBalance (outside transaction, may sweep expiry)
  ↓
start transaction
  re-check idempotency
  increment flat subscription + total
  push bucket
  write ledger using the stale pre-read balances
commit
```

After:

```text
start transaction
  re-check idempotency
  read user with { session }
  balanceBefore = user.subscriptionCredits
  totalBefore   = user.credits
  increment flat subscription + total
  push bucket
  write ledger using balanceBefore / balanceAfter
    and totalBalanceBefore / totalBalanceAfter
commit
```

## Balance-read placement

- The only balance read in the grant path is `users.findOne({ id }, { session })`
  inside the transaction.
- The ledger write, bucket `$push`, aggregate `$inc` and idempotency re-check all
  use that same session.
- `getBalance` is not called by `grantSubscriptionCredits`; no lazy expiry runs
  outside the grant transaction.
- `expireSubscriptionCredits` likewise reads the fresh user, buckets and
  balance with its transaction session; it no longer pre-reads a balance or
  builds an idempotency key from a stale bucket list.
- The pre-transaction ledger lookup remains only as a fast idempotency check; it
  reads no balance and is repeated inside the transaction.

## Concurrency guarantees

- Concurrent grants for different periods serialize on the user document and
  each ledger snapshot starts where the previous one ended.
- Duplicate grants for the same subscription + period are blocked by the unique
  `credit_ledger.idempotencyKey` index and the in-transaction re-check. A loser
  returns `true` without a second bucket, ledger entry or balance increment.
- Grant racing consumption, reversal or overdue expiry preserves:
  `subscriptionCredits == sum(creditBuckets.amount)` and
  `credits == subscriptionCredits + permanentCredits`.
- Renewal expiry now removes only buckets whose `expiresAt` is at or before the
  renewal time when `expiresAtOrBefore` is supplied. A new-period bucket created
  concurrently by the annual sweep is therefore not pulled out from under its
  own ledger entry. `subscription.expired` still expires the whole subscription.
- Transaction retries reuse the same bucket id and idempotency key; the
  in-transaction ledger check makes the retry a no-op after a successful commit.

## Idempotency behavior

- Key: `sub_grant_<subscriptionId>_period_<periodEnd day>`.
- Unique index: `credit_ledger_idempotency_unique`.
- Duplicate webhook, duplicate annual allocation and transaction retry all
  converge on one ledger entry, one bucket and one aggregate increment.
- A caller that joins an existing transaction is rejected unless
  `session.inTransaction()` is true.

## Tests

`lib/billing/subscription-payment-grants.test.ts` — Phase A4:

1. grant with existing subscription and permanent balances;
2. grant with no previous balance;
3. two concurrent grants for different periods;
4. duplicate period racing itself;
5. grant racing consumption;
6. grant racing reversal;
7. grant racing overdue expiry;
8. renewal expiry racing a new-period grant;
9. duplicate annual allocation replay;
10. failure during bucket creation rolls back the aggregate;
11. failure during ledger insertion rolls back the aggregate and bucket;
12. transient transaction retry without duplicate grant;
13. before/after balance accuracy in the ledger.

`lib/billing/credit-service.grant.test.ts` adds direct unit coverage for the
in-transaction read and the idempotent replay. `lib/billing/credit-service.expiry.test.ts`
covers the renewal cutoff and asserts that expiry reads use the transaction
session.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 312 files, 3,817 passed, 2 todo.
- `npm run lint` — 0 errors; 377 pre-existing warnings.

## Remaining production-only verification

The in-memory harness serializes transactions and models rollback. It does not
prove MongoDB replica-set write-conflict behavior. Before production migration:

- run the grant/consumption/reversal/expiry races against a replica set;
- verify duplicate-key and write-conflict retries under real concurrency;
- induce a failure between the aggregate update, bucket push and ledger insert;
- confirm the annual sweep and renewal webhook can run concurrently without
  stranding a new-period bucket;
- run `scripts/reconcile-credit-balances.ts` in dry-run mode and review
  discrepancies before any `apply`.

## M-18 status

**Resolved at the code-and-test level.** The stale pre-transaction balance read
is gone; all balance-dependent grant work now shares one transaction. The
replica-set gate remains a production release requirement, not an open code
defect.
