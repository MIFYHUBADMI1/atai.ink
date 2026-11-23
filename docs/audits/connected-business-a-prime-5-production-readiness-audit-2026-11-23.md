# Connected Business — A′.5 Independent Production-Readiness Audit

**Date:** 2026-11-23
**Audited commit:** `ff777cb` (`feat/connected-business-a-prime-1`)
**Audit type:** read-only. No application code, schema, index or data was modified.
**Auditor's stance:** adversarial. The question is not "do the tests pass" but
"what happens to a founder, a project or a charge if this runs in production".

---

## 1. Scope and method

Reviewed the 46 files the branch touches (`718bcfc..ff777cb`), plus the
pre-existing `lib/connected-business/*` bridge that it depends on.

Method:

- read every service, route, page and script in the branch;
- ran the business suites (`14 files, 140 tests`) and the full gate;
- built a **throwaway** local replica set and ran `explain("executionStats")`
  against the exact query shapes the services issue, to test whether the
  corrected indexes are actually used;
- queried the GitHub API for PR and workflow-run state on this branch;
- verified the protected-tree diff against `148f546` (the merge base with main).

Nothing was executed against production or staging. Nothing was migrated.

---

## 2. Executive verdict

# APPROVE WITH CONDITIONS

The implementation is **substantially sound**. The authorization model is
unusually careful: one gate, membership as the source of truth, scope
containment on grants, no system-actor business permission, and a structural
test that fails when an operation forgets to authorise itself. The A′.4 index
correction is valid and I confirmed it on a real server.

It is **not yet safe to run the migration**. Two conditions are operational
rather than architectural, and both are about *undo*:

1. **Rollback deletes businesses that founders have since used** (F-01, High).
2. **Archiving is irreversible** — the gate blocks all writes on an archived
   business and no restore operation exists (F-05, Medium).

Neither requires redesign. Both must be closed before `migrate --apply`.

**Code may merge behind the flag. Production migration is not authorised.**

---

## 3. Findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| F-01 | **High** | Rollback deletes migrated businesses after they have been used | `rollback.ts:31-51` |
| F-02 | Medium | Migration overwrites an existing domain claim unconditionally | `migrate.ts:189` |
| F-03 | Medium | Rollback detaches domain claims added *after* the migration | `rollback.ts:38-47` |
| F-04 | Medium | Index predicate ≠ query predicate → application lookups scan | `applications.ts`, explain below |
| F-05 | Medium | Archiving is irreversible; no restore operation exists | `access.ts:52-55` |
| F-06 | Medium | CI has never run on this branch; replica-set suite unproven | GitHub API, `ci.yml:3-5` |
| F-07 | Medium | `apply` accepts a generated run id, so a run can be unrecorded | `migrate-connected-businesses-v1.ts:24` |
| F-08 | Medium | Migration loads every project into memory | `migrate.ts:223` |
| F-09 | Medium | No rate limit or quota on business or membership writes | `app/api/businesses/**` |
| F-10 | Medium | `verify` reports legitimate states as problems | `verify.ts:54-62` |
| F-11 | Low | Creation paths disagree on `status` (`draft` vs `active`) | `service.ts:60`, `migrate.ts:93` |
| F-12 | Low | `DELETE /members/:id` returns `{ member: undefined }` | `members/[userId]/route.ts:15-16` |
| F-13 | Low | A suspended business renders a 500 page instead of a message | `app/business/[businessId]/page.tsx:38-43` |
| F-14 | Low | `suggestedNameSource` can be stored without `suggestedName` | `service.ts:79-83` |
| F-15 | Low | Ports are silently dropped from `primaryUrl` | `applications.ts` `splitAddress` |
| F-16 | Low | Migration stamps and `legacyProjectId` are returned to clients | `app/api/businesses/route.ts` |
| F-17 | Low | Dangling doc comment at end of `permissions.ts` | `permissions.ts:104` |
| F-18 | Low | `test-replica-set.sh` treats a zombie process as running | observed, `kill -0` |
| F-19 | Low | `loadProjects` silently prefers `projectIds` over `userIds` | `migrate.ts:216-220` |
| F-20 | Low | No consent flow: an owner can add any user id | `members.ts` `addMember` |

### F-01 — Rollback deletes businesses founders have since used (High)

```ts
// lib/connected-business/rollback.ts:31
const stamped = { "migration.runId": options.runId }
...
await (await connectedApplicationsCol()).deleteMany(stamped)
await (await businessMembersCol()).deleteMany(stamped)
await (await businessesCol()).deleteMany(stamped)   // line 51
```

