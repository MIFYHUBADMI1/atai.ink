# Connected Business — Architecture Reconciliation (Phase 0B, rev. 2)

**Status:** revision 2 — contracts settled. **Implementation not authorised.**
**Date:** 2026-11-21 · **Revision:** 2 (supersedes rev. 1 of the same file)

> **Superseded in part.** The binding decisions and contract amendments live in
> `connected-business-decisions-addendum-2026-11-21.md`, which wins on conflict. It changes:
> `business_integrations` uniqueness (§5.2), application uniqueness on a hostname (§5.2),
> key lifecycle for claim-inactive setup credentials (§7), guide availability (§8, §9.4),
> event retention classes (§10), the compat retirement criterion (§16.4), deletion semantics
> (§16), and the gate signature (§6). The A′ plan is
> `connected-business-phase-a-prime-plan-2026-11-21.md`.
**Supersedes:** `existing-business-initialization-audit-2026-11-18.md` §1.1 and §4 (see §2).
**Method:** read-only. No code changed, no schema applied, no migration run.

---

## 0. What changed in revision 2

Revision 1 established the direction. Revision 2 resolves the seven inconsistencies that
blocked implementation. Each is now a contract with an invariant and an enforcement test,
not a paragraph of intent.

| Rev. 1 problem | Where it is resolved now |
|---|---|
| **A.** Permissions scheduled in G′, after the surfaces that need them | §6 — membership and authorization move into A′; owner-only shortcuts banned |
| **B.** Runtime keys are project-scoped while applications are not | §7 — one principal model, explicit resolution, revocation vs suspension, limits |
| **C.** Rollback assumed deleting rows nothing referenced | §16 — migration-then-flip, single writer, no writes against synthetic identity |
| **D.** "Verified domain" had no defined scope | §8 — a claim proves one hostname; no transitivity, ever |
| **E.** Business became `active` only on connection | §9 — three independent state machines + a surface availability matrix |
| **F.** "Every charge carries `businessId`" contradicted "subscriptions are account-level" | §11 — three attribution tiers, mutually exclusive |
| **G.** TTL on `occurredAt` | §10 — `occurredAt` and `expiresAt` separated; events are not state |

Two further corrections to rev. 1:

- The phase plan now follows the approved sequence (§17), with authorization and
  application-scoped runtime auth before any user-facing capability.
- The AI operating model gains an end-to-end conformance scenario (§15) and names a hard
  dependency that does not exist today: the analytics summary has no page or channel dimension.

Unchanged from rev. 1 and still correct: the inventory, the capability matrix, the security
review, the conflation evidence, and ADR-8.

---

## 1. Scope, and what was actually evaluated

The first audit was an **independent** audit of the repository, not a conformance audit
against a numbered specification. That is worth stating so the document is judged for what
it is.

| Requirement | In my context? | Evaluated? |
|---|---|---|
| Repository reality (code, tests, docs) | yes | yes |
| Audit-only, no code changes | yes | yes |
| Verification gate (`tsc`, `vitest`, lint, build) | yes | defined, not run — nothing executable changed |
| The ten reconciliation areas | no (arrived later) | yes, rev. 1 §6–15 |
| The seven corrections in this revision | no (arrived later) | yes, §6–11, §16 |
| Section numbering / acceptance criteria for the deliverable | no | no — this structure is mine |
| Five architectural decisions (events, handshake, multi-business, multi-app, members) | no (arrived later) | yes, incorporated |

---

## 2. The decision this supersedes (ADR-8)

`docs/audits/existing-business-initialization-audit-2026-11-18.md` states, as PROVEN:

> **A "business" in Atai is a `projects` collection document.** There is no separate
> `businesses` collection, no `workspaces` collection, no membership document.

and, under genuine gaps:

> Explicitly **not** gaps — do not build these: another business entity, another creation
> form system, another AI agent, another GitHub auth, another job queue, another settings
> screen, another onboarding overlay.

That decision was correct for its scope: one connect journey, on existing rails, no new
collection, at a moment when no connected business existed. It bought speed at the cost of a
model that cannot express multiple businesses, multiple applications, members, event history
or per-business attribution.

**ADR-8 supersedes it.** Recorded as a decision so the next reader does not re-derive it.

---

## 3. Why rev. 1 recommended the project as source of truth — and why that was withdrawn

Three reasons, honestly:

1. **It was inherited.** The repository already asserted that a business *is* a project, in an
   audit marked PROVEN. Rev. 1 treated that as settled rather than as a scope decision awaiting
   revision.
2. **The cost argument was real.** A second identity means a join, a backfill, a dual-read
   window and two code paths that must not drift.
3. **Three facts in the same repository argued the other way**, which rev. 1 found and did not
   follow through:
   - `BusinessDomainDoc` carries `projectId` (`lib/types/business-intake.ts:280-310`) — the proof
     that a business owns a hostname is owned by an application row.
   - `BusinessConnection` lives at `project.connection` (`lib/types/business-intake.ts:130-148`) —
     a business cannot have two applications with independent connection state.
   - The one-business-one-account index sits on `business_domains.canonicalHostname`
     (`lib/db/collections.ts:839-857`) — a business-level invariant on an application-scoped record.

