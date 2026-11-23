# Connected Business — A′.4 Real Replica-Set Verification

**Date:** 2026-11-23
**Commit under verification:** `30008ef` (plus this A′.4 commit)
**Decision:** **C2 SATISFIED** — with the limitation recorded in §8.

---

## 1. Environment

| Item | Value |
|---|---|
| Server | MongoDB **8.0.4** (`mongodb-linux-x86_64-debian12` build) |
| Topology | single-node replica set `rs0`, `isWritablePrimary: true` |
| Wire version | 25 |
| Port | 27018 (integration), 27019 (script smoke test) |
| Driver | `mongodb@7.6.0` (the application's own driver) |

A real `mongod` process, not `mongodb-memory-server` and not the in-memory fake.
Docker was unavailable in this sandbox (no daemon), so the binary was downloaded
from `fastdl.mongodb.org` and started directly; `scripts/test-replica-set.sh`
reproduces exactly that.

---

## 2. Which tests ran against a real database

| Suite | Backing store | Real MongoDB? |
|---|---|---|
| `test/integration/connected-business.mongo.test.ts` (A–F) | real `mongod` 8.0.4, `rs0` | **Yes** |
| `lib/business/**` unit suites (126 tests) | `fakeCollection` harness | No — fakes |
| `lib/connected-business/migrate.test.ts`, `rollback.test.ts` | `fakeCollection` harness | No — fakes |
| `app/api/businesses/route.test.ts` | `vi.mock` | No — mocks |
| Rest of the repository suite | mocks/fakes | No |

The integration suite is **skipped, not passed**, when `MONGODB_REPLICA_URI` is
absent. Verified: `Test Files 1 skipped (1) / Tests 5 skipped (5)`.

---

## 3. What the real-database tests establish

Run: `MONGODB_REPLICA_URI='mongodb://127.0.0.1:27018/atai_integration?replicaSet=rs0' npx vitest run test/integration`

```
✓ A — creates the business and its owner in one transaction        15ms
✓ B — rolls back the business when the owner insert fails          23ms
✓ C — refuses a second owner and leaves the first untouched         8ms
✓ D — lets exactly one of several concurrent owner insertions win  12ms
✓ E — enforces the production index definitions                    16ms
✓ F — migrates a project and rolls it back by run id               25ms
Test Files 1 passed (1)   Tests 6 passed (6)
```

**A.** `createBusiness` against the real database leaves exactly one business
and exactly one owner membership, correctly related (`members[0].businessId ===
business.id`, `business.ownerId === members[0].userId`). This is the C2 test the
post-correction review asked for.

**B.** The `business_members` collection is given a real `$jsonSchema` validator
via `collMod`, so the owner insert is rejected *by the database*, after the
business insert. Both rows are absent afterwards — the transaction rolled back.
No stub was involved in the failure.

**C.** A second `addOwner` is refused with `VALIDATION` and the original owner is
unchanged.

**D.** Five concurrent `addOwner` calls for different users: exactly one
fulfils, the rest reject with `VALIDATION`, and the database holds exactly one
active owner. (Before the index fix below, **all five succeeded** — see §4.)

**E.** The indexes built by `ensureIndexes()` are inspected and exercised:

```
businesses
  businesses_legacy_project_unique   {legacyProjectId:1}  UNIQUE partial={"legacyProjectId":{"$type":"string"}}
business_members
  business_members_unique            {businessId:1,userId:1} UNIQUE
  business_members_one_owner         {businessId:1}          UNIQUE partial={"role":"owner","status":"active"}
connected_applications
  connected_applications_origin_unique {businessId:1,hostname:1,basePath:1} UNIQUE partial={"archivedAt":null}
  connected_applications_legacy_unique {legacyProjectId:1} UNIQUE partial={"legacyProjectId":{"$type":"string"}}
business_domains
  business_domains_hostname_active_unique  {hostname:1} UNIQUE partial={"releasedAt":null}
  business_domains_canonical_active_unique {canonicalHostname:1} UNIQUE partial={"releasedAt":null,"aliasOf":null,"canonicalHostname":{"$type":"string"}}
```

Unrelated businesses coexist; a `status: "removed"` owner falls outside the
predicate and does not block; a second active owner is rejected with `11000`; a
duplicate active origin is rejected while an `archivedAt` row is allowed; the
legacy-project index rejects a duplicate string and accepts two rows without one.

**F.** The migration writes a business, owner, application and domain link, all
stamped `runId: "run-int-1"`; a second run skips; rollback by run id removes the
three rows and detaches the claim. This is the evidence behind the C3 decision
(`connected-business-a-prime-4-c3-migration-decision.md`).

---

## 4. Defect found: three partial indexes could never build

The first real run failed, and it failed for a reason the fake could not show.

```
MongoServerError: Error in specification { unique: true,
  partialFilterExpression: { releasedAt: { $exists: false } },
  name: "business_domains_hostname_active_unique" … }
:: caused by :: Expression not supported in partial index: $not releasedAt exists
```

`$exists: false` is **not a legal partial-index predicate** in any MongoDB
version — it compiles to `$not: {field: {$exists: true}}`. Three definitions in
`lib/db/collections.ts` used it:

1. `business_domains_hostname_active_unique`
2. `business_domains_canonical_active_unique`
3. `connected_applications_origin_unique`

Two consequences, both real:

- **Those three indexes had never existed in production.**
- Because `runEnsureIndexes` batches and the first failure is not isolated, the
  rejected index **aborted the rest of the bootstrap**. The first run showed
  `businesses` and `business_members` with only `_id_` — every index after that
  point was missing, including all connected-business indexes.

The second consequence was visible in test D: **five concurrent owner insertions
all succeeded**, because `business_members_one_owner` did not exist.

**Correction applied:** `$exists: false` → equality on `null` (supported, and
matches both a missing field and an explicit null, which is the intended "not
released / not archived" meaning). The app never writes an explicit null
(`ignoreUndefined: true`), so stored semantics are unchanged.

**Verification:** after the fix, all six tests pass and every index in the
listing above exists. Test D now returns exactly one winner.

This is recorded in `AGENTS.md` as a standing rule.

---

## 5. CI and local running

- **CI** (`.github/workflows/ci.yml`): the existing `mongo:7` service is a
  standalone and cannot run transactions, so a second container is started with
  `--replicaSet rs0` on port 27018, initiated, waited on, then the integration
  suite runs with `MONGODB_REPLICA_URI`. The unit suite is unchanged.
- **Local:** `scripts/test-replica-set.sh start` (uses `$MONGOD_BIN`, then
  `mongod` on PATH, then a pinned download into `.cache/`), then
  `MONGODB_REPLICA_URI=… pnpm test:integration`.
- **`package.json`**: `"test:integration": "vitest run test/integration"`.

The CI YAML was written and reviewed but **not executed in this sandbox** (no
Docker daemon). The same steps were executed locally by hand, which is what
produced the evidence above.

---

## 6. Verification gate

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (unit) | 322 files passed, 3,902 passed, **6 skipped** (the integration file), 2 todo |
| Integration suite | 1 file, **6 passed** against real MongoDB 8.0.4 |
| `npm run lint` | 0 errors, 376 pre-existing warnings |
| `npm run build` | compiled successfully |
| Protected trees | `git diff 148f546..HEAD -- app/project lib/projects lib/marketing lib/cofounder lib/runtime` is empty |

---

## 7. C3

Answered in `docs/audits/connected-business-a-prime-4-c3-migration-decision.md`:
the migration writes documents directly, deliberately, because `createBusiness`
requires a signed-in person as owner; atomicity, the one-owner rule and the
stamps are preserved and verified by test F.

---

## 8. Limitations — read before relying on this

1. **Single node.** A one-member replica set proves transaction and index
   semantics, not failover, stepdown or multi-node write concern retry. A
   three-node set is the next step if those matter.
2. **No production data.** Everything ran on an empty test database.
3. **CI YAML not executed here.** The steps are the ones I ran by hand; they are
   not proven on a GitHub runner.
4. **MongoDB 8.0.4 only.** The `$exists: false` defect is version-independent,
   but other version differences are untested.
5. **The migration's `apply` path was run only against the test database**, never
   against production, and the feature flag remains off.

## 9. C2 verdict

**Satisfied.** Creation is transactional on a real replica set (A), rollback is
real (B), owner uniqueness is enforced by the service and by the database (C, D),
and the production index definitions build and behave as documented (E). The
single-node limitation in §8.1 is the only caveat remaining, and it does not undermine any of the five claims above.