The only filter is the stamp. Nothing checks whether the business changed after
it was created, and nothing clears the stamp when it does:

- `renameBusiness` sets `name`/`updatedAt` only (`service.ts:113-117`);
- `addMember`, `createApplication`, `archiveBusiness` never touch `migration`.

So this sequence deletes a live business:

1. migration stamps business `biz_x`;
2. the founder renames it, adds a colleague, connects a second application;
3. an operator rolls back the run to undo *one* bad project;
4. `biz_x`, its memberships and its applications are gone.

Stamps are per-run, not per-row, so a rollback cannot be narrowed to the row
that was wrong.

**Condition:** refuse rollback for any business whose `updatedAt` exceeds
`migration.createdAt`, or whose memberships/applications are not all stamped
with the same run, unless an explicit `--force-modified` is passed and the
affected ids are printed first.

### F-02 — Migration overwrites an existing domain claim (Medium)

```ts
// lib/connected-business/migrate.ts:189
await (await businessDomainsCol()).updateMany({ projectId: project.id }, { $set: set }, { session })
```

`set` always contains `businessId`, so any pre-existing `businessId` on those
claims is replaced without a check. Today no domain carries a `businessId`
before the first migration, so this is latent — but a re-run after a partial
rollback, or a claim created by a future feature, would be silently re-pointed.

**Condition:** constrain the update to `{ projectId, businessId: { $exists: false } }`
and report the skipped rows.

### F-03 — Rollback detaches claims added after migration (Medium)

```ts
// rollback.ts:38-47
const domains = ... find({ businessId: { $in: businessIds } })
await ... updateMany({ businessId: { $in: businessIds } }, { $unset: { businessId: "", applicationId: "" } })
```

Selection is by *business*, not by run. A domain the founder connected after
migration is detached by the rollback even though no migration created it.
Claims are not deleted, so this is recoverable, but the founder's connection
silently breaks.

### F-04 — Index predicate and query predicate disagree (Medium)

A′.4 changed the partial predicate to `{ archivedAt: null }`, but the services
still query `{ archivedAt: { $exists: false } }`. MongoDB cannot prove the query
implies the index predicate, so the index is not used. Measured on a local
replica set with 200 applications:

```
duplicate check  $exists:false -> COLLSCAN | docsExamined=200 | returned=1
duplicate check  null         -> origin   | docsExamined=1   | returned=1
list apps        $exists:false -> COLLSCAN | docsExamined=200
```

Correctness is unaffected — the unique index is enforced on write regardless of
the query. Every application list and every duplicate check scans the whole
collection. Affected: `listApplications`, `getApplication`, `archiveApplication`,
`createApplication`, `assertApplicationInBusiness`, `validateScope`.

**Condition:** use `archivedAt: null` in queries too, or add a test that asserts
the query plan.

### F-05 — Archiving is irreversible (Medium)

`access.ts:52-55` blocks every write permission on an archived business, and
`archiveBusiness` itself requires `business.manage` — a write. No
`restoreBusiness` exists anywhere in `lib/business`, `app/api/businesses` or the
UI (verified by grep). The error message tells the user to "Restore it before
making changes", which no code path can do.

The Settings screen offers "Archive business" behind a single confirm and does
not warn that it is one-way. Recovery requires direct database surgery.

### F-06 — CI has never run on this branch (Medium)

- `.github/workflows/ci.yml:3-5` triggers on `push: branches: [main]` and
  `pull_request`.
- GitHub API: `pulls?head=...feat/connected-business-a-prime-1&state=all` → `[]`;
  `actions/runs?branch=feat/connected-business-a-prime-1` → `total_count: 0`.

The replica-set integration step has **never executed**. It is written
carefully (container on 27018, `rs.initiate`, primary wait, `exit 1` on
timeout) but unproven.

Also: CI uses `mongo:7`, verification ran on **8.0.4**, and no file in the
repository states which MongoDB version production runs. Branch protection could
not be read (403), so "failures block merging" is unconfirmed.

### F-07 — `apply` accepts a generated run id (Medium)

```ts
// scripts/migrate-connected-businesses-v1.ts:24
const runId = ...?.slice(9) || randomUUID()
```

A dry run with a generated id is harmless. An **apply** with a generated id
leaves a stamp nobody recorded; rollback then requires finding it with
`distinct("migration.runId")` on three collections. `rollback` requires
`--run-id`; `migrate apply` does not.