The repository already has a business registry. It is called `business_domains`, it is keyed by
project, and it has no row of its own. The correct move is to give that registry a first-class id
and let applications point at it.

**Withdrawn.** `projects` remains the source of truth for built applications and stops being the
source of truth for connected businesses.

---

## 4. The conflation, precisely

| Field | Where | Becomes |
|---|---|---|
| `project.intake` (reading, assessment, claim state) | `lib/types/project.ts:218` | `businesses.profile` + `business_domains.businessId` |
| `project.connection` (guide, key, firstSeenAt, verifiedAt) | `lib/types/project.ts:221` | `connected_applications.connection` |
| `business_domains.projectId` (the claim) | `lib/types/business-intake.ts:283` | `business_domains.businessId` (+ `applicationId`) |

Nothing else needs to move. Verification, crawling, assessment content, runtime auth, metering,
analytics and the ledger are business-neutral in substance; they are merely *called* with a
project id.

---

## 5. Target architecture

```
                    SHARED SUBSTRATE
   users · sessions · credit_ledger · entitlements · runtime_api_keys
   runtime_usage · analytics_events · provider adapters · cron · email
 ─────────────────────────────────────────────────────────────────────────

   ATAI-BUILT (unchanged)                CONNECTED (new)
   ┌──────────────────────┐              ┌──────────────────────────────────┐
   │ projects             │              │ businesses                       │
   │  build lifecycle     │              │  ├── business_members            │
   │  deployment          │              │  ├── connected_applications      │
   │  specification       │              │  │     ├── connection            │
   │  existing workspace  │              │  │     └── runtime keys          │
   └──────────────────────┘              │  ├── business_domains (claims)   │
                                         │  ├── business_events             │
                                         │  └── business_integrations       │
                                         │                                  │
                                         │  /business/[businessId]          │
                                         └──────────────────────────────────┘
                                                        │
                                            CONTROLLED SERVICE PORTS
                                       seo · analytics · marketing · ai ·
                                       research · billing  (adapters wrap
                                       existing engines, never the project
                                       workspace)
```

### 5.1 Invariants

1. A **business** owns claims, applications, events, members, integrations.
2. An **application** owns runtime keys and a connection state.
3. A **domain claim** belongs to a business and proves exactly one hostname.
4. `projects` is the source of truth for **built** applications and nothing else.
5. No code outside the built-app adapters reads `project.deployment`.
6. Every business-attributable charge carries `businessId` (§11).
7. Every business event is written through one function with a closed type set (§10).
8. Every business-scoped route and every port call authorises an acting member (§6).

### 5.2 Entity model

| Entity | Key fields | Invariant |
|---|---|---|
| `businesses` | `_id: biz_*`, `ownerId`, `name`, `status`, `legacyProjectId?`, `schemaVersion` | unique sparse `legacyProjectId`; `{ownerId, createdAt}` |
| `business_members` | `businessId`, `userId`, `role`, `status`, `invitedBy?` | unique `(businessId, userId)` |
| `connected_applications` | `_id: app_*`, `businessId`, `name`, `kind`, `primaryUrl`, `hostname`, `hostVerified`, `connection`, `status` | unique `(businessId, hostname)` where active |
| `business_domains` (existing) | **+** `businessId`, `applicationId?`, `scope: "host"`; `projectId` retained as legacy alias | existing unique partial on `canonicalHostname` unchanged |
| `business_events` | `businessId`, `applicationId?`, `type`, `schemaVersion`, `actor`, `subject?`, `payload`, `occurredAt`, `expiresAt`, `correlationId` | `{businessId, occurredAt}` desc; TTL on `expiresAt` |
| `business_integrations` | `businessId`, `provider`, `status`, `scopes`, `credentialRef`, `lastCheckedAt` | unique `(businessId, provider)` |

`kind` is closed: `marketing_site | saas_app | customer_portal | storefront | mobile_backend | other`.

Note that `businesses` no longer carries `canonicalHost`. The claim is the single place a
hostname is proven and the single place uniqueness is enforced; duplicating it on the business
would create a second source of truth for exactly the value that must have one.

### 5.3 What "independence" means mechanically

Three checkable properties, each a test:

1. Nothing under `app/business/**` or `lib/business/**` imports `components/dashboard/*`,
   `lib/dashboard/*`, or `lib/types/project.ts` (except the compat adapter).
2. The business navigation resolver can only produce `/business/...` hrefs.
3. The business shell renders with no `MirrorProject` in scope.

The repository makes this easier than expected: **there is no `app/project/[projectId]/layout.tsx`**.
Every project page mounts `DashboardShell` itself, so there is no shared layout to inherit.

---

## 6. Contract 1 — Authorization (moves into A′)

### Rule

Membership and authorization are foundational. No business-facing feature — route, port, tool
or job — may be built on an owner-only check. Invitations and team-management UI come later
(G′); the *model and the gate* come first (A′).

### Model

Roles, closed set: `owner | admin | marketer | developer | finance | viewer`.

