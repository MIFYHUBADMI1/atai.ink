# Phase A3 — Credit integrity and bucket-aware reversal

## Root causes

- `reverseCredits` debited only the flat aggregates. A subscription refund could
  reduce `subscriptionCredits`/`credits` while leaving the itemised grant
  buckets untouched, so later expiry or consumption worked from two different
  balances.
- The subscription refund path reversed credits before the refund row and the
  original payment were updated. A failure between those steps left a
  committed reversal with no refund record.
- Two different concurrent partial refunds could each pass the cumulative
  amount check and both increment `refundedAmountMinor` past the original
  charge.
- There was no repair path for historical accounts whose bucket sum, flat
  subscription field and legacy `credits` mirror disagreed.

## Architecture

`reverseCredits` (`lib/billing/credit-service.ts`) is the single authoritative
reversal:

- idempotent on `idempotencyKey` via the ledger and `creditReversalKeys`;
- subscription reversals debit the exact `bucketIds` (or, for an explicitly
  account/subscription-scoped admin reversal, one `subscriptionId`), never the
  total balance;
- a grant-scoped reversal with no matching bucket returns
  `nothing_available` rather than spending unrelated credits;
- a refund whose payment has no `grantBucketIds` is refused as
  `grant_bucket_unresolved`; a ledger reference alone does not identify a
  bucket;
- permanent credits are a separate flat bucket and are never touched by a
  subscription reversal;
- flat aggregates, bucket amounts and the ledger entry commit in one
  transaction, and the operation can join a caller's session;
- a bucket write that misses (bucket removed or changed by a concurrent
  transaction) throws, so the transaction rolls back instead of leaving the
  aggregates and buckets disagreeing.

The result carries the evidence needed to explain a partial reversal:
`requestedAmount`, `availableAmount`, `expiredAmount`, `consumedAmount`,
`previouslyReversedAmount`, `shortfall`, `shortfallReason`
(`consumed` / `expired` / `already_reversed` / `missing_bucket` /
`insufficient_balance`), `missingBucketIds`, `previouslyReversedBucketIds`,
`scope` and the exact `bucketDeductions`. The same fields are written to the
ledger entry metadata and replayed on idempotent calls.

`reverseSubscriptionCredits` is now a thin wrapper over `reverseCredits`.
`handleRefundSucceeded` runs the reversal, the refund row and the original
payment's progress in one transaction. The cumulative cap is part of the same
atomic payment update:

```ts
refundIds: { $ne: refundId }
$or: [
  { refundedAmountMinor: { $exists: false } },
  { refundedAmountMinor: { $lte: originalAmount - refundAmount } },
]
```

A rejected cap or duplicate refund aborts the transaction, so the credit
reversal is rolled back too.

## Invariants

- `subscriptionCredits` equals the sum of the user's bucket amounts (when
  buckets exist).
- `credits` equals `subscriptionCredits + permanentCredits` when both split
  fields are present.
- Expiry removes only the target subscription's buckets, or only overdue
  buckets, and debits the aggregates by the same amount.
- Cancellation changes status only. A plan change re-pins terms only. Neither
  creates, edits or expires a bucket.
- Promotional grants are permanent credits; subscription expiry and refund
  never debit them.
- A refund cannot reverse more credits than the original payment granted, and
  cumulative refunded money cannot exceed the original charge.

## Legacy repair

`lib/billing/credit-reconciliation.ts` provides:

- `inspectUserCreditIntegrity` — pure drift rules;
- `auditCreditIntegrity` — bounded read-only scan;
- `repairCreditBalance` — aligns the aggregates to the buckets and writes a
  `credit_reconciliation` ledger entry with the actor and reason.

A missing `permanentCredits` field is treated as unknown, not zero: the
subscription correction is carried into the legacy `credits` mirror while the
unseen permanent portion is preserved. Accounts with no buckets are left alone
apart from that mirror.

Run `scripts/reconcile-credit-balances.ts dry-run`, then `apply --actor=...
--reason=...`.

## Verification

- `npx tsc --noEmit` — clean.
- Targeted billing suite — 103 passed, including full/partial/multi-bucket
  reversal, consumed and expired grants, duplicate idempotency, prior-reversal
  shortfall, permanent-credit protection, concurrent reversals, reversal
  racing consumption/expiry, and ledger/bucket failure rollback.
- `npx vitest run` — 312 files, 3,801 passed, 2 todo.
- `npm run lint` — 0 errors; warnings are pre-existing `no-explicit-any` /
  `no-unused-vars` debt.

The suite uses the repository's in-memory Mongo harness with a serialized
transaction wrapper. The cumulative cap and true write-conflict retries are
database filters/behaviour and should also be exercised against a replica set
before a production migration if true parallel transactions are required. The
reconciliation CLI could not be run against a live cluster in this environment
(no MongoDB/Docker), so its `dry-run` output is not part of this verification.
