# Connected Business — A′.1 Independent Post-Correction Review

**Date:** 2026-11-23
**Scope:** `de81119`, `718bcfc`, `5d6d081`, `e4cad64`, reviewed together against `148f546`.
**Method:** read-only. No code, schema, index, flag or migration was changed. Nothing was pushed.
**Decision:** **APPROVE A′.1 WITH EXPLICIT CONDITIONS** — see §8.

---

## 1. Commits reviewed

| Commit | Subject | Purpose |
|---|---|---|
| `de81119` | A-prime.1 identity, membership and access gate | original implementation |
| `718bcfc` | enforce service-boundary authorization | A′.1-C1 correction |
| `e4cad64` | A-prime.1 final conformance review | historical record, left unedited |
| `5d6d081` | close A-prime.1 review findings | corrections under review |

Range: `148f546..5d6d081`. The historical review document still states BLOCK, as it should;
this document is the new decision, not a rewrite of that one.

---

## 2. Files and functions inspected

### Source (12 files)

`lib/types/business.ts` · `lib/types/business-intake.ts` · `lib/business/paths.ts` ·
`lib/business/permissions.ts` · `lib/business/flags.ts` · `lib/business/access.ts` ·
`lib/business/members.ts` · `lib/business/applications.ts` · `lib/business/service.ts` ·
`lib/db/collections.ts` · `lib/errors.ts` · `lib/business/testing/fake-collections.ts`

Functions read in full: `requireBusinessAccess`, `assertApplicationInBusiness`,
`addOwner`, `addMember`, `reactivateMember`, `removeMember`, `listMembers`, `resolveMember`,
`validateScope`, `createMember`, `createApplication`, `archiveApplication`, `getApplication`,
`listApplications`, `applicationAddress`, `splitAddress`, `createBusiness`, `getBusiness`,
`renameBusiness`, `archiveBusiness`, `listBusinessesForUser`, `canonicalBasePath`,
`normalizeHostname`, `permissionsForRole`, `businessWorkspaceMode`.

### Tests (11 files)

`paths` · `permissions` · `flags` · `access` · `members` · `applications` · `service` ·
`independence` · `no-owner-shortcut` · `authorization-coverage` · `testing/fake-collections`

### Documents (3)

Architecture reconciliation rev. 2, decisions addendum (treated as authoritative), A′ plan.

---

## 3. Verification (re-run, not taken from prior reports)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, no diagnostics |
| `npx vitest run` | 319 files, **3,876 passed**, 2 todo |
| `npm run lint` | 0 errors, 376 warnings (all pre-existing; 0 in `lib/business`) |
| `npm run build` | compiled successfully |
| Protected trees | `git diff 148f546..HEAD -- app/project lib/projects lib/marketing lib/cofounder lib/runtime` is empty |

Environment note: no `mongod` and no `mongodb-memory-server` are available, so no real
replica-set execution was possible within this review. §7 records the consequence.

---

## 4. Verdicts on F1–F6

### F1 — transaction session propagation — **PASS**

Every operation in the creation path now carries the session:

```
createBusiness → insertOne(business, { session })
              → addOwner(..., session)
                  → businessesCol.findOne({ id }, { session })
                  → businessMembersCol.countDocuments({ businessId }, { session })
                  → createMember(...)
                      → findOne({ businessId, userId }, { session })
                      → insertOne(member, { session })
```

The fake now models transaction visibility: any call made while `withTransaction` is open and
without `{ session }` throws. I confirmed the guard is load-bearing by reintroducing the original
defect (dropping `options` from one read) and observing **12 failures** with
`findOne ran inside a transaction without { session }`; restoring it returns the suite to green.
`fake-collections.test.ts` additionally proves the guard fires for reads and writes, permits
session-carrying calls, requires nothing outside a transaction, and clears state after a throw.

**Is a real replica-set test still necessary? Yes.** The fake models the visibility rule, not the
driver. It cannot exercise transaction retry on `TransientTransactionError`, write conflicts,
60-second transaction limits, or the actual duplicate-key payload from a partial unique index.
A single integration test against a replica set — create a business, assert one business and one
owner row, then attempt a second owner and assert rejection — is cheap and should gate A′.2 (§8, C2).

### F2 — application address security — **PASS**

`splitAddress` rejects any protocol outside `http`/`https`, rejects `username`/`password`, and
returns a `primaryUrl` rebuilt as `protocol + normalised hostname + canonical base path`. The stored
value is therefore derived from the same parse as the identity and cannot diverge from it.
Tests cover `HTTPS://Example.COM/shop/` → `https://example.com/shop`, credentialed URLs, and
`ftp://` / `data://`. Residual notes N3, N4 and N5 below.

### F3 — system actor restrictions — **PASS**