Permissions, capability-shaped: `business.read`, `business.manage`, `apps.read`, `apps.manage`,
`growth.read`, `growth.publish`, `analytics.read`, `content.write`, `money.read`,
`money.manage`, `members.manage`, `integrations.manage`, `runtime.keys.manage`.

The role → permission matrix is a code constant (the `PLAN_PRICING` precedent), not admin data.

### Gate

```ts
requireBusinessAccess(input: {
  businessId: string
  actor: Actor            // { kind: "user", id } | { kind: "system", id }
  permission: Permission
}): Promise<BusinessAccess>   // { business, member, role, permissions }
```

- One gate. Routes call it; ports call it. Defense in depth: a route gate does not excuse a
  missing port gate, because a port may also be invoked by the AI orchestrator.
- **Owner is a membership row.** `businesses.ownerId` exists for lookup and billing only.
  Authorisation never compares `businessId` to a user id. Ownership transfer is a membership
  change, not a schema change.
- `viewer` may read, never write. `finance` reads money and writes nothing else. `marketer`
  cannot manage keys or members. `developer` manages applications, keys and integrations but
  not money or members.
- Suspended business: reads allowed for `owner`/`admin`, writes refused.
- Archived business: reads only, everyone.

### Enforcement

| Test | Assertion |
|---|---|
| `business-authz-coverage.test.ts` | every route file under `app/business/**` and `app/api/business/**` calls `requireBusinessAccess` (file-tree + AST scan) |
| `business-port-authz.test.ts` | every port implementation calls the gate before doing work |
| `business-no-owner-shortcut.test.ts` | no `businessId === user.id` or equivalent comparison exists in `lib/business/**` or `app/business/**` |
| `business-role-matrix.test.ts` | the matrix is total (every role × permission has an explicit decision) |

### Migration consequence

Every migrated business gets exactly one `business_members` row: the owner, role `owner`,
`status: "active"`, created by the migration script. A business with zero members is a
corrupt record and the verification script fails on it.

---

## 7. Contract 2 — Runtime keys and the principal model

This is the security boundary the rev. 1 document left implicit.

### Rule

A runtime key authenticates **exactly one principal**. A principal is either a built
application (`project`) or a connected application (`application`). The key never identifies
"a business" directly: a business is derived from its application.

### Model

```ts
type RuntimePrincipal =
  | { kind: "project";     id: string }   // Atai-built application
  | { kind: "application"; id: string }   // connected application
```

`ApiKeyDoc` (`lib/runtime/types.ts:25-50`) gains:

- `principal: RuntimePrincipal` — required for every new key.
- `businessId?: string` — denormalised at mint time for `kind: "application"`, for attribution
  and limits without a join.
- `projectId` becomes **optional**, written only for `kind: "project"`.

Compatibility: `principal ?? { kind: "project", id: projectId }`. Existing rows keep working
untouched; a one-time backfill writes `principal` explicitly so the fallback can be deleted
(§16.6).

`RuntimeAuthContext` gains `principal`, `applicationId?`, `businessId?`. Identity fields stay
structurally forbidden in request bodies (`z.never()`), so `businessId` can only ever be
server-derived.

### Resolution order (fail closed at every step)

1. Hash the presented secret → lookup by `keyHash` (unique index).
2. Status, expiry, `deactivateAt`, revocation — unchanged from today.
3. Resolve the principal:
   - `project` → exists? else `runtime_authentication_error`.
   - `application` → row exists and not archived? else **`runtime_key_revoked`** (fail closed,
     same code as a revoked key: an application that no longer exists must never look
     operational).
4. Resolve the business: `businesses` row for `application.businessId`.
   - missing → `runtime_authentication_error`.
   - `suspended` → **`business_suspended`** (a distinct code, so the founder is told whose
     account is blocked).
5. Build the context. `businessId` comes from the row, never from the request.

### Revocation, suspension and rotation — three different things

| Action | Effect | Reversible |
|---|---|---|
| Revoke a key | that key fails immediately | no |
| Delete/archive an application | **its keys are revoked in the same transaction** | no |
| Suspend a business | all its applications fail auth with `business_suspended`; **keys are not revoked** | yes |
| Rotate a key | new key issued; old key keeps working until `deactivateAt` (existing `rotatedFromId` / `rotatedToId` mechanism) | n/a |
| Release a domain claim | the application's `hostVerified` becomes false; auth unaffected | yes |

### Scopes

Semantics unchanged (`[]` = all), **except**: a key with `principal.kind === "application"`
must be minted with a non-empty scope list. An empty-scope connected key would grant every
capability to a customer's server for a journey that only needs analytics. The connection key
stays `["analytics"]`.

### Environments

`production | test`, as today. For application keys the two environments get **separate
per-environment budgets**, so a developer's test traffic cannot starve the live app. Project
keys keep today's behaviour (one budget).

### Limits — how business and application limits interact

```
effective_limit(principal, env) = min( per_principal_env_budget , business_remaining , platform_cap )
```

- Per-principal-per-environment RPM/RPD is burst control.
- A business aggregate ceiling across all its applications and environments is the account
  control; it can never exceed the platform cap (`300/min` today).
