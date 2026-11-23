# Connected Business — Decisions Addendum (ADR-8, R1–R7, three clarifications)

**Status:** binding. Read together with
`connected-business-architecture-reconciliation-2026-11-21.md` (rev. 2).
**Date:** 2026-11-21
**Scope:** decisions and contract amendments only. No implementation. A′ is planned in
`connected-business-phase-a-prime-plan-2026-11-21.md`.

---

## 0. How to read this document

Rev. 2 remains the architecture. This addendum (a) records the approvals as decisions,
(b) corrects two clauses in rev. 2 that the decisions changed, and (c) turns the three
implementation safeguards into contracts.

Where this addendum and rev. 2 disagree, **this addendum wins** for the sections listed below.
Nothing else in rev. 2 is reopened.

| Rev. 2 clause | Status after this addendum |
|---|---|
| §5.2 `business_integrations` unique `(businessId, provider)` | **superseded** — §5 here |
| §7 key lifecycle | **extended** — §4 here (claim-inactive setup credentials) |
| §8, §9.4 guide availability | **tightened** — §3 (R6) here |
| §10 event retention | **extended** — §4 here (retention classes) |
| §16.4 compat retirement criterion | **tightened** — §3 (R4) here |
| §21 decisions | **closed** — §2 here |
| §5.2 application uniqueness `(businessId, hostname)` | **superseded** — §6 here |
| §16 deletion behaviour | **extended** — §7 here |
| §6 gate signature, and membership without an application scope | **extended** — §8 here |

---

## 1. ADR-8 — approved

The prior decision that a business is a `projects` document is superseded.

| Entity | Responsibility |
|---|---|
| `projects` | applications Atai builds and manages through its existing creation and development lifecycle |
| `businesses` | independent business identities |
| `connected_applications` | applications belonging to those businesses |
| `business_domains` | independently verified hostname claims |
| `business_members` | business ownership and membership |
| `business_events` | durable business activity history |
| `business_integrations` | external service connections |

Two binding conditions recorded with the approval:

1. **The existing project workspace must remain operational and must not become dependent on
   the business workspace.** No file under `app/project/**`, `lib/projects/**`,
   `lib/marketing/**`, `lib/cofounder/**` or `lib/runtime/**` may import `lib/business/**` in
   A′. Enforced by the independence test (§9.3 of rev. 2, extended here to cover the reverse
   direction: `lib/business/**` may not import those trees).
2. **No synthesised business identity.** A persisted `businesses` row is the ownership boundary.
   A projection without a row is read-only and cannot own anything (rev. 2 §16.2, unchanged).

---

## 2. R1–R7 — decided

| ID | Decision | Condition carried into the contracts |
|---|---|---|
| **R1** | Approved | Reserve `projects.businessId` as a field only. Attaching a built project to a business must never convert it into a connected application, never transfer its deployment lifecycle, and never make the build pipeline depend on `lib/business/**`. The relationship needs its own explicit contract before it is implemented. |
| **R2** | Approved | Suggest the name from the website title; editing is one field, always available. The title is a suggestion, never authoritative: it can be stale, generic or machine-generated. |
| **R3** | Approved | 400 days is the default, not a universal value. Every event type declares a retention class and a duration. Payloads are redacted on write and are never a place for credentials, personal data or request bodies. |
| **R4** | Approved | Retirement is telemetry-driven, not calendar-driven. See §3 for the measurable definition. |
| **R5** | Approved | Top-level "Businesses" navigation, separate from Projects. Projects = what Atai builds; Businesses = what the founder operates. This is positioning, not just navigation. |
| **R6** | Approved | The guide may be issued after a **reserved** claim. A reservation is not proof of ownership. Capabilities that require verified ownership stay unavailable until the exact hostname is verified. Expiry, release and re-reservation must invalidate or restrict the associated setup credentials. |
| **R7** | Approved with refinement | Business-wide by default; application binding optional; provider scopes further restrict. The uniqueness model must allow several application-bound connections to the same provider under one business. See §5. |

---

## 3. Conditions written into the contracts

### 3.1 R6 — reservation is not ownership

The distinction is strict and enforced at three points:

| Point | Reservation only | Verified hostname required |
|---|---|---|
| Integration guide | issued, with a connection key | — |
| Runtime invocation | permitted within the key's scopes | — |
| Capabilities that assert ownership (verified badge, claim-dependent publishing, domain-scoped actions) | **refused** | required |

**Setup credentials are tied to the claim.** An application key issued for a connection guide
records `setupForClaimId`. When that claim transitions to `expired`, `released` or `revoked`,
the key is **suspended** (`status: "suspended"`, `suspendedReason: "claim_inactive"`) — not
revoked, because re-verification must be able to restore it. Re-reservation issues a fresh guide
and a fresh key; the suspended key stays suspended. This amends rev. 2 §7 and is implemented
with the connection flow in B′, not A′.

