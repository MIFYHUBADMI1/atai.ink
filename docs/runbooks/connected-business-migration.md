# Connected business migration runbook

Legacy projects become connected businesses in one migration run. This runbook
is the operator's procedure: what to run, in what order, what each answer means,
and how to undo a run.

The migration is idempotent and stamped. Every row it writes carries the run id,
so a rollback removes exactly what one run created and nothing else.

## Before you start

You need:

- a replica set. Apply uses transactions; a standalone `mongod` cannot run it.
- `MONGODB_URI` pointing at the target database.
- `tsx`. It is not a project dependency; the `npm run` commands below fetch it on
  demand with `npx --yes`. On a machine without network access, install it once
  (`npm i -g tsx`) and call `tsx` directly instead of `npx --yes tsx`.
- a run id you choose and record. Rollback needs it, so never invent it twice.

The scripts run through `tsconfig.scripts.json`, which maps `server-only` to a
no-op shim. Next aliases that package at build time; a bare Node process cannot,
and every migration module imports it.

## The sequence

Run these in order. Do not skip step 1, and do not reuse an earlier answer: the
data moves, and preflight answers a question about the data as it is now.

```bash
export MONGODB_URI='mongodb://host:27017/atai?replicaSet=rs0'

# 1. Readiness. Exits 1 on no-go.
npm run migrate:businesses:preflight

# 2. Plan. Writes nothing.
npm run migrate:businesses -- dry-run

# 3. Apply. The run id is the rollback handle.
npm run migrate:businesses -- apply --run-id=2026-11-24-a

# 4. Verify. Exits 1 if it finds a problem.
npm run migrate:businesses:verify
```

Scope a run with `--project=<id>` and `--user=<id>` (both repeatable), and cap it
with `--limit=<n>`. Both filters narrow the run when both are given.

## Reading the answers

Preflight prints a verdict.

- `VERDICT: GO` means nothing blocks the run.
- `VERDICT: NO-GO` means fix the listed `BLOCKING` items first. Two things block:
  the deployment is not a replica set, or a required unique index is missing.
  A missing unique index usually means duplicate rows already exist and prevent
  its creation. Find and resolve the duplicates; do not run without the index.

Preflight creates missing indexes before it checks for them. That is deliberate:
the question worth answering is whether the index can exist, not whether anyone
has touched the database yet.

Warnings never block, but read them:

- `project(s) have no owner and will be skipped` — the migration will not invent
  an owner. Decide what to do with those projects separately.
- `no usable site address` — the business is created without an application.
- `domain claim(s) already have an owner and will be left untouched` — those
  claims belong to somebody else and the run will not re-point them.
- `point at a business that does not exist` — pre-existing damage. Verify will
  report it too. It is not caused by the migration and is not repaired by it.

Dry run reports `planned`, `skipped` and `failed` per project. A `planned` count
that differs from the preflight `eligible` count means something changed between
the two commands.

Apply reports `created`. Compare `created + skipped` with `total`; a `failed`
count above zero means at least one project was not migrated. Fix the cause and
run apply again — it skips what it already created.

Verify reports counts and a `problems` list. An empty list is the only clean
result. `problems` names the specific row and what is wrong with it.

## Rolling back one run

Rollback only removes rows stamped with the run id, and only when no founder has
used them. If a migrated business was renamed, gained a member or gained an
application, rollback refuses and deletes nothing.

```bash
# Always read the impact first.
npm run migrate:businesses:rollback -- dry-run --run-id=2026-11-24-a

npm run migrate:businesses:rollback -- apply --run-id=2026-11-24-a

npm run migrate:businesses:verify
```

`--allow-in-use` is a separate recovery procedure for a business that founders
already used. It prints what it will orphan before proceeding. Read the dry run
first, and treat it as a data-loss decision, not a routine undo.

## Rehearsal evidence

The full cycle was run against a replica set with four legacy projects: one
normal, one with no site address, one with no owner, and one whose domain claim
was already owned by another business.

Preflight:

```
VERDICT: GO
Transactions available: yes
Missing indexes: none

TOTALS:
  projects                 4
  eligible                 3
  alreadyMigrated          0
  withoutOwner             1
  withoutSiteAddress       1
  domainClaims             3
  domainClaimsAlreadyOwned 1
  orphanApplications       0
  ownerlessBusinesses      0
  danglingDomainClaims     0

WARNINGS:
  - 1 project(s) have no owner and will be skipped: proj_gamma
  - 1 project(s) have no usable site address; they migrate as a business with no application.
  - 1 domain claim(s) already have an owner and will be left untouched (F-02).
```

Dry run and apply:

```
dry-run: total 4, planned 3, created 0, skipped 1, failed 0
apply:   total 4, created 3, skipped 1, failed 0   (run-id: rehearsal-2026-11-21)
```

Verify after apply: `businesses 4, applications 2, memberships 4, domains 3,
problems []`. Four businesses because the pre-existing owner was counted too.

Rollback: `applied true, blocked false, businesses 3, applications 2,
memberships 3, domains 2`. Verify after rollback: `businesses 1, applications 0,
memberships 1, domains 3, problems []`.

The domain claims after rollback show what the stamp buys:

```
dom_1 alpha.example      businessId=-                 migration=-
dom_2 delta.example      businessId=biz_someone_else  migration=-
dom_3 www.alpha.example  businessId=-                 migration=-
```

The two claims the run took were released. The claim another business already
owned was never touched.

The same cycle runs as integration test `I` in
`test/integration/connected-business.mongo.test.ts`, so it is checked on every
change rather than only when somebody remembers to rehearse it.

## After the migration

- Run verify once more after the rollout flag is enabled for real users.
- Keep the run id. Rollback is impossible without it.
- A second apply after the first is safe: already-migrated projects are skipped
  by `legacyProjectId`.
