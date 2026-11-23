# Connected Business — Phase A′ Implementation Plan

**Status:** plan only. **No code authorised.** A′ begins after this plan is reviewed.
**Date:** 2026-11-21
**Reads with:** rev. 2 (`connected-business-architecture-reconciliation-2026-11-21.md`) and
`connected-business-decisions-addendum-2026-11-21.md` (binding; wins on conflict).

---

## 1. Objective

Introduce the persisted business model, its applications, its membership and its authorization
gate, plus the migration that carries existing connected-business records into it — **without
changing any user-visible behaviour**.

A′ is an infrastructure phase. It exists so that every later phase (workspace, events, adapters,
AI, billing) can be built on an identity and an authorization check that already work.

---

## 2. Completion definition

A′ is **not** complete because collections exist or a script ran. It is complete when all six
hold:

| # | Criterion | Evidence |
|---|---|---|
| 1 | Every existing connected-business record is representable in the new model | compat projection equality for 100% of migrated rows, or a documented, reviewed exception list |
| 2 | Ownership and authorization are enforced at a real call site | the A′ read route returns 404 for non-members, 403 for insufficient permission, 200 for members — covered by tests |
| 3 | Role-to-permission enforcement is total | matrix totality test; gate tests per role |
| 4 | Migration verification passes | `verify-connected-businesses` exits 0 on all six checks |
| 5 | Built-project workflows are unaffected | full `tsc` + `vitest` + lint + build green; **zero diff** under `app/project/**`, `lib/projects/**`, `lib/marketing/**`, `lib/cofounder/**`, `lib/runtime/**` |
| 6 | Rollback is demonstrable | dry-run of the rollback procedure against a scratch database before the flag flip |

---

## 3. Non-goals (explicit)

Not in A′: workspace UI or routes under `app/business/**`; navigation changes; `BusinessContext`;
AI departments; SEO/marketing/research adapters; billing attribution changes; runtime key
minting changes; `business_events`; `business_integrations`; key revocation/suspension work;
any change to the connect wizard or the stepper.

If a task appears to require one of these, it belongs to B′ or later.

---

## 4. Decisions needed before the first commit

| ID | Question | Default if unanswered |
|---|---|---|
| **D1** | Path-scoped applications on one hostname (`example.com/shop`)? | **support** (addendum §6); the alternative is root-only and changes one index |
| **D2** | Per-member application scope (`scope: all | applications[]`)? | **support** (addendum §8); required for clarification 3 to be meaningful |
| **D3** | Confirm no hard delete in A′ (archive/revoke only)? | **yes** (addendum §7) |
| **D4** | Flag mechanism: env var + user allowlist, or a feature-preferences flag? | env `CONNECTED_WORKSPACE_V2=off|internal|all` + `CONNECTED_WORKSPACE_COHORT` |

---

## 5. Data model delta

Three new collections, one field added to an existing one. No existing field is removed.

### 5.1 `businesses`

```ts
interface BusinessDoc {
  _id: ObjectId
  id: string                    // "biz_<24hex>"
  ownerId: string               // userId; lookup + billing only, never authorization
  name: string                  // founder-owned after creation
  suggestedName?: string
  suggestedNameSource?: "website_title" | "hostname" | "founder"
  status: "draft" | "active" | "suspended" | "archived"
  legacyProjectId?: string      // set only by the migration
  schemaVersion: number
  createdAt: number
  updatedAt: number
  archivedAt?: number
}
```

Indexes:

```
businesses_legacy_project_unique   { legacyProjectId: 1 } unique
                                   partial { legacyProjectId: { $type: "string" } }
businesses_owner_recent            { ownerId: 1, createdAt: -1 }
```

### 5.2 `connected_applications`

```ts
interface ConnectedApplicationDoc {
  _id: ObjectId
  id: string                    // "app_<24hex>"
  businessId: string
  name: string
  kind: "marketing_site" | "saas_app" | "customer_portal" | "storefront" | "mobile_backend" | "other"
  primaryUrl: string
  hostname: string              // lowercased, no port
  basePath: string              // "" for root, "/shop" otherwise (D1)
  trustDomain: string           // = hostname; same-origin apps share it
  hostVerified: boolean
  connection: { firstSeenAt?: number; lastSeenAt?: number; seenCalls?: number; revokedAt?: number }
  legacyProjectId?: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}
```