### 3.2 R4 — measurable retirement of the compatibility fallback

The fallback is retired only when **all four** hold, measured from telemetry:

1. every eligible legacy business is migrated (100%, verified by §16.5 of rev. 2);
2. the verification script reports zero inconsistencies on its last three runs;
3. `compat.legacy_read` is never emitted for seven consecutive days;
4. no production error in the window is attributable to the compatibility path.

Time alone never qualifies. If any condition regresses, the clock restarts.

### 3.3 R2 — name suggestion

`businesses.name` is founder-editable and is never derived at read time. The suggestion is
computed once at creation (`suggestedName`, `suggestedNameSource: "website_title" | "hostname" |
"founder"`), stored, and then owned by the founder. A later crawl never overwrites it.

---

## 4. Event retention classes (amends rev. 2 §10)

| Class | Default | Examples | Rationale |
|---|---|---|---|
| `operational` | 400 days | `application.connected`, `domain.verified`, `campaign.launched`, `task.*`, `ai.task_completed` | the business's working history |
| `security` | 730 days | `member.added`, `member.removed`, `role.changed`, `key.revoked`, `integration.disconnected`, `business.suspended` | access and credential history outlives operational history |
| `billing` | 7 years | `approval.granted` where money moved, charge failures | matches the ledger's own retention |

Every event type declares its class in code; a type without a class fails the schema test. A
per-type override may lengthen but never shorten a `security` or `billing` class.

Payload rules unchanged and now explicit: no credentials, no tokens, no full URLs with query
strings, no email addresses of customers, no request bodies. Redaction runs on write.

---

## 5. R7 correction — integration uniqueness and scope

Rev. 2 proposed a unique `(businessId, provider)` index. That forbids a legitimate case: one
company connects a provider once for the company, and separately for one application with
different provider scopes.

### 5.1 Model

`business_integrations`:

- `businessId` (required), `provider` (required), `applicationId?` (absent = business-wide),
  `status: "connected" | "degraded" | "revoked"`,
- `providerScopes: string[]` — the scopes actually granted by the provider, recorded so the UI
  can state what Atai can and cannot reach,
- `credentialRef: string` — a reference into the encrypted store, **never a secret**,
- `connectedBy`, `connectedAt`, `lastCheckedAt`, `revokedAt?`, `revokedReason?`.

### 5.2 Indexes

Two partial unique indexes, because one composite index cannot express "absent means
business-wide":

```
business_integrations_wide_unique
  { businessId: 1, provider: 1 }
  unique
  partialFilterExpression: { applicationId: { $exists: false }, revokedAt: { $exists: false } }

business_integrations_app_unique
  { businessId: 1, applicationId: 1, provider: 1 }
  unique
  partialFilterExpression: { applicationId: { $type: "string" }, revokedAt: { $exists: false } }
```

`$exists` and `$type` are used deliberately: `$ne` is not permitted in a partial filter
expression. The same pattern is already used by
`business_domains_canonical_active_unique` (`lib/db/collections.ts:839-857`).

Revoked rows are excluded so a re-connection never collides with history, and the history
survives.

### 5.3 Effective access is a three-way intersection

```
effective = member_permission ∩ member_application_scope ∩ integration.providerScopes
```

A business-wide integration does not grant application-bound access, and an application-bound
integration does not grant business-wide reach. Provider scopes are the outer bound: Atai can
never use a provider beyond what the provider granted, whatever the member's role.

---

## 6. Clarification 1 — several applications on one hostname

**Recommendation: support path-scoped applications.** Confirmation requested before A′ starts.

### 6.1 Model

An application is identified by `(businessId, hostname, basePath)`:

- `basePath` normalised: `""` for the origin root, otherwise a leading slash, no trailing slash
  (`/shop`, `/dashboard`).
- Uniqueness: unique `(businessId, hostname, basePath)` among non-archived rows.
- `example.com`, `example.com/shop` and `example.com/dashboard` are three applications of one
  business. Overlapping base paths are allowed; they are separate records.
- Analytics attribution is by **key**, never by path inference: an event belongs to the
  application whose key emitted it.

### 6.2 Hostname verification is not weakened

Verification remains per hostname (`business_domains`). All applications on one host bind to
the **same** claim: it is proven once, and each application inherits `hostVerified` from that
claim. Paths are not a proof surface and never will be — a claim proves the host, not a
directory.

### 6.3 The caveat that must be stated in the product