### F-08 — Migration loads every project (Medium)

`migrate.ts:223` is `find(filter).toArray()` with no cursor and no projection.
On a large `projects` collection this holds every document in memory before the
first write. The per-project loop is already sequential; a cursor would be
equivalent and bounded.

### F-09 — No rate limit or quota (Medium)

No route under `app/api/businesses` calls `checkRateLimit`, although
`lib/auth/rate-limit.ts` exists and `lib/api/ai-quota.ts` uses it. Within the
flag, one account can create businesses, applications and members without limit.

### F-10 — `verify` reports legitimate states (Medium)

```ts
// verify.ts:59
const origin = `${application.hostname}${application.basePath}`
```

The map is keyed on origin alone: it ignores `archivedAt` (an archived
application and its replacement legitimately share an origin, and the unique
index permits it) and ignores `businessId` (the index is per business). A
correct database can therefore produce `problems` and exit non-zero, which would
block a deploy gate that trusts it.

### Low findings

- **F-11** `createBusiness` writes `status: "draft"` (`service.ts:60`); the
  migration writes `"active"` (`migrate.ts:93`). The C3 record claims one shape.
  Decide which is right and document it.
- **F-12** `removeMember` returns `void`; the route returns `ok({ member })`,
  so the payload is `{}` (`members/[userId]/route.ts:15-16`).
- **F-13** The business page maps only `BUSINESS_NOT_FOUND`/`NOT_FOUND` to 404;
  `BUSINESS_SUSPENDED` and `BUSINESS_FORBIDDEN` become a 500 error page.
- **F-14** `suggestedNameSource` can be stored without `suggestedName`
  (`service.ts:79-83`), producing a source with no suggestion.
- **F-15** `splitAddress` rebuilds `primaryUrl` without the port, so
  `https://example.com:8080/shop` is stored as `https://example.com/shop`.
- **F-16** `GET /api/businesses` and the workspace page pass raw `BusinessDoc`
  objects to the client, including `migration.runId` and `legacyProjectId`.
- **F-17** `permissions.ts` ends with a doc comment that has no declaration
  under it (a leftover from the removed `SYSTEM_PERMISSIONS`).
- **F-18** `test-replica-set.sh` uses `kill -0` on the pidfile; a defunct
  process satisfies it, so `start` reported "already running" and then failed to
  connect. Observed during this audit.
- **F-19** `loadProjects` uses `if (projectIds) ... else if (userIds)`, so
  passing both silently ignores `userIds`.
- **F-20** Membership is granted unilaterally: an owner can add any user id, and
  that business then appears in the added user's list. There is no invite or
  accept step. This grants the added user access to the owner's data (chosen by
  the owner) and pollutes the added user's workspace (not chosen by them).

---

## 4. Database and migration safety assessment

**Index definitions.** All five connected-business indexes exist on a real
server after `ensureIndexes()`, with the expected keys and predicates
(`business_members_one_owner` partial on `role`/`status`;
`connected_applications_origin_unique` partial on `archivedAt: null`; both
`legacyProjectId` partials on `$type: "string"`). The A′.4 correction is valid:
`$exists: false` is rejected by MongoDB in a partial predicate and `field: null`
is accepted; I re-confirmed both on 8.0.4. The bootstrap now completes past the
previously failing index — `business_domains` carries all six of its indexes,
which it did not before.

**Transaction boundaries.** Creation and migration each wrap their writes in one
`withTransaction` with `{ session }` on every operation. `addOwner` re-reads the
business and the member count inside the session, so it cannot miss the
uncommitted insert. Rollback is **not** transactional: the domain detach and the
three deletes are separate calls. A crash between them leaves detached claims
and surviving rows; re-running recovers, because every step is idempotent.

**Idempotency.** Correct, and dependent on `businesses_legacy_project_unique`
existing — which it did not before A′.4. Two concurrent runs would previously
have created two businesses per project; now the second insert fails and is
reported as `failed`.

**Partial failure.** Per-project transactions mean a failure on project 7 leaves
1-6 committed and 8+ unprocessed; the loop records `failed` and continues, and
the script exits 1. Re-running retries only the unmigrated projects. Correct.

**Ownership.** Every migrated business gets exactly one owner row matching
`project.userId`, enforced by the partial unique index and re-checked by
`verify`. Migration does **not** verify that the user exists; a project with a
dangling `userId` produces an owner row with an absent `userId` (the client
omits `undefined`), i.e. a business nobody can open.