Indexes:

```
connected_applications_origin_unique  { businessId: 1, hostname: 1, basePath: 1 } unique
                                      partial { archivedAt: { $exists: false } }
connected_applications_business       { businessId: 1, createdAt: 1 }
connected_applications_legacy_unique  { legacyProjectId: 1 } unique
                                      partial { legacyProjectId: { $type: "string" } }
```

### 5.3 `business_members`

```ts
interface BusinessMemberDoc {
  _id: ObjectId
  businessId: string
  userId: string
  role: "owner" | "admin" | "marketer" | "developer" | "finance" | "viewer"
  status: "active" | "invited" | "removed"
  scope: { kind: "all" } | { kind: "applications"; applicationIds: string[] }
  invitedBy?: string
  createdAt: number
  updatedAt: number
}
```

Indexes:

```
business_members_unique   { businessId: 1, userId: 1 } unique
business_members_user     { userId: 1, status: 1 }
```

### 5.4 `business_domains` (existing)

Adds `businessId?: string` and `applicationId?: string`. The existing
`business_domains_canonical_active_unique` index is **untouched** — it remains the enforcement
point for one business per hostname. Adds:

```
business_domains_business  { businessId: 1, createdAt: -1 }
```

---

## 6. Module design

Dependency order is the list order; no module imports upward.

| # | File | Responsibility | Notes |
|---|---|---|---|
| 1 | `lib/types/business.ts` | doc types, enums, projections | no `server-only`; pure types |
| 2 | `lib/business/permissions.ts` | `Permission` union, `Actor`, `ROLE_PERMISSIONS`, `hasPermission` | matrix is a code constant, like `PLAN_PRICING` |
| 3 | `lib/business/flags.ts` | `isBusinessWorkspaceEnabled(user)` | env + cohort (D4) |
| 4 | `lib/business/access.ts` | `requireBusinessAccess`, `resolveActor` | `server-only`; the only authorisation entry point |
| 5 | `lib/business/members.ts` | add/remove/list, owner creation, scope resolution | |
| 6 | `lib/business/applications.ts` | create/archive/list, host binding | |
| 7 | `lib/business/service.ts` | create/get/archive business, list for user | |
| 8 | `lib/business/compat.ts` | `projectToBusinessProjection`, `readBusinessForLegacyProject`, `compareProjection` | read-only; **never writes** |
| 9 | `lib/business/migrate.ts` | `migrateConnectedBusinesses(deps)` | takes collections as deps so it is testable without a database |
| 10 | `lib/business/verify.ts` | `verifyConnectedBusinesses(deps)` → report | same dependency-injection shape |
| 11 | `app/api/business/[businessId]/route.ts` | `GET` projection, flag-gated, gate-enforced | the single A′ enforcement call site; coexists with the existing static `app/api/business/availability` segment, which keeps precedence |
| 12 | `scripts/migrate-connected-businesses-v1.ts` | CLI wrapper: dry-run default, `--apply` | `npx tsx --env-file=.env.local` |
| 13 | `scripts/verify-connected-businesses.ts` | CLI wrapper, exits non-zero on failure | |

Modified:

| File | Change |
|---|---|
| `lib/db/collections.ts` | `businessesCol()`, `connectedApplicationsCol()`, `businessMembersCol()`; three index blocks in `ensureIndexes()`, each with the existing `.catch()` resilience so a failed build never aborts bootstrap |
| `lib/errors.ts` | add `BUSINESS_NOT_FOUND`, `BUSINESS_FORBIDDEN`, `BUSINESS_NOT_MIGRATED`, `BUSINESS_SUSPENDED` to `ErrorCode`, `ERROR_MESSAGES`, `STATUS_BY_CODE` |
| `AGENTS.md` | final commit only: ADR-8 summary, the two-surface rule, the "no project imports" rule |

Unchanged and asserted unchanged: `app/project/**`, `lib/projects/**`, `lib/marketing/**`,
`lib/cofounder/**`, `lib/runtime/**`, `lib/connected-business/**`.

---

## 7. Key module contracts

### 7.1 `requireBusinessAccess`