`SYSTEM_PERMISSIONS` is empty and the gate throws for any system actor with an explanatory message.
A system actor can no longer rename, archive or read a business. `addOwner` is unaffected because it
never used the gate; it requires `kind: "system"`, an existing business, and zero members.
`access.test.ts` now asserts refusal across `business.read`, `business.manage`, `apps.manage` and
`members.manage`. Note N2: the empty constant is now unread by production code.

### F4 — owner uniqueness — **PASS (design), unproven at the database**

`business_members_one_owner` is a partial unique index on `{ businessId: 1 }` where
`role: "owner"` and `status: "active"`. It is valid MongoDB, it does not conflict with
`business_members_unique`, and the fake models the same predicate. The duplicate path maps to
"This business already has an owner." rather than the generic member message.

What remains unproven is concurrency itself: the fake runs operations sequentially, so it cannot
demonstrate that two simultaneous insertions produce exactly one winner. That belongs to the same
integration test as F1.

### F5 — application scope — **PASS**

`getApplication` and `archiveApplication` supply `applicationId` to the gate, so an out-of-scope
member is refused. `listApplications` now filters returned rows by `member.scope` when the scope is
application-bound, and a test asserts a member scoped to `/shop` does not receive `/dashboard`.
`createApplication` is the exception — see N7.

### F6 — index bootstrap documentation — **PASS**

The comment now states that a failure is logged and retried, and that it prevents
`__mirrorIndexesReady` from being set for that attempt. That matches `runEnsureIndexes`.

### Service-boundary authorization — **INTACT**

All twelve data-touching operations still call the gate before their first write; the coverage test
asserts ordering, and the exemption list is unchanged apart from the documented entries.

---

## 5. Newly discovered issues

### N6 — a scoped member with `members.manage` can grant scopes they do not hold

`addMember` gates on `members.manage`, then validates that every application id in the requested
scope belongs to the business and is active. It never compares the requested scope with the
**actor's** scope.

A member created as `admin` with scope `[shop]` can therefore add a member with scope `[dashboard]`,
or with scope `all`. The scope mechanism is defeated from inside it.

Severity: medium. Intra-tenant, not cross-tenant, and unreachable today because no route exists.
But it is the same class of defect as F5, in the operation that creates memberships rather than the
one that lists applications. `reactivateMember` has the same shape.

### N7 — `createApplication` ignores application scope

The gate is called without `applicationId`, correctly, because the application does not exist yet.
The consequence is that a member scoped to `[shop]` who holds `apps.manage` can create a new
application at any path on the business. Scope restricts actions on existing applications, not the
creation of new ones.

Severity: low–medium. Whether this is acceptable is a product decision; the safe default is that
creating an application requires an unscoped `apps.manage`, since the new row belongs to nobody's
scope yet.

### N1 — `createBusiness` cannot carry a migration stamp

`createApplication` and `addOwner` accept `migration?: MigrationStamp` and write it.
`CreateBusinessInput` has no such field, and the constructed `BusinessDoc` never sets one.

Consequence for A′.2: a migration cannot stamp a business through the service. It must either write
the document directly — reimplementing the creation rule and the transaction — or the parameter
must be added first. `MigrationStamp` itself is well shaped (`id`, `runId`, `createdAt`), and
`runId` is what a rollback needs to scope its deletions.

### N5 — `hostVerified` is a caller-supplied flag

`CreateApplicationInput.hostVerified?: boolean` is written straight to the record. No route exposes
it yet, so nothing is exploitable today. When A′.3 wires a form, this must not be bindable from
request input: a host is verified by the verification flow or not at all.

### N3 — single-label hosts are rejected, and the reason is swallowed

`normalizeHostname` requires a dot (`DOMAIN_NO_DOT`), so `localhost` and internal single-label hosts
cannot be registered as applications. That is probably correct for a business product, but
`splitAddress` catches every `DomainInputError` and replaces it with the generic
"That doesn't look like a website address", so a founder typing `localhost` gets no hint why.

### N4 — ports are not part of application identity

`normalizeHostname` returns `url.hostname`, dropping the port. `example.com:8443` and
`example.com` are the same identity. This matches the existing domain-claim behaviour and is now
documented in `splitAddress`. Recorded so it is a decision rather than a surprise.

### N2 — `SYSTEM_PERMISSIONS` is dead

After F3 the gate no longer reads it; only `permissions.test.ts` does. Either delete it or have the
gate consult it, so the constant cannot drift into a false statement about what a system actor may
do.

### Observation — archived businesses remain listed

`listBusinessesForUser` returns archived businesses, since it filters only on membership status.
Likely intended (a founder must be able to find and restore one), but no requirement states it.

---

## 6. Requirement-by-requirement conformance