- When the business ceiling is hit, every application of that business receives `429` with
  **`business_limit_reached`** — distinguishable from `rate_limited`, so the founder knows
  whether their app is misbehaving or their business quota is spent.
- Project limits (`enforceProjectRuntimeLimits`) are untouched.

### Metering and analytics keying

`runtime_usage` and `analytics_events` are keyed by principal today (`projectId` required,
`lib/types/db.ts:1072-1090`). Both gain `applicationId?` and `businessId?`, with `projectId`
becoming optional. Denormalised `businessId` makes business-level aggregation a single indexed
query instead of a join per row. The application→business link is immutable in this design; if
an application is ever moved, a backfill rewrites the denormalised value.

### Enforcement

| Test | Assertion |
|---|---|
| `runtime-principal.test.ts` | a key resolves exactly one principal; `businessId` is never read from the request |
| `runtime-app-key-lifecycle.test.ts` | archived application → `runtime_key_revoked`; suspended business → `business_suspended`; released claim does not affect auth |
| `runtime-key-scope.test.ts` | minting an application key with `[]` is rejected |
| `runtime-limits.test.ts` | business ceiling clamps the sum of application budgets; the error code is `business_limit_reached` |

---

## 8. Contract 3 — Domain ownership, verification scope and host binding

### Rule

A claim proves control of **one exact hostname**. Verification is never transitive, never
implied by a sibling, and never implied by a registrable domain.

### Model

`business_domains` becomes:

- `businessId` (required), `applicationId?` (the application the claim was proven for),
  `hostname` (exact), `canonicalHostname` (uniqueness key), `scope: "host"`, plus the existing
  status, expiry, history and failure fields.
- `projectId` retained for one release as a legacy alias (§16).

### What a verified host authorises

| It authorises | It does **not** authorise |
|---|---|
| the business's ownership of that hostname (uniqueness) | any sibling subdomain |
| binding that exact host to one application | any other registrable domain |
| claim-dependent capabilities for that application | capabilities for a different application of the same business |

Explicitly: verifying `example.com` does **not** verify `app.example.com` or `shop.example.com`.
Each is its own claim, its own token, its own check. `registrableDomain` exists for display
grouping only and grants nothing — that is already its documented role
(`lib/types/business-intake.ts:307-308`).

### Host binding and the three cases

1. **Verified host, matching application.** The application's `hostname` has a verified claim of
   the same business → `hostVerified: true`.
2. **Application on an unverified host.** Allowed. The application exists and can be read,
   analysed and connected; it simply cannot claim verified ownership, and the UI says so. This
   covers a founder connecting `app.example.com` before proving it.
3. **Application on an unrelated domain.** Allowed, subject to the same rule: that host needs
   its own verified claim. Nothing about the marketing site's claim transfers.

### Multiple domains per business

Supported and intended: `business_domains` is many-to-one with `businesses`. A business may hold
`example.com` (marketing), `app.example.com` (SaaS), `shop.example.com` (storefront) and
`brand.co` (unrelated acquisition) — four claims, one business, four independently proven
hostnames.

Uniqueness is unchanged in kind, extended in scope:

- one `canonicalHostname` → one business (existing partial unique index, untouched);
- one `hostname` → one application **within** a business (new partial unique index).

### Apex and www

Preserved as today: `aliasOf` marks the second exact host of the same business. Each exact host
is still verified separately; `aliasOf` is a claim alias, not a transfer of proof.

### Release

Releasing a claim sets the bound application's `hostVerified: false`, degrades claim-dependent
capabilities, and emits `domain.released`. The application row is retained. The business moves
to `draft` **only** if it has no verified claim left (§9).

---

## 9. Contract 4 — Three lifecycles, not one

Rev. 1 made a business `active` on connection. That conflated a company with a health check.

### 9.1 Business lifecycle

| State | Meaning | Enters when |
|---|---|---|
| `draft` | created, identity not yet proven | creation |
| `active` | identity established | **≥ 1 verified domain claim** |
| `suspended` | administrative hold | admin action (abuse, billing, ToS) |
| `archived` | founder closed the workspace | founder action |

`active` depends on a **verified claim**, never on a connection. A business whose application
has never phoned home, or has gone quiet, is still `active` — it is a real company with a proven
website.

Archiving keeps claims. Releasing them requires the explicit release flow with the existing
confirmation dialog; otherwise archiving would silently free a hostname for another account.

### 9.2 Application connection lifecycle (derived, per application)

`not_connected → connected → stale → disconnected`, plus `revoked`. Derived on read from
`firstSeenAt` / `lastSeenAt` / `revokedAt`, exactly as `businessConnectionStatus` works today,
but scoped to the application rather than the project.

**Handshake evidence (approved decision):** a successful, authenticated, authorised runtime
invocation establishes connection evidence, not only `GET /health`. Rules:

- only **authenticated and authorised** calls count — 401/403 never establish anything;
- writes stay throttled (60s), so a high-traffic app does not write on every request;
- `/health` remains the explicit diagnostic, not the only signal;
- the first evidence sets `firstSeenAt` once and is never overwritten.

### 9.3 Domain claim lifecycle