**Legacy data shapes.** `applicationIdentityFrom` tolerates a missing,
malformed, credentialed or non-http address by migrating the business without an
application and recording a warning. No legacy-shape sample data was available
to test against real documents.

**Silent overwrites.** One: F-02.

## 5. Authorization and API assessment

**Every operation passes the gate.** Verified structurally and by reading:
19 exported operations across the four service modules (`access`, `applications`,
`members`, `service`), 7 justified exemptions, 12 gated
(`requireBusinessAccess` itself, `createBusiness`, `addOwner`,
`listBusinessesForUser`, two type guards, one formatter), plus a test that fails
on a stale exemption. `http.ts` (flag check and actor constructor) is classified
as pure and holds no data.

**No cross-business access.** The gate loads the business by id, then the
membership by `(businessId, actor.id)`. An application id is validated against
the business before scope is applied, and a foreign or archived application is
`NOT_FOUND`, not `FORBIDDEN`.

**Scope cannot be bypassed.** `listApplications` filters in memory;
`getApplication`/`archiveApplication` pass the id to the gate; `createApplication`
refuses a scoped member outright, because a new application belongs to nobody's
scope.

**Membership cannot escalate.** `addMember`/`reactivateMember` refuse `owner`,
validate every application id belongs to the business, and require the granted
scope to contain the requested one. `removeMember` refuses to remove an owner.

**Archived and suspended fail closed for writes.** Archived: all write
permissions rejected. Suspended: all writes rejected, reads limited to
owner/admin. Draft: normal. Reads on archived businesses remain open to members,
which is deliberate and defensible.

**Flag isolation is complete.** All six route handlers and both pages call the
flag; outside the rollout they answer 404. Unrecognised values mean `off`.

**API error surface.** Consistent `AppError` codes. Two blemishes: F-12 and F-13.

**Rate limiting.** Absent (F-09).

---

## 6. CI and deployment assessment

The integration step is correctly constructed — a replica-set container on
27018, `rs.initiate` advertising the published port, a primary wait loop, and a
failing `exit 1` if no primary appears. The ordering (unit → replica set →
integration → build) is right.

What is not established:

- it has never run (F-06);
- CI uses `mongo:7`, this audit used 8.0.4, production's version is undocumented;
- the image tag `mongo:7` is floating, not a digest;
- branch protection could not be inspected, so "failures block merging" is
  unverified;
- the integration suite is *skipped*, not failed, when `MONGODB_REPLICA_URI` is
  missing. That is right for developers, but a CI misconfiguration would show
  green with zero database tests. Consider asserting `Tests 6 passed` in CI.

## 7. Protected boundaries

```
git diff --stat 148f546..HEAD -- app/project lib/projects lib/marketing lib/cofounder lib/runtime
(empty)
```

Zero changes. No protected module imports `lib/business`; `app/project/**`
imports only the pre-existing `isConnectedBusiness` guard, which predates this
branch. The new surface is additive.

## 8. Outstanding conditions before production migration

Blocking:

1. **F-01** — a rollback guard on modified businesses, with a printed impact list.
2. **F-05** — a restore path, or an explicit documented decision that archive is
   permanent, plus UI copy that says so.
3. **F-06** — the CI job must actually run and pass on a PR, on a MongoDB
   version pinned to production's.

Strongly recommended:

4. **F-07** — require `--run-id` for `apply`.
5. **F-02** — guard the domain `$set`.
6. **F-10** — fix `verify` so its exit code can be trusted as a gate.
7. **F-04** — align query and index predicates, or accept and document the scan.

Before the flag opens to founders: F-09 (rate limits), F-13 (error page), F-12,
F-11, F-15, F-16.

## 9. What was and was not tested

**Actually executed in this audit:**

- the business unit suites: `14 files, 140 tests`, passing;
- a throwaway local replica set (`rs0`, 8.0.4) used for `explain()` evidence;
- the GitHub API for PR and workflow-run state;
- `git diff` for the protected-tree check.

**Verified by reading only (not executed):**

- rollback against modified data (F-01) — reasoned from the filter, not run;
- migration against real legacy shapes (no sample data available);
- the CI workflow (no Docker daemon here; the branch has no run);
- branch protection (403).

**Not tested at all:**

- production or staging data;
- a multi-node replica set (failover, stepdown);
- MongoDB versions other than 8.0.4;
- concurrent migration runs against a real cluster;
- load or performance behaviour at production volume.

**Not changed:** no application code, schema, index, migration, flag or
production data. This report is the only artefact.
