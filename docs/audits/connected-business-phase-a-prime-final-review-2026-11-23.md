# Connected Business — A′.1 Final Architecture Conformance Review

**Date:** 2026-11-23
**Scope:** `de81119` and `718bcfc`, reviewed together against their common parent `148f546`.
**Method:** read-only. No code changed, no schema applied, no migration executed, no production data accessed.
**Decision:** **BLOCK A′.1** — see §8.

---

## 1. Commits reviewed

| Commit | Subject | Files | Lines |
|---|---|---|---|
| `de81119` | `feat(connected-business): A-prime.1 identity, membership and access gate` | 21 | +2,218 |
| `718bcfc` | `fix(connected-business): enforce service-boundary authorization` | 7 | +722 / −150 |
| `b3032fb` | `docs(connected-business): reconcile architecture for ADR-8` | 3 | docs only |

Reviewed range: `148f546..HEAD` (25 files, +4,376). The branch
`feat/connected-business-a-prime-1` points at `718bcfc`; `origin/main` remains at `148f546`.

---

## 2. Files reviewed

### Source (12)

| File | Lines | Verdict |
|---|---|---|
| `lib/types/business.ts` | 117 | pass |
| `lib/business/paths.ts` | 80 | pass, with note §4.6 |
| `lib/business/permissions.ts` | 94 | pass, finding F3 |
| `lib/business/flags.ts` | 35 | pass |
| `lib/business/access.ts` | 94 | pass, finding F3 |
| `lib/business/members.ts` | 289 | **FAIL — F1**, findings F4 |
| `lib/business/applications.ts` | 204 | **FAIL — F2**, finding F8 |
| `lib/business/service.ts` | 158 | **FAIL — F1** |
| `lib/db/collections.ts` | +49 | pass, nit F6 |
| `lib/errors.ts` | +15 | pass |
| `lib/types/business-intake.ts` | +8 | pass |
| `lib/business/testing/fake-collections.ts` | 108 | pass, but it masks F1 (§5.2) |

### Tests (10)

| File | Tests | Verdict |
|---|---|---|
| `lib/business/paths.test.ts` | 9 | pass |
| `lib/business/permissions.test.ts` | 10 | pass |
| `lib/business/flags.test.ts` | 4 | pass |
| `lib/business/access.test.ts` | 13 | pass |
| `lib/business/members.test.ts` | 25 | pass (cannot catch F1) |
| `lib/business/applications.test.ts` | 16 | pass (cannot catch F2) |
| `lib/business/service.test.ts` | 15 | pass (cannot catch F1) |
| `lib/business/independence.test.ts` | 2 | pass, limits §5.3 |
| `lib/business/no-owner-shortcut.test.ts` | 2 | pass, limits §5.3 |
| `lib/business/authorization-coverage.test.ts` | 5 | pass, limits §5.1 |

### Documents (3)

`connected-business-architecture-reconciliation-2026-11-21.md` (rev. 2),
`connected-business-decisions-addendum-2026-11-21.md` (binding), and
`connected-business-phase-a-prime-plan-2026-11-21.md` were read in full. The addendum was treated
as authoritative wherever it conflicts with rev. 2.

---

## 3. Verification gate (re-run)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, no output |
| `npx vitest run` | 318 files, **3,863 passed**, 2 todo |
| `npm run lint` | 0 errors, 376 warnings — all pre-existing, 0 in `lib/business` |
| `npm run build` | compiled successfully |

The gate is green. **It does not cover F1 or F2**, and §5.2 explains why the suite is
structurally incapable of catching F1.

---

## 4. Findings

### F1 — BLOCKER: `createBusiness` cannot succeed against a real database

`lib/business/service.ts:66-78` creates the business and its owner inside one transaction:

```ts
await session.withTransaction(async () => {
  await (await businessesCol()).insertOne(business, { session })
  await addOwner({ businessId: business.id, userId: input.actor.id, actor: systemActor("business-creation"), now, session })
})
```

`addOwner` then reads **without the session**:

```ts
// lib/business/members.ts:69
const business = await (await businessesCol()).findOne({ id: input.businessId })
if (!business) throw new AppError("BUSINESS_NOT_FOUND")
// lib/business/members.ts:72
const existing = await (await businessMembersCol()).countDocuments({ businessId: input.businessId })
```