```ts
async function requireBusinessAccess(input: {
  businessId: string
  actor: Actor
  permission: Permission
  applicationId?: string
}): Promise<BusinessAccess>   // { business, member, role, permissions }
```

Behaviour, in order:

1. load the business; missing → `BUSINESS_NOT_FOUND` (404);
2. `actor.kind === "system"` → allowed only for a fixed allowlist of internal permissions
   (migration and verification use `system`, and only `business.manage`);
3. load the member; missing or `status !== "active"` → **`NOT_FOUND` (404)** — never disclose
   that the business exists;
4. business `archived` → reads allowed, writes refused;
5. business `suspended` → `owner`/`admin` may read, writes refused;
6. permission not held by the role → `BUSINESS_FORBIDDEN` (403);
7. `applicationId` supplied and member scope is `applications` and the id is absent →
   `BUSINESS_FORBIDDEN` (403).

The gate never compares `businessId` to a user id. That is the no-owner-shortcut rule.

### 7.2 `compat.ts`

- `projectToBusinessProjection(project)` — pure. Produces
  `{ businessId: "biz_legacy_<projectId>", name, status, applications: [one], claims, connection }`
  from `project.startingPoint === "existing_business"`, `project.intake`, `project.connection`.
- `readBusinessForLegacyProject(projectId)` — returns
  `{ mode: "migrated", business }` when a row exists, else
  `{ mode: "legacy_readonly", business: null, projection }`. **Never creates anything.**
- `compareProjection(project, business)` — returns a list of field-level mismatches, used by the
  verification script and by the equality test.

`biz_legacy_*` identifiers exist only inside a projection and are never persisted, never used as
a foreign key, and never accepted as an API parameter.

### 7.3 `migrate.ts`

```ts
migrateConnectedBusinesses({
  dryRun: boolean
  now: number
  limit?: number
  collections: { projects; businesses; applications; members; domains; migrations }
}): Promise<MigrationReport>
```

- Lock: insert `{ _id: "connected-business-v1", state: "running", heartbeatAt }`; refuse to start
  if a non-stale `running` lock exists; mark `done`/`failed` at the end.
- Per project with `startingPoint === "existing_business"` and no `businesses.legacyProjectId`
  match: create business, application, owner member; set `business_domains.businessId` for
  claims whose `projectId` matches.
- Idempotent: a second run skips everything by the unique `legacyProjectId` index.
- Resumable: `limit` bounds a run; the report lists processed and skipped ids.
- Never deletes, never rewrites a claim, never touches `projects`.

### 7.4 `verify.ts`

Six checks, each returning `{ ok, detail }`: one business per connected project; exactly one
owner member per business; every claim has a `businessId` pointing at an existing business; no
business without an application; no duplicate canonical hostname across businesses; report
counts reconcile with the dry-run.

---

## 8. Migration ordering

Each step has a gate; a failure stops the sequence.

| Step | Action | Gate before proceeding |
|---|---|---|
| 0 | Read `node_modules/next/dist/docs/` for route-handler conventions before writing `app/api/business/[businessId]/route.ts` | plan confirmed against the installed version |
| 1 | Land code with `CONNECTED_WORKSPACE_V2=off`; build indexes on first access | indexes present in the database; `tsc`/`vitest`/lint/build green |
| 2 | `verify-connected-businesses --pre` (index + count sanity, no migration) | zero anomalies |
| 3 | `migrate-connected-businesses-v1 --dry-run` | report reviewed; collision list empty or explained |
| 4 | `migrate-connected-businesses-v1 --apply` under the lock | report: created = expected; failures = 0 |
| 5 | `verify-connected-businesses` (full) | all six checks pass |
| 6 | Shadow comparison: every migrated business vs its project projection | mismatches = 0, or an allowlist signed off |
| 7 | Flag `internal` for the cohort → the A′ read route serves | 404/403/200 behaviour verified against real users |
| 8 | Optional: key `principal` backfill (may move to B′) | idempotent; count matches |
| 9 | Completion review against §2 | all six criteria evidenced |

---

## 9. Rollback boundaries