| Requirement | Source | Status |
|---|---|---|
| `businesses`, `connected_applications`, `business_members` documents | ADR-8, addendum §1 | PASS |
| Membership row is the authorisation source of truth | addendum §8.2 | PASS |
| `businesses.ownerId` never used for authorisation | addendum §6 | PASS |
| Owner holds every permission; admin differs only by `money.manage` | approved decision | PASS |
| Ownership cannot be granted or removed by member management | addendum §7.2 | PASS |
| One active owner per business | F4 | PASS (index), unproven concurrently |
| Explicit reactivation, role and scope revalidated, old scope not restored | addendum §8.3 | PASS |
| Reactivation records who and when | addendum §8.3 | PASS |
| Removal takes effect immediately, no cached decision | addendum §7 | PASS |
| Non-member → 404, insufficient permission → 403 | addendum §8.4 | PASS |
| Application-scope enforcement on single-application operations | D2 | PASS |
| Application-scope enforcement on listings | F5 | PASS |
| Application scope cannot be exceeded when granting membership | N6 | **FAIL** |
| Application creation respects scope | N7 | **FAIL** (undecided by design) |
| Canonical path identity, one spelling per origin | D1, addendum §6.1 | PASS |
| Path scoping is not a security boundary; `trustDomain` recorded | addendum §6.3 | PASS |
| Address scheme and credential validation | F2 | PASS |
| Archived and suspended fail closed | rev. 2 §9.4 | PASS |
| Archival preserves claims, events, members and charges | addendum §7 | PASS |
| Transactional creation of business and owner | F1 | PASS in code, unproven on a replica set |
| Partial unique indexes match MongoDB semantics | rev. 2 §5.2 | PASS |
| Migration stamps present on applications and memberships | addendum §10 | PASS |
| Migration stamps present on businesses | N1 | **PARTIAL** |
| Rollback can scope itself by run | `MigrationStamp.runId` | PASS (design), no rollback code yet (A′.2) |
| Import boundaries between business and project | rev. 2 §5.3 | PASS |
| Structural authorisation coverage, incl. arrow exports and nested modules | A′.1-C1 | PASS |
| Zero changes to protected project/runtime trees | ADR-8 | PASS |
| Flag defaults to off and fails closed | D4 | PASS |

---

## 7. Remaining risks and limitations

1. **No real database execution.** F1's fix is correct by construction and demonstrated against a
   harness that now models the failure, but the driver's behaviour under retry and conflict is
   untested. This is the single largest remaining risk, and it is cheap to close.
2. **No concurrency test.** F4 rests on an index that has never been built against a live server.
3. **N6 and N7 are service-layer holes** of the same family the previous review blocked on. They are
   intra-tenant and unreachable until a route exists, but "unreachable today" is not a security
   property.
4. **The structural test remains syntactic.** It proves a gate call precedes the first write; it
   cannot prove the gate's subject is the row written. That stays a review responsibility.
5. **`fake-collections.ts` is a model, not a database.** It now models visibility and partial
   uniqueness; it does not model write conflicts, transactions spanning collections under load, or
   index build failures.
6. **No production data was read**, so nothing here speaks to how the migration will behave on real
   legacy rows.

---

## 8. Decision

### APPROVE A′.1 WITH EXPLICIT CONDITIONS

The foundation is sound. Identity, ownership, the membership-as-authority model, the gate, the
response contract, canonical application identity, transactional creation and the import boundary
all match the approved architecture, and the six previous findings are genuinely fixed rather than
papered over. Cross-tenant isolation — the property this phase exists to establish — holds.

It is approved with conditions because three things remain that are not test-suite greenness:

**C1 — before any route is exposed (A′.3), fix N6 and N7.**
A member must not be able to grant a scope they do not hold, and application creation must not be
available to a scoped member unless that is a recorded product decision. Both need tests.

**C2 — before A′.2 writes any data, prove the transaction against a real replica set.**
One integration test: create a business, assert exactly one business and one owner row, then attempt
a second owner and assert rejection. This is the only way to close F1's and F4's remaining
uncertainty, and it must happen before migration, not after.

**C3 — decide N1 before the migration is written.**
Either add `migration?: MigrationStamp` to `createBusiness` (and to the document it builds), or
record explicitly that the migration writes businesses directly. Do not leave it to be discovered
mid-implementation.

**Housekeeping, may ride along with C1:** delete or use `SYSTEM_PERMISSIONS` (N2); take
`hostVerified` out of caller-supplied input (N5); surface the specific hostname error (N3).

### Phase boundary

A′.2 remains **unauthorised**. This review does not authorise migration work, schema changes, index
changes, flag activation or workspace UI. On your approval of this report, A′.2 becomes the next
phase and carries C2 and C3 as entry conditions.

### What this review did not do

No application code was modified, no schema or index changed, no migration executed, no flag
activated, nothing pushed, and the historical BLOCK review was left untouched. This document is the
only artifact created.