`reserved → verified → needs_attention → expired | released`, plus `revoked`. Unchanged from
today's implementation (72h reservation, recheck with grace, support release with a mandatory
reason).

### 9.4 Surface availability matrix

The workspace stays usable when one application is disconnected. Only the capabilities that
genuinely depend on a connection are limited.

| Surface | `draft` | `active` | `suspended` | `archived` |
|---|---|---|---|---|
| Overview | onboarding CTA | full | read-only | read-only |
| Applications | full | full | read-only | read-only |
| Growth — crawled/SEO/research | limited (site read only) | full | read-only | read-only |
| Growth — first-party analytics | unavailable | needs a connected application | read-only | read-only |
| Money | read + assessment cost only | full | read-only | read-only |
| Activity | full | full | read-only | read-only |
| Settings / members | full | full | read-only | read-only |
| Connection guide | available once a claim is reserved | full | read-only | read-only |

A disconnected application degrades the analytics column for that application only; the business
does not become unusable and the other applications keep working.

---

## 10. Contract 5 — Business events

### Rule

Events record what happened. **Records hold what is true.** No view may be reconstructed only
from events; `businesses`, `connected_applications` and `business_domains` remain authoritative.

### Model

- `occurredAt` — when it happened. Immutable, used for ordering.
- `expiresAt` — retention expiry. A separate TTL index. Occurrence and retention are different
  concepts, and retention policy must change without rewriting history.
- This follows the collection that already does it correctly: `analytics_events` stores
  `timestamp` plus `expiresAt` and TTLs on the latter (`lib/types/db.ts:1085-1089`).
- `schemaVersion` per event, so payloads can evolve.
- `type` is a closed zod discriminated union, each with its own payload schema:
  `application.connected`, `application.disconnected`, `domain.verified`, `domain.released`,
  `domain.needs_attention`, `integration.connected`, `integration.disconnected`,
  `integration.failed`, `campaign.launched`, `task.created`, `task.completed`,
  `ai.task_completed`, `approval.requested`, `approval.granted`, `approval.declined`,
  `assessment.completed`, `business.updated`, `business.suspended`, `business.archived`.
- `actor: { kind: "user" | "system" | "integration", id }` — never free text.
- `correlationId` joins a cascade (an approval and the action it authorised).
- Retention default 400 days, with per-type override (e.g. `integration.failed` 90 days). The
  exact default is decision R3.
- Payloads are redacted on write (no credentials, no full URLs with query strings, no customer
  data).

### Write path

One function, `recordBusinessEvent()`. No other module touches the collection accessor —
enforced by a test.

### Not an activity dump

No `misc` type, no arbitrary payload field, no client-supplied `type`, no event written from a
browser route.

### Enforcement

| Test | Assertion |
|---|---|
| `business-events-schema.test.ts` | every type has a payload schema; unknown types are rejected |
| `business-events-writepath.test.ts` | the collection accessor appears only in its module |
| `business-events-not-state.test.ts` | every business view model builds with the events collection empty |
| `business-events-retention.test.ts` | `expiresAt` is set from the type's policy; `occurredAt` is never rewritten |

---

## 11. Contract 6 — Billing attribution

Rev. 1 said "every charge carries `businessId`" and then said subscriptions stay account-level.
Both cannot be true. The reconciled rule:

### Rule

Attribution is decided by **what the charge was for**, not by who initiated it. Three tiers,
mutually exclusive.

| Tier | Carries | Examples |
|---|---|---|
| **Account-level** | no `businessId`, no `applicationId` | subscription, plan change, top-up, credit expiry, annual sweep |
| **Business-attributable** | `businessId`; `applicationId` absent | business site read, assessment, co-founder conversation about the business, research, content generation for the business |
| **Application-specific** | `businessId` **and** `applicationId` | runtime capability invocations from that app, a per-app SEO audit, a per-app analytics-driven action |

Every entry retains `service` (the port name), `capability` (the runtime capability when
applicable), `actorId` and `idempotencyKey`.

### Invariants

1. One charge → one ledger entry. Attribution adds fields; it never splits a charge.
2. `applicationId` implies `businessId` (a check in the write path, not a convention).
3. No entry ever carries an account-level marker and a `businessId`.
4. `sum(business_cost) + account_cost = total ledger` — a reconciliation test, so
   mis-attribution cannot hide.

### Reporting

- `business_cost(businessId)` = sum of entries with that `businessId`.
- `application_cost(applicationId)` = sum with that `applicationId`.
- `account_cost` = sum of entries with no `businessId`.
- A `business_usage_daily` rollup is added **only** if measurement shows the aggregation is too
  slow. Not pre-emptively.

The co-founder chat charge currently omits even `projectId`
(`lib/cofounder/credits.ts:46-58`); it gains `businessId` for connected businesses.

---

## 12. Workspace routing and independence

```
app/business/[businessId]/
  layout.tsx                  BusinessShell (own nav, own language, no DashboardShell)
  page.tsx                    Overview
  applications/page.tsx       applications, per-app connection, keys
  growth/page.tsx             SEO, content, campaigns, competition, tasks
  money/page.tsx              cost and attribution
  activity/page.tsx           business_events feed
  settings/page.tsx           members, integrations, danger zone
```

