# C3 — How the migration creates businesses

**Date:** 2026-11-23
**Status:** decided and verified against a real MongoDB replica set
**Applies to:** `lib/connected-business/migrate.ts` (A′.2)

---

## The question

`createBusiness` is the only supported way to create a business. It seats the
owner in the same transaction and enforces the creation rule. The migration
needs to create businesses too. Does it call `createBusiness`, or write the
documents itself?

## Decision

**The migration writes the documents directly.** It does not call
`createBusiness`.

## Why

`createBusiness` requires `actor.kind === "user"` and takes the owner from the
acting user:

```ts
if (input.actor.kind !== "user") {
  throw new AppError("VALIDATION", "A business is created by a signed-in person.")
}
```

That rule is the product's ownership guarantee: a business is always owned by
the person who created it, never by a caller-supplied id. A migration has no
acting user. Routing it through `createBusiness` would leave exactly two
options, both bad:

1. **Forge a user actor** for the owner — which makes the rule meaningless,
   because anyone with code access could then create a business owned by any
   user id.
2. **Loosen the rule** so a system actor may create a business with an
   arbitrary `ownerId` — which removes the guarantee from the product path too.

Writing the documents directly keeps the rule intact for the product and puts
the migration's authority where it belongs: in a stamped, reversible, offline
operation.

## How the invariants are preserved

| Invariant | How the migration preserves it |
|---|---|
| Atomicity | The business, the owner membership, the application and the domain link are written inside one `session.withTransaction`. Every call carries `{ session }`. A failure at any step leaves nothing behind. |
| Exactly one owner | The owner row is written with `role: "owner"`, `status: "active"`, `scope: { kind: "all" }` — the same shape `createBusiness` produces — and the partial unique index `business_members_one_owner` enforces it at the database. |
| Ownership matches the founder | The owner is `project.userId`; `businesses.ownerId` is set to the same value. |
| Authorisation source of truth | Nothing here relies on `ownerId`. The membership row is what the gate reads, exactly as for a founder-created business. |
| Migration stamps | One `MigrationStamp { id, runId, createdAt }` is minted per project and written to **all three** documents: the business, the owner membership and the application. |
| Reversibility | `rollbackMigration({ runId })` deletes only rows whose `migration.runId` matches, and detaches domain claims rather than deleting them. A founder-created business can never carry a run id, so it can never be rolled back. |
| Idempotency | `businesses.legacyProjectId` is unique (partial index), and the migration skips a project that already has a business. |

## What this duplicates, and how drift is prevented

The migration re-implements the *document shape* that `createBusiness`
produces. That is a real cost: if the creation shape changes, two places must
change.

Mitigations:

- Both paths are covered by tests. `createBusiness` is covered by the
  real-database test A and the unit suite; the migration is covered by the
  real-database test F and `migrate.test.ts`.
- `scripts/verify-connected-businesses.ts` checks the invariants on real data
  (one active owner per business, owner row matches `ownerId`, no duplicate
  origins, no dangling references).
- The shape is small and typed: both paths build a `BusinessDoc` /
  `BusinessMemberDoc` / `ConnectedApplicationDoc`, so a field change is a
  compile error in both.

## Evidence

Real replica set, test F (`test/integration/connected-business.mongo.test.ts`):

- a project migrates to a business, an owner membership and an application;
- all three carry `migration.runId === "run-int-1"`;
- the domain claim is linked to the business;
- a second run with a different run id skips the project and leaves one business;
- rollback by run id removes the three rows and detaches the claim.

## Residual risk

The migration still bypasses service-level validation (name trimming, address
canonicalisation). `applicationIdentityFrom` applies the same canonicalisation
as `splitAddress`, and a project whose address cannot be canonicalised migrates
as a business with no application and a recorded warning rather than failing the
run. That is deliberate: losing the business because its site address is odd
would be worse than migrating it without an application.