Two applications on one origin **share a trust domain**. A key for `/shop` is only as safe as
the server that also holds the key for `/dashboard`; a compromise of that server compromises
both. Path scoping is an **organisational** boundary (analytics, campaigns, tasks, reporting),
not a **security** boundary.

Therefore:

- `connected_applications` records `trustDomain: hostname` so the UI and the co-founder can say
  "these applications share a server";
- the connection guide states it once, plainly;
- nothing in the design claims isolation between same-origin applications.

If you prefer the simpler rule, the alternative is to reject path scoping and document that one
hostname hosts exactly one application. That is a one-line change to the index and removes
§6.3 entirely. **Default if you do not answer: support path scoping.**

---

## 7. Clarification 2 — deletion semantics

Deleting an application deletes nothing but the application. Everything else is archived,
revoked or retained.

### 7.1 Rule

No A′ operation hard-deletes a business, an application, a claim, an event, a usage row or a
ledger entry. Archival and revocation are the only user-facing removals. A purge job is out of
scope for this initiative.

### 7.2 Matrix

| Object | User-facing removal | What happens | What survives |
|---|---|---|---|
| Connected application | archive | `status: "archived"`, `archivedAt`; **keys revoked in the same transaction**; connection `revoked`; host binding released | the row, its history, its usage, its charges |
| Business | archive | `status: "archived"`; members disabled; claims **retained** (not released); keys of all applications revoked | the row, claims, events, usage, ledger |
| Domain claim | release | `status: "released"`, `releasedAt`, history entry | the row and its verification history |
| Business event | never user-deleted | expires via `expiresAt` per §4 | — |
| Integration | revoke | `status: "revoked"`, `revokedAt`; credentials destroyed at the provider where possible | the row (who connected what, when) |
| Runtime usage | never deleted | — | retained as cost evidence |
| Credit ledger | never deleted | — | retained permanently (existing invariant: billing evidence survives project deletion) |
| Membership | remove | `status: "removed"`; the last `owner` cannot be removed while the business exists | the row |

### 7.3 Consequences

1. Archiving the last application is allowed. The business stays `active` if it holds a verified
   claim, and the workspace shows an empty state. Rev. 2 §16.5's "no business has zero
   applications" is a **migration-time** invariant only, not a runtime one.
2. Archiving a business does **not** free its hostnames. Freeing requires the release flow with
   the existing confirmation dialog, so archiving cannot become a squatting loophole.
3. Deleting a **built project** keeps its current behaviour (claims released, billing retained).
   That is a different object with a different lifecycle and is not changed by this addendum.

---

## 8. Clarification 3 — integration authorization

A valid business membership must never be enough on its own to reach an application-bound
credential.

### 8.1 Gate extension

`requireBusinessAccess` gains an optional `applicationId`:

```ts
requireBusinessAccess({
  businessId, actor, permission, applicationId?,
}): Promise<BusinessAccess>
```

When `applicationId` is supplied, the member's scope is also checked.

### 8.2 Member scope

`business_members.scope`:

```ts
type MemberScope = { kind: "all" } | { kind: "applications"; applicationIds: string[] }
```

Default `{ kind: "all" }`; the migrated owner gets `all`. A member restricted to
`["app_shop"]` cannot act on `app_dashboard`, even with the same role.

### 8.3 Rules for integration operations

Every integration operation must satisfy all three:

1. `requireBusinessAccess(businessId, actor, "integrations.manage")` — member permission;
2. if the integration is application-bound, `requireBusinessAccess(..., applicationId)` — member
   scope;
3. the requested provider action is within `providerScopes`.

Reading a credential is `integrations.manage`, never `read`. Credentials are never returned to
a client; adapters use them server-side only.

### 8.4 Error semantics

| Situation | Response |
|---|---|
| Actor is not a member of the business | `404 NOT_FOUND` — never disclose that the business exists |
| Member, but lacks the permission | `403 BUSINESS_FORBIDDEN` |
| Member, but outside the member's application scope | `403 BUSINESS_FORBIDDEN` |
| Integration is bound to another application | `403 BUSINESS_FORBIDDEN` |
| Provider scope insufficient | `403 INTEGRATION_SCOPE_INSUFFICIENT` |

---

## 9. A′ scope boundary (restated for the plan)

A′ contains exactly: business identity and persistence; connected application ownership;
`business_members` and the gate; role-to-permission enforcement; the legacy compatibility
adapter; migration and verification scripts; dry-run and cutover controls.

A′ contains none of: workspace UI, navigation changes, AI departments, marketing or SEO
adapters, billing changes, service refactoring, integration implementation, key minting changes.

A′ is complete only when existing connected-business records are representable in the new model,
ownership and authorization are enforced at a real call site, migration verification passes, and
the built-project workflows are unaffected. Collections existing is not completion.