- Every page calls `requireBusinessAccess` (§6) before rendering.
- The onboarding stepper stays at `/project/[projectId]/business` **until** the business is
  migrated and the flag is on; then it 308-redirects to `/business/[businessId]`.
- Navigation: a `BusinessTarget` union and resolver beside `ProjectTarget`
  (`lib/navigation/routes.ts`), preserving "the AI produces a target, never an href". The
  business resolver can only emit `/business/...`.
- One account-nav entry, "Businesses", listing businesses. `/projects` keeps meaning "things
  Atai built".

---

## 13. Service reuse without importing workspace assumptions

The 34 `deployment.productionUrl` read sites (`lib/marketing` 10, `app/project` 8, `app/api` 5,
`lib/workspace` 4, `lib/cofounder` 4, `app/ads` 3) are the coupling to avoid. Rev. 1's
"business address resolver" is **demoted** here: it is an adapter detail, not a foundation.

### Ports

```ts
export interface SiteTarget {
  businessId: string
  applicationId: string
  url: string
  hostname: string
  hostVerified: boolean
}

export interface SeoPort {
  audit(input: { site: SiteTarget; actor: Actor; correlationId: string }): Promise<SeoAuditResult>
}
export interface AnalyticsPort {
  summary(input: {
    businessId: string
    applicationId?: string
    windowDays: number
    dimensions?: ("page" | "channel")[]   // see §15 — does not exist yet
  }): Promise<AnalyticsSummary>
}
export interface MarketingPort { /* copy, campaigns, competition */ }
export interface AiPort { /* text, image, speech via the existing runtime router */ }
export interface ResearchPort { /* competitor and market research */ }
export interface BillingPort {
  charge(input: {
    businessId: string; applicationId?: string; service: string; capability?: string
    amount: number; idempotencyKey: string; actor: Actor
  }): Promise<ChargeResult>
}
```

### Rules

1. A port never accepts a `MirrorProject`, a `projectId`, or a deployment record.
2. Every port takes an `Actor` and calls `requireBusinessAccess` itself (§6).
3. Adapters wrap the existing engines unchanged; where an engine's signature requires a project,
   the adapter adapts.
4. Money leaves only through `BillingPort.charge`.

This keeps the engines and their tests untouched, and means a better engine interface later
moves only the adapter.

---

## 14. AI operating model

### Shape

- **`lib/business/context.ts` — `BusinessContext`.** One builder, cached per request, versioned.
  Business profile, applications and their live addresses, verified claims, connection states,
  analytics summary, growth state, open tasks, recent events, and the actor's permissions.
- **`lib/business/specialists/*` — departments as data**: `{ id, title, tools, contextSlice,
  systemFragment }`. Initial: growth, content, seo, finance, operations.
- **`lib/business/orchestrator.ts`** — intent → department → tool plan → approval → execute →
  event → measure. Reuses the existing `runAgentTurn` loop and `pending-actions`; no second
  agent runtime.
- **Approval gate** — any tool with an external consequence returns a pending action. Mandatory
  for connected businesses, not optional.

### Tool partition

Project-lifecycle tools are **absent** from the connected registry, not refused at call time:
`request_build`, `request_deploy`, `stop_build`, `get_build_*`, `apply_plan_update`,
`analyze_plan`, `request_followup_edit`, `get_plan`. A model that cannot see a tool cannot
promise it.

Reusable once their inputs come from `BusinessContext`: analytics, growth overview, SEO audit,
marketing copy, campaigns, tasks, navigation, account summary.

Every tool declares its required `Permission`; the orchestrator filters the registry by the
actor's permissions before planning, so an under-permissioned member never sees a tool they
cannot use.

---

## 15. End-to-end conformance scenario (the acceptance proof)

The product claim is an operating team, not a set of pages. It must be provable as one flow.

**Scenario.** *"Why did our website traffic decline this month, and what should we do about it?"*

| Step | Mechanism | Permission | Event | Attribution |
|---|---|---|---|---|
| 1. Examine analytics | `AnalyticsPort.summary({ businessId, windowDays: 30, dimensions: ["page","channel"] })` | `analytics.read` | — | business |
| 2. Identify affected pages/channels | same summary, dimension breakdown | `analytics.read` | — | business |
| 3. Investigate SEO and market | `SeoPort.audit` + `ResearchPort` | `growth.read` | — | business + application |
| 4. Form a recommendation | `AiPort` over `BusinessContext` | `growth.read` | — | business |
| 5. Propose tasks / campaign | `MarketingPort.propose` → pending action | `growth.publish` | `task.created` / `approval.requested` | business |
| 6. Approval | founder confirms | `growth.publish` | `approval.granted` / `approval.declined` | — |
| 7. Execute | `MarketingPort.apply` | `growth.publish` | `campaign.launched` | business + application |
| 8. Measure and report | `AnalyticsPort.summary` again, compared | `analytics.read` | `ai.task_completed` | business |

### The hard dependency this exposes

