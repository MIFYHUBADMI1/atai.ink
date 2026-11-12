# 01 — Payment tenant isolation (S-01)

**Status: PASS — implemented, tested, one documented completeness limitation.**

## Original vulnerability

A project-provisioned Runtime API key holding the `atai.payments` capability could read
the **platform-wide** Dodo account feed — every project's transactions, refund state and
revenue — because `listPayments` proxied the account-level Dodo endpoint without applying
the authenticated project's identity, and `listPayouts` returned Atai's own settlement
history to any project that asked.

## Verified root cause

| Layer | File | Cause |
|---|---|---|
| Capability adapter | `lib/runtime/router/adapters/dodo/adapter.ts:146-156` | Returned the raw provider page; identity available on `request.auth.projectId` but never applied. |
| Attribution | `lib/runtime/router/adapters/dodo/adapter.ts:198-208` | Checkout metadata was client-suppliable, so a caller could stamp any `projectId` (or none). |
| Payouts | `lib/runtime/router/adapters/dodo/mapper.ts:414-419` | Account-level payouts were translated and returned as if project-scoped. |
| Auth context | `lib/runtime/auth/authenticate.ts:182-191` | Trusted, server-side — the correct place to read identity from (already sound). |

## Authorization changes now in force

1. **Identity only from the key record.** Project identity for every payment read comes from
   `request.auth.projectId`, resolved from the hashed API key server-side. Request bodies,
   query strings and headers cannot override it; a caller-supplied `projectId` on a
   `listPayments` request is rejected outright.
2. **Server-stamped attribution only.** Checkout creation overwrites the reserved metadata
   keys (`ATTRIBUTION_METADATA_KEYS.projectId`, `adapter.ts:204`) with the authenticated
   project, so the stamp cannot be forged at creation time.
3. **Read filtering.** `listPayments` filters the provider page down to payments whose
   stamped `projectId` equals the authenticated project (`adapter.ts:150-153`). Unattributed
   records and other projects' records are dropped before mapping, so they never reach the
   caller in any shape.
4. **Fail closed.** A payment with no reliable attribution is absent from project-scoped
   responses; a page containing only foreign/untagged payments returns an empty list plus the
   honest `pageFull` signal — not another tenant's rows.
5. **Payouts denied.** `listPayouts` is refused in the adapter **before** any provider call
   (`adapter.ts:174-181`), with an audit log line naming the key. Atai has no verified
   connected-account payout architecture, so per §4.3D project-scoped payout access is not a
   thing that can be safely scoped. The mapper's payout *translators* remain for authorized
   platform/admin contexts and their tests, and the comment at `mapper.ts:414-419` was
   corrected to say exactly that.
6. **Retrieval by ID / refunds: no attack surface.** The `atai.payments` capability exposes
   only `listPayments`, `listPayouts` and checkout creation. There is no `getPayment(id)` and
   no refund operation, so §4.3C has nothing to bypass today. If such an operation is added it
   must re-verify the stamped attribution before returning the record.
7. **Admin and founder paths untouched.** Platform/admin finance surfaces read Atai's own
   records through admin-authenticated routes, not through Runtime keys. Ordinary user routes
   read only rows keyed by their own user id.
8. **Webhooks.** The Dodo webhook path stays signature-verified with dedupe, and persists the
   trusted attribution rather than metadata asserted by an unverified caller.

## Before → after

| Call (as Project A's key) | Before | After |
|---|---|---|
| `listPayments` on a mixed account feed | Returned Project B and untagged rows | Project A's stamped rows only |
| `listPayments` where the whole page is foreign | Leaked a page of another tenant | Empty list, `pageFull` reported honestly |
| `listPayouts` | Platform settlement history | Denied, no provider call |
| Checkout with forged `projectId` metadata | Attacker-chosen attribution | Server overwrites with the authenticated project |
| Admin finance dashboard | unchanged | unchanged |
| Atai subscription billing / webhooks | unchanged | unchanged |

## Tests

`lib/runtime/router/adapters/dodo/payments.test.ts` — 32 tests, co-located, no network:
own / foreign / untagged attribution, a fully foreign page, caller-supplied `projectId`
rejection, payout denial asserting **zero** provider calls, metadata overwriting, and the
`pageFull` behaviour at both mapper and adapter level (new in Phase 0: `pageFull` is compared
against the *requested* page size, not the constant 100, so a full 10-item page no longer
reports "more available" and a 10-item page of a 10-item request reports incompleteness
correctly — `mapper.ts:369-408`, `adapter.ts:149`).

Directives §4.4 items 1-9, 12, 13 are covered by these tests. Items 10-11 (admin access and
subscription billing still work) are covered by the existing admin/finance and billing suites
plus the full-suite and production-build runs in `06-PHASE-0-TEST-AND-REGRESSION-REPORT.md`.

## Remaining limitations

- **No cursor.** Dodo's feed is account-wide and is filtered *after* paging, so attributed
  payments older than the first raw page are currently unreachable from a project key. This
  fails closed and is now disclosed honestly through `pageFull`, but it is not a complete
  history API. A real fix needs either provider-side metadata filtering or an Atai-side
  payment-record projection built at webhook time.
- Attribution depends on the stamp written at checkout creation. Payments created before
  stamping existed stay invisible to project keys by design (fail closed), not leaked.