| After step | Rollback | Safe because |
|---|---|---|
| 1–3 | delete the flag; drop the three empty collections and the two added indexes | no rows created |
| 4–6 (**pre-flip**) | `migrate-connected-businesses-v1 --rollback`: delete `connected_applications`, `business_members`, `businesses` created by the run; `$unset business_domains.businessId`; clear the migration lock doc | nothing references them; no user has seen the new surface |
| 7+ (**post-flip**) | flag back to `off`; **data retained** | dependents may exist (usage, ledger, events later); deletion is not a supported operation after the flip |
| any | forward-fix | always available |

The rollback script is written in A′ and **dry-run against a scratch database before step 7**,
so the boundary is demonstrated rather than asserted.

---

## 10. Test plan

The suite runs in `node`; collections are replaced at the module boundary with in-memory fakes,
following the existing pattern in `lib/referrals/referrals.test.ts` (fake collections, not mocked
business logic). Pure functions are tested directly.

| Test file | Asserts | Kind |
|---|---|---|
| `lib/business/permissions.test.ts` | matrix is total; every permission is reachable by at least one role; `owner` holds all | pure |
| `lib/business/access.test.ts` | the seven-step gate order; 404 for non-members; 403 for wrong permission; 403 for out-of-scope application; archived/suspended read vs write | fakes |
| `lib/business/members.test.ts` | unique membership; last owner cannot be removed; scope resolution | fakes |
| `lib/business/applications.test.ts` | origin uniqueness including `basePath` (D1); archive revokes nothing else; trust domain grouping | fakes |
| `lib/business/service.test.ts` | create/archive transitions; name suggestion stored once and never overwritten | fakes |
| `lib/business/compat.test.ts` | projection equality for fixtures: full intake, intake without assessment, no claims, released claim, stale connection, archived project | pure |
| `lib/business/migrate.test.ts` | idempotency (double run), resume with `limit`, lock contention, dry-run writes nothing, claim linking, no `projects` writes | fakes |
| `lib/business/verify.test.ts` | each of the six checks fails on a crafted bad state and passes on a good one | fakes |
| `lib/business/independence.test.ts` | import scan: `lib/business/**` imports none of the forbidden trees, and nothing in those trees imports `lib/business/**` | static |
| `lib/business/no-owner-shortcut.test.ts` | no `businessId === userId` style comparison in the new code | static |
| `app/api/business/[businessId]/route.test.ts` | flag off → 404; no session → 401; non-member → 404; viewer → 200; insufficient permission → 403 | fakes |
| `lib/business/authz-coverage.test.ts` | every route under `app/api/business/**` calls the gate | static |

---

## 11. Risks specific to A′

| Risk | Mitigation |
|---|---|
| Index build fails on existing data (duplicate canonical hostname) | `ensureIndexes` already tolerates a failed build; the preflight check reports collisions before the migration |
| Migration partially applied | lock + resumable + idempotent + verification before flip |
| Projection drift between compat and the real model | equality test with six fixtures, plus the shadow comparison in step 6 |
| The gate becomes a formality | the A′ route is the only caller; the coverage test fails if a second route appears without it |
| Scope creep into B′/C′ | §3 non-goals; the PR diff must stay inside `lib/business/**`, `lib/types/business.ts`, `lib/db/collections.ts`, `lib/errors.ts`, `app/api/business/**`, `scripts/` |
| Silent behaviour change to the connect journey | zero-diff rule on the five protected trees, checked before each PR |

---

## 12. Delivery sequence

| PR | Contents | Behaviour change |
|---|---|---|
| **A′.1** | types, collections + indexes, permissions, flags, access gate, members, applications, service + their tests | none |
| **A′.2** | compat adapter, migrate, verify, both scripts, rollback command + their tests | none (dry-run only) |
| **A′.3** | `GET /api/business/[businessId]` behind the flag, coverage test, `AGENTS.md` update | none while the flag is off |
| **A′.4** (optional) | key `principal` backfill | none |

Each PR must pass `npx tsc --noEmit`, `npx vitest run`, `npm run lint`, `npm run build`.

---

## 13. What A′ does not prove

Stated so it is not mistaken for progress: A′ does not prove the workspace, the events model,
the adapters, the AI departments, billing attribution, or the multi-application UX. It proves
only that a business has a persisted identity, an owner, a membership, an authorization gate, and
a faithful representation of every record that already exists.

Those are the prerequisites. They are not the product.