**Step 2 cannot be satisfied today.** The analytics summary returns `totalEvents`,
`uniqueVisitors`, `returningVisitors`, `newVisitors`, `topEvents` (name + count) and `daily`
buckets (`lib/runtime/router/adapters/analytics/mapper.ts:66-86`). There is no page, channel or
conversion dimension, and no per-dimension aggregation in the store.

So the scenario is honest only if D′ adds:

1. Reserved property keys `page` and `channel` in `analytics.track` (the sanitiser already keeps
   bounded scalar properties, so storage needs no schema change).
2. A `dimensions` option on `summary`, aggregated server-side (`$group` on
   `properties.page` / `properties.channel`), with an index to match.
3. A conversion convention (a reserved event name plus a numeric `value` property) so "conversion
   declined" is answerable rather than guessed.

Until that exists, the co-founder can report totals and name the top events, and must say so
rather than inventing a cause. That refusal is a requirement, not a limitation to paper over.

### Conformance test

One integration test drives the eight steps against a seeded business and asserts: every step
authorised by the acting member's permissions; every charge attributed per §11; every listed
event emitted with a valid payload; the final report cites the measurements it used.

---

## 16. Migration, cutover and rollback

Rev. 1 allowed a read adapter to synthesise `biz_legacy_<projectId>` and permitted lazy backfill
writes. Both are withdrawn. A synthetic identity with no persisted row must never own members,
events, connections, usage or ledger entries.

### 16.1 Single writer

`scripts/migrate-connected-businesses-v1.ts` is the **only** code that creates business rows for
legacy data.

- Distributed lock via a `migrations` document (`_id: "connected-business-v1"`, `state`,
  `heartbeatAt`, `startedAt`, `finishedAt`), so two runs cannot overlap.
- Idempotent per project, guarded by the unique sparse index on `businesses.legacyProjectId`.
- Resumable: each row records its outcome; a re-run skips completed projects.
- `--dry-run` first, printing counts and any canonical-host collisions.
- Never deletes or rewrites a claim; it only adds `businessId` to claims and creates rows.

### 16.2 No lazy backfill — read-only legacy mode instead

If a legacy project is reached before migration completes:

- the compat adapter returns a **read-only** view (`mode: "legacy_readonly"`, `businessId: null`);
- every write path refuses with `409 BUSINESS_NOT_MIGRATED`;
- no member, event, application, usage or ledger row is created against a synthetic id.

This removes the race between lazy backfill and the script entirely: there is only one writer,
and the read path cannot write.

### 16.3 Cutover

1. Deploy with the flag `CONNECTED_WORKSPACE_V2` **off**. Old surfaces unchanged.
2. Run the migration (dry-run, then real). Business rows exist; nothing reads them yet.
3. Run the verification script (§16.5). Must pass before step 4.
4. Flip the flag for an internal cohort. New routes serve migrated businesses; legacy-read-only
   remains the fallback for anything missed.
5. Flip for everyone. Then retire the fallback (H′).

### 16.4 Rollback — bounded by a window, on purpose

Rollback is supported in exactly one window: **after migration, before the flag is flipped.**

- In that window the only records created are `businesses`, `connected_applications`,
  `business_members(owner)` and `business_domains.businessId`. Nothing references them. Deleting
  them and unsetting the field is safe.
- **After the flip, rollback is not deletion.** The supported operations are: turn the flag off
  (data retained, old surfaces serve again) or forward-fix. Deleting a business that has members,
  events, applications, usage or ledger entries is never supported — those rows would reference a
  business that no longer exists, which is precisely the failure rev. 1 invited.
- The dependency graph per stage:

| Stage | Dependent records that may exist | Supported rollback |
|---|---|---|
| migrated, flag off | none | delete created rows |
| flag on, internal cohort | members (owner), events, usage, ledger | flag off; keep data |
| flag on, everyone | all of the above + integrations | flag off or forward-fix only |

### 16.5 Verification script

`scripts/verify-connected-businesses.ts`, run after migration and before the flip:

- every project with `startingPoint === "existing_business"` has exactly one business;
- every business has exactly one `owner` member;
- every claim has a `businessId`; no claim points at a missing business;
- no business has zero applications;
- no duplicate `canonicalHostname` across businesses (the index should make this impossible; the
  check proves it);
- counts reconcile against the dry-run report.

### 16.6 Key backfill

`ApiKeyDoc.principal` is backfilled for all existing keys in the same migration window (small
collection, `principal = { kind: "project", id: projectId }`), so the compatibility fallback can
be deleted in H′ rather than living forever.

---

## 17. Phase plan (approved sequence)

| Phase | Work | Required outcome | Reversible? |
|---|---|---|---|
| **A′** | Business identity, connected applications, **membership + authorization gate**, compatibility and migration | secure, persistent business model | yes (flag off) |
| **B′** | Business events, connection lifecycle, **application-scoped runtime authentication** | reliable activity and connection evidence | yes (additive) |
| **C′** | Independent workspace and navigation | a real connected-business experience | yes (flag) |
| **D′** | Business-shaped ports and adapters, including dimensioned analytics (§15) | engines usable without workspace coupling | yes (adapters only) |
| **E′** | Business context, AI departments, permission-aware tools, approvals | operational co-founder | yes (tool registry) |
| **F′** | Billing attribution and money workspace | accurate cost and usage | yes (fields only) |
| **G′** | Team features: invitations, role administration, refinements | mature multi-user operation | yes |
| **H′** | Compatibility retirement and legacy cleanup | no permanent dual architecture | no (intended) |