A read issued without `{ session }` is not part of the transaction and observes only committed
state. The business was inserted inside the transaction moments earlier and is therefore invisible.
`findOne` returns `null`, `addOwner` throws `BUSINESS_NOT_FOUND`, `withTransaction` aborts and rolls
back the insert, and `createBusiness` rejects.

**Net effect: every business creation fails in production.** No business can exist, so no
membership, application or workspace can either.

This is not speculative. It follows from the driver contract, and the repository already follows the
correct pattern elsewhere — `lib/runtime/keys/rotate.ts:72` reads with
`keys.findOne({ id: keyId, userId }, { session })` and comments that the load happens
"inside the transaction".

The same omission exists at `lib/business/members.ts:252` (`createMember`'s `findOne`). It is
benign today only because a fresh business has no members to find; it must be corrected for the same
reason.

**Required correction**

1. Thread `session` through every collection call made while a transaction is open:
   `addOwner` (`findOne`, `countDocuments`), `createMember` (`findOne`), and any future read on the
   creation path.
2. Add a test that fails on this class of defect rather than on this instance: a fake collection that
   throws when `options.session` is missing while a transaction is open. Today
   `fakeSession().withTransaction` simply calls the callback over shared arrays, which is precisely
   why the suite is green.

### F2 — BLOCKER: `primaryUrl` can persist embedded credentials and non-HTTP schemes

`lib/business/applications.ts:78` stores the raw input:

```ts
primaryUrl: input.url.trim(),
```

while identity is derived from `parsed.hostname` and `parsed.pathname` (`:181`, `:188`). Verified
with Node:

| Input | `hostname` | `pathname` | stored `primaryUrl` |
|---|---|---|---|
| `https://user:pass@example.com/shop` | `example.com` | `/shop` | `https://user:pass@example.com/shop` |
| `data://example.com/x` | `example.com` | `/x` | `data://example.com/x` |
| `ftp://example.com` | `example.com` | `/` | `ftp://example.com` |

Two consequences:

1. A credential typed into the address field is persisted in `connected_applications.primaryUrl`,
   where it can reach a UI, a log line, an event payload or an AI prompt. `lib/domain/host.ts`
   deliberately rejects credentialed URLs in `assertSiteUrl`; this path does not use it.
2. The scheme is unconstrained. `javascript:` happens to fail only because its hostname is empty;
   `data://` and `ftp://` are accepted and stored.

**Required correction**

1. Reject `parsed.username !== "" || parsed.password !== ""` with a validation error.
2. Accept only `http:` and `https:`.
3. Store a canonical origin (`protocol + hostname + basePath`) instead of the raw input, so the
   stored value cannot diverge from the identity used for uniqueness.

### F3 — System actor holds `business.manage` (answered directly)

`lib/business/permissions.ts:94` grants a system actor exactly `business.manage`, and
`lib/business/access.ts:47-51` returns before the archived and suspended checks. Consequences:

- a system actor can rename and archive **any** business, including suspended and archived ones;
- it cannot touch members or applications (those need `members.manage` / `apps.manage`), which is
  correct;
- no HTTP path can construct a system actor (`systemActor()` is code-only), so this is not remotely
  reachable today.

**Assessment: unnecessary.** The only system caller in A′.1 is `addOwner`, which does not use the
gate at all — it enforces its own rule (system actor, business exists, zero members). The planned
A′.2 migration writes through collections directly and needs no gate permission either.

**Recommended correction:** reduce `SYSTEM_PERMISSIONS` to the empty set and have the gate reject
system actors outright with a distinct message, or keep the capability but record in the addendum
why a background job may rename a customer's business. This is a decision for the architecture
owner; either option is one small change, and the existing test
"limits a system actor to its single permission" must be updated to match.

### F4 — `addOwner` is not concurrency-safe

`countDocuments(...) > 0` followed by a separate insert is a check-then-act. Two concurrent system
callers could both observe zero members and seat two different owners. The unique index is
`(businessId, userId)`, which does not prevent two distinct users from both becoming owners.

Reachable only from internal code, and `createBusiness` runs it inside a transaction, so the
practical exposure is low. **Recommended:** either state the single-caller assumption in the
function's contract, or enforce one active owner with a partial unique index on
`{ businessId: 1 }` where `role: "owner"` and `status: "active"` — but only if the product
intends a single owner, which the addendum does not yet settle.

### F5 — `listApplications` is not filtered by a member's application scope

`getApplication` (`apps.read` at `applications.ts:135`) and `archiveApplication`
(`apps.manage` at `:111`) pass `applicationId`, so a scoped member is correctly refused outside their scope. `listApplications`
(`apps.read` at `:153`) gates without an application id, so a member scoped to `/shop` receives metadata for
`/dashboard` as well.

Low severity — names, hosts and paths, not the applications' data — but it is an inconsistency, and
a scoped contractor seeing sibling properties may not be intended. **Recommended:** when
`member.scope.kind === "applications"`, filter the returned rows to the scoped ids.

### F6 — Index comment overstates isolation (nit)

`lib/db/collections.ts:946-948` says each index is "additive, so a failed build never blocks the rest
of the bootstrap". A failure inside the new batch rejects `runEnsureIndexes`, so
`__mirrorIndexesReady` is never set and the whole bootstrap retries on the next call. Earlier batches
have already been applied, so nothing is lost — but the sentence is not accurate as written.

### F7 — `getBusiness` is unreachable for a system actor

`getBusiness` requires `business.read`; a system actor holds only `business.manage`. No consumer
needs it today. Recorded so that A′.2's verification script does not accidentally depend on a
service the system actor cannot call — it should use the collections directly, as planned.

---

## 5. Structural-test reliability

### 5.1 What `authorization-coverage.test.ts` actually proves

It proves a **syntactic** property: within each exported function's source segment, the string
`requireBusinessAccess(` appears before the first `.insertOne(`/`.updateOne(`/`.delete*` call, or the
function is on the exemption list.

It does not prove that the gate's subject is the row being written. A function could gate business A
and write to business B and pass. It also cannot see behaviour at all — F1 is a runtime defect in
gated code that the test happily accepts.

Blind spots, assessed against the current tree:

| Blind spot | Exploitable today? | Note |
|---|---|---|
| `export const f = async () => {}` is not parsed | no — no such export exists in `lib/business` | will matter when modules are added |
| `readdirSync` is not recursive | no — only `testing/` exists as a subdirectory | E′ plans `lib/business/specialists/*`, which would be skipped entirely |
| a gate call in a comment or dead branch satisfies the check | contrived | syntactic, not semantic |
| gate on one id, write another | not detected | needs per-operation behavioural tests |
| `export { x }` re-exports | no | — |

The "fails when a new ungated mutator is introduced" test is genuine: it feeds a synthetic
`deleteBusiness` through the same function and requires it to be flagged. That is the right shape of
self-test.

**Recommended hardening (not blocking):** make the scan recursive, parse arrow-function exports, and
add a sentence to the test's doc comment stating the syntactic limit so no future reader over-trusts
it.

### 5.2 Why the suite could not catch F1

`lib/business/testing/fake-collections.ts` implements `withTransaction` as
`async (fn) => fn()` over shared arrays. There is no isolation, no uncommitted state, and no
visibility rule. Every test therefore exercises a database that cannot exhibit the defect. The fake
is honest about being a fake, but the suite's green result says nothing about transactional
correctness.

This is the single most important lesson of the review: the tests validate *logic*, and F1 is a
*plumbing* defect. The proposed session-enforcing fake (F1, correction 2) closes the gap for this
class.

### 5.3 `independence.test.ts` and `no-owner-shortcut.test.ts`

- `independence.test.ts` walks both directions recursively and would fail on any `@/lib/business` ↔
  protected-tree import. Its `importedSpecifiers` regex captures any specifier, but the comparison
  only tests `@/`-prefixed ones (`underPrefix(specifier, "@/lib/projects")` etc.). A **relative**
  import such as `../../projects/foo` would evade it. Low risk; worth resolving relative paths
  before comparing.
- `no-owner-shortcut.test.ts` is a naming heuristic: it matches `businessId === userId`-style
  comparisons. A comparison through differently named variables would not be caught. It is a useful
  tripwire, not a proof.

---

## 6. System actor assessment

| Question | Answer |
|---|---|
| Can a system actor be constructed from a request? | No. `systemActor()` is only called in `service.ts` and tests. |
| What can it do? | `business.manage` only: rename and archive any business, including suspended and archived ones. |
| Can it touch members or applications? | No — those require `members.manage` / `apps.manage`. |
| Does anything need that capability? | No. `addOwner` bypasses the gate and enforces its own narrower rule; the planned migration writes directly. |
| Recommendation | Reduce to no gate-granted permissions, or document the capability deliberately. See F3. |

---

## 7. Requirement-by-requirement compliance

| Requirement | Source | Status | Evidence |
|---|---|---|---|
| First-class `businesses`, `connected_applications`, `business_members` | ADR-8, addendum §1 | PASS | `lib/types/business.ts`; accessors in `collections.ts` |
| Business owns claims, applications, events, members | rev. 2 §5.1 | PARTIAL (by phase) | events/integrations are B′/later; `businessId` added to claims |
| `projects` remains source of truth for built apps | ADR-8 | PASS | zero diff in protected trees |
| Membership is the authorisation record; owner is a row | addendum §8.2 | PASS | `access.ts:53-58` |
| One gate, used by routes and services | addendum §8 | PASS at service level | all mutating services call it (F5 aside) |
| 404 for non-member, 403 for insufficient permission | addendum §8.4 | PASS | `access.test.ts` contract test |
| Application-scope enforcement | D2 | PASS for single-app operations; **FAIL** for listing (F5) | `applications.ts:127-162` |
| Ownership cannot be granted by member management | addendum §7.2 | PASS | `addMember`/`reactivateMember` refuse `owner`; `removeMember` refuses owners |
| Reactivation is explicit and does not restore privileges | addendum §8.3 | PASS | `reactivateMember` requires role + scope; test proves old scope is not restored |
| Removal takes effect immediately | addendum §7 | PASS | gate re-reads per call; test in `access.test.ts` |
| Canonical path identity | D1, addendum §6.1 | PASS | `paths.test.ts`, 9 cases |
| Path scoping is not a security boundary | addendum §6.3 | PASS | `trustDomain` stored; documented |
| Verification is per-hostname, not transitive | addendum §8 | N/A in A′.1 (no claim logic yet) | — |
| Partial unique indexes match MongoDB semantics | rev. 2 §5.2 | PASS | `$type`/`$exists` used; `$ne` correctly avoided |
| Transactional creation of business + owner | plan §7.1 | **FAIL** | F1 |
| Archived/suspended fail closed | rev. 2 §9.4 | PASS for members; system skips state checks (F3) | `access.ts:63-80` |
| Historical records survive archival | addendum §7 | PASS | `archiveBusiness` touches one row; test asserts members survive |
| No owner shortcut | addendum §6 | PASS | `no-owner-shortcut.test.ts` |
| Import-boundary separation | rev. 2 §5.3 | PASS (relative-import gap noted) | `independence.test.ts` |
| No project-workspace assumptions inherited | addendum §1 | PASS | `lib/business` imports only errors, collections, mongodb, ids, `domain/host`, types |

---

## 8. Decision

### BLOCK A′.1

Two defects must be corrected before approval. Both are in code this phase introduced, both are
invisible to the current suite, and both would be exercised immediately by A′.2.

**Required before re-review**

1. **F1** — thread `session` through every read on the creation path (`members.ts:69`, `:72`, `:252`)
   and add a fake collection that fails when a transactional call omits the session.
2. **F2** — reject credentialed URLs and non-HTTP schemes, and store a canonical origin rather than
   the raw input (`applications.ts:78`).

**Recommended in the same correction commit**

3. **F3** — reduce the system actor's gate permissions to none, or document why it may rename and
   archive customer businesses.
4. **F5** — filter `listApplications` by a member's application scope.

**Recorded, not blocking**

F4 (owner-creation concurrency), F6 (index comment), F7 (system cannot read), and the structural-test
hardening in §5.1 and §5.3.

### What this means for the phase sequence

A′.2 remains **unauthorised**. The compatibility adapter, migration, verification and rollback all
depend on `createBusiness` and `createApplication` working against a real replica set; building them
on a broken creation path would move the defect into data rather than catch it.

The correction is narrow — roughly three functions and one new test harness — and should be delivered
as its own commit, reviewed against this document, with the four blockers/recommendations addressed
or explicitly deferred in writing.

### Limits of this review

- No MongoDB instance was contacted, so F1 is established from the driver's transaction contract,
  the code as written, and the repository's own correct pattern in `lib/runtime/keys/rotate.ts` —
  not from an observed failure. A single integration test against a replica set would confirm it in
  minutes and should be part of the correction.
- F2 was confirmed by running Node's URL parser on the exact inputs, not by invoking
  `createApplication`.
- No production data, no migration, no flag activation.