Ordering constraints that must not be relaxed:

- A′ before everything: no surface without a gate, no record without a persisted identity.
- B′ before C′: the workspace renders connection state that must already be per-application.
- D′ before E′: the AI cannot investigate what the ports cannot fetch.
- F′ may run in parallel with D′/E′ once attribution fields exist, but must precede any
  customer-facing money page.

---

## 18. Non-negotiables, made mechanical

| Rule | Enforcement |
|---|---|
| No business surface without authorization | `business-authz-coverage.test.ts` |
| No owner-only shortcut | `business-no-owner-shortcut.test.ts` |
| One principal per key | `runtime-principal.test.ts` |
| Archived application fails closed | `runtime-app-key-lifecycle.test.ts` |
| No empty-scope application key | `runtime-key-scope.test.ts` |
| Verification is not transitive | `domain-scope.test.ts` (sibling and registrable-domain cases) |
| Business stays usable when an app disconnects | `business-lifecycle.test.ts` (availability matrix) |
| Events are not state | `business-events-not-state.test.ts` |
| One write path for events | `business-events-writepath.test.ts` |
| Attribution reconciles | `billing-attribution.test.ts` (sum identity) |
| Connected surface never imports the project workspace | `business-independence.test.ts` |
| No writes against a synthetic identity | `compat-readonly.test.ts` |
| Deleting an application never releases a business claim | delete-path regression test |

---

## 19. Behaviour changes to document

1. **Deleting an application no longer releases the business's claim.** Releasing is an explicit
   business action with the existing confirmation dialog.
2. **A second connect attempt by the same account adds an application** instead of returning the
   existing project with `reused: true`.
3. **`BUSINESS_ALREADY_CONNECTED` keeps its meaning** (another account holds the hostname),
   evaluated against `business_domains.businessId`.
4. **A working invocation establishes connection evidence**, not only `/health`.
5. **A disconnected application no longer degrades the whole business** — only its own
   capabilities.
6. **An application key must declare scopes**; empty-scope keys are refused at mint time.

---

## 20. Risk register

| Risk | Mitigation |
|---|---|
| Migration partial failure | resumable + locked + dry-run + verification script before flip |
| Dual-write drift | one writer; read-only legacy mode; no lazy writes |
| Rollback after dependents exist | rollback bounded to the pre-flip window; forward-fix afterwards |
| Two shells drifting in design language | shared design tokens; review against the `AGENTS.md` layout language |
| Tool duplication | one registry with a surface filter; project tools absent, not refused |
| Event volume and cost | closed type set; `expiresAt` policy per type; rollup only if measured |
| Analytics dimension gap | named explicitly in §15; D′ delivers it or the scenario is refused honestly |
| Route duplication during transition | 308 redirect with a removal criterion in H′ |

---

## 21. Decisions

### Settled (from the direction)

First-class `businesses`; `connected_applications` as children; `projects` separate; independent
`/business/[businessId]` workspace; business-level membership and permissions; business event
history; business-shaped ports; shared billing with correct attribution; one co-founder over
shared business context; durable events; authenticated invocations as connection evidence;
multiple businesses per account; multiple applications per business; members in the architecture,
phased in implementation.

### Still open

| ID | Question | Recommendation |
|---|---|---|
| R1 | May a built project later attach to a business? | reserve `projects.businessId`; do not implement in this initiative |
| R2 | Business name: founder-typed, or derived from the site title with edit? | derived, editable — keeps the wizard at one question |
| R3 | Default event retention duration | 400 days, per-type override |
| R4 | Criterion for retiring the compat fallback in H′ | one release **and** 100% migrated **and** a clean week |
| R5 | "Businesses" as a top-level nav entry or under `/dashboard`? | top-level — the surfaces must read as separate products |
| R6 | Does `draft` (no verified claim) get the connection guide at all? | yes, once a claim is reserved; verification first, connection second |
| R7 | Are integrations business-level or application-level? | business-level, with an optional application binding — a provider like Stripe usually belongs to the company, not one app |

Resolved by the direction and removed from this list: business row created before the claim;
`expiresAt` instead of TTL on `occurredAt`; migration-then-flip cutover. The identifiers above
are renumbered from 1, so they do not collide with the rev. 1 numbering.

---

## 22. What remains unverified

- No production data was queried. The number of connected businesses, claims and canonical-host
  collisions is unknown; the migration dry-run answers it.
- The 34 `deployment.productionUrl` read sites were identified by reading; none was exercised
  against a connected business at runtime.
- The claim index was read from `lib/db/collections.ts`, not from Atlas; the migration must
  confirm it exists as described.
- The analytics dimension gap in §15 is established from the summary contract
  (`mapper.ts:66-86`), not from a live query; a live check should confirm no consumer already
  relies on a dimension that exists somewhere else.
- No timing or cost estimate is offered. The phases are ordered, not sized.
