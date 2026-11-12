# TARGET ATAI ARCHITECTURE

**Audit:** ATAI.INK Full Product Vision & Expectation-Gap Audit (Part 13 of 16)
**Date:** 2026-11-09
**Principle:** The target is described in terms of what already exists. Every layer names the code to REUSE, the code to ADD, and the communication pattern between layers. The Totalum boundary is preserved throughout — Atai keeps building and hosting through Totalum and extends its own surfaces around it, never replaces it.

---

## 1. The shape of the target

```
┌─────────────────────────────────────────────────────────────────────────┐
│ L1  FOUNDER SURFACES            dashboard · plan · collaborate · market │
│                                 intelligence · finances · settings      │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ server actions / API
┌──────────────▼──────────────────────────────────────────────────────────┐
│ L2  IDENTITY & ACCESS          users · sessions · requireUser/admin     │
│                                tenancy rules (project + key scoping)    │
└──────────────┬──────────────────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────┐   ┌─────────────────────────────┐
│ L3  PLAN & KNOWLEDGE                 │   │ L4  BUSINESS SUBSTRATE (new)│
│ specification · plan sections ·      │   │ customers · orders · revenue│
│ aiArtifacts · planUpdateNotes        │   │ rollups · payouts ledger    │
└──────────────┬───────────────────────┘   └──────────┬──────────────────┘
               │                                       │
┌──────────────▼───────────────────────────────────────▼─────────────────┐
│ L5  MEASUREMENT                 runtime_usage · analytics_events ·     │
│                                 daily rollups (NEW) · attribution      │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ facts
┌──────────────▼──────────────────────────────────────────────────────────┐
│ L6  INTELLIGENCE & ADVICE       co-founder agent (+memory, NEW reads)   │
│                                 plan analysis · lessons                 │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ proposed actions
┌──────────────▼──────────────────────────────────────────────────────────┐
│ L7  AUTONOMY & EXECUTION        pending actions (exists) ·              │
│                                 job substrate (NEW) · schedules ·       │
│                                 recovery heartbeats (NEW trigger)       │
└──────┬───────────────────────────────┬──────────────────────────────────┘
       │ execute                        │ time-based triggers
┌──────▼──────────────────┐   ┌─────────▼─────────────────────────────────┐
│ L8  CAPABILITY RUNTIME  │   │ L9  BUILD & DEPLOY (Totalum, unchanged)   │
│ router · adapters ·     │   │ build runs · deploy · secrets · DB console│
│ metering · scopes       │   └───────────────────────────────────────────┘
└──────┬──────────────────┘
       │ billable events
┌──────▼──────────────────────────────────────────────────────────────────┐
│ L10 MONEY                       credit_ledger · valuation · Dodo billing│
│                                 payment_records · subscription_records  │
└─────────────────────────────────────────────────────────────────────────┘

CROSS-CUTTING:
│ L11 DATA LIFECYCLE   cascade+archive · export · retention/rollups
│ L12 TRUST & SAFETY   tenancy enforcement · injection fences · audit trail
│ L13 OBSERVABILITY    structured logs · error tracking (NEW) · CI (NEW)
│ L14 GROWTH SURFACES  campaigns · tasks · SEO · content — wired to L5+L7
```

---

## 2. Layer-by-layer

### L1 — Founder surfaces
- **Exists (reuse):** all app/ pages, DashboardShell, workspace views, credit gate, staged worklog patterns.
- **Missing:** Intelligence/Growth reads over real events (L5), business-object views (L4), marketing wiring (L14).
- **Communication:** consumes APIs only; no direct collection access in components (already true).

### L2 — Identity & access
- **Exists (reuse):** sessions, bcrypt/token split, requireUser/requireAdmin, constant-time internal key.
- **Add:** tenancy enforcement points already identified — project-liveness check in runtime auth (`authenticate.ts`), narrow provisioned scopes, explicit-scope manual keys.
- **Pattern:** middleware-level helpers, no new service.

### L3 — Plan & knowledge
- **Exists (reuse, unchanged):** 19-section plan, section clusters, aiArtifacts, planUpdateNotes, plan locking.
- **Missing:** nothing structural. This layer is done; it becomes the *input* to L6 and the *archive* after build (already implemented).

### L4 — Business substrate (the new center of gravity)
- **Exists:** nothing; deliberately absent today.
- **Add:** `customers`, `orders`, `revenue_rollups` (per project/day), `payout_ledger` — all founder-owned, project-scoped, populated from (a) runtime payment attribution already stamped `_ataiProjectId` (`dodo/adapter.ts:200`), (b) analytics events with identity joins where consented, (c) manual founder entry (the honest seed path).
- **Required data:** the runtime attribution (exists), analytics events (exist), rollup writer (new).
- **Dependencies:** L5 (rollups), L10 (attribution source of truth), L12 (consent + tenancy on reads).
- **Pattern:** Mongo collections + one shared service module (`lib/business/`), mirroring `lib/marketing` structure. NOT a microservice.

### L5 — Measurement
- **Exists (reuse):** runtime_usage with pricing snapshots, analytics_events ingestion with TTL, `_ataiProjectId` attribution.
- **Add:** a daily rollup writer (persists summary rows so history survives the TTL — the single change that converts B-gap into permanent history); founder-facing summary read API; Intelligence/Growth copy switch.
- **Dependencies:** job substrate for scheduling the rollup (L7), or run-on-read backfill as a stopgap.
- **Pattern:** extend `lib/runtime/router/adapters/analytics/store.ts` compute paths; new `lib/measurement/rollups.ts`.

### L6 — Intelligence & advice
- **Exists (reuse):** co-founder agent + tools + pending-action ladder, plan analysis service, lessons corpus, runtime-awareness block.
- **Add:** thread replay in `runAgentTurn` (last N turns from `project_chats` — the store already returns full history); read tools over L4/L5 (customers, rollups) behind the existing consent gate pattern (`cofounder/tools/analytics.ts:34-62` is the template); retire the plan-chat/agent memory split by adopting one thread store.
- **Dependencies:** L4/L5 for facts; nothing for the memory fix.
- **Pattern:** extend `lib/cofounder/tools/` registry; no new subsystem.

### L7 — Autonomy & execution
- **Exists (reuse):** pending-action atomic claim/finalize (this is the autonomy kernel — keep exactly as is), recovery worker logic (idempotent, lease-claimed, budgeted), AI leases, single-flight.
- **Add:** the job substrate: a `jobs` collection + one claim-loop entrypoint + a 5-minute external cron hitting it (the repo's own recovery worker is the reference implementation to generalize — same claim/lease/budget vocabulary). Jobs the substrate immediately serves: webhook recovery heartbeat (R-02), analytics rollups (L5), stale-build sweeps, campaign/task scheduled executions, lesson digests.
- **Dependencies:** none — smallest new subsystem with the largest unblocking effect.
- **Pattern:** `lib/jobs/` shared service; execution handlers live in their owning modules (no central god-module).

### L8 — Capability runtime
- **Exists (reuse, mostly unchanged):** router, adapters, metering fail-closed, pricing snapshots, platform limits.
- **Add:** `_ataiProjectId` server-side filtering for project-context Dodo reads (S-01 fix); routed `auth`/`storage` capabilities or their honest removal from contracts.
- **Pattern:** adapters only; no architectural change.

### L9 — Build & deploy (Totalum)
- **Exists (reuse):** the entire integration — build runs, deploy, secrets, database console, provisioning mapping.
- **Add:** a deletion/teardown path (call Totalum delete if available, else explicit warning + teardown job), and a co-founder read-only database-summary tool reusing `queryDatabase` (`totalum/service.ts:203`).
- **Constraint honored:** Totalum remains the sole builder/host; Atai never reimplements it.

### L10 — Money
- **Exists (reuse, do not restructure):** double-entry credit_ledger, valuation constants, reversal vocabulary, Dodo event processing + recovery, subscription grants.
- **Add:** one pricing truth (single function all three paths call); provider-cost normalization policy in `runtime_usage` reporting; the pack-pricing anchor note where USD is quoted.
- **Pattern:** existing `lib/billing`; changes are call-site unification, not redesign.

### L11 — Data lifecycle
- **Exists:** TTLs (sessions, tokens, analytics, firecrawl), deliberate no-TTL decisions.
- **Add:** deletion transaction extension (revoke keys → cascade/null ~20 collections → Totalum teardown decision); full export bundle; orphan sweep job (uses L7).
- **Pattern:** extend `store.deleteProject` transaction; new export service.

### L12 — Trust & safety
- **Exists (reuse):** injection fences (five surfaces), pending-action audit, log redaction, webhook verification, upload hardening.
- **Add:** audit-log writes for admin self-credit and key lifecycle events (ledger already records grants); explicit-scope validation for new manual keys.
- **Pattern:** existing patterns; no new subsystem.

### L13 — Observability & engineering process
- **Exists:** structured stdout logging with redaction; ~200 test files locally.
- **Add:** error tracker (hosted log drain is sufficient at this scale), un-ignore tests + minimal CI (typecheck → tests → build), keep the Windows build verification ritual (`npx next build`) as the local gate.

### L14 — Growth surfaces
- **Exists (reuse):** campaigns/tasks/SEO/content stores with honest provenance labels, UTM builder, brand profiles.
- **Add (strictly sequenced):** `campaignId` on content items; task outcome reads from L5 rollups; scheduled campaign/task execution through L7 with consent; only after B and C land.
- **Dependencies:** L5 (evidence), L7 (execution), L4 (outcomes).

---

## 3. Build order encoded in dependencies

```
L13 (CI + tracker)        ← nothing depends on it; protects everything else
L7  (job substrate)       ← unblocks L5 rollups, L11 sweeps, L14 execution, R-02
L5  (rollups + reads)     ← unblocks L6 reads, L14 outcomes, fixes B-gap copy
L6  (memory + reads)      ← memory fix needs nothing; read tools need L5
L11 (deletion + export)   ← independent; closes E/H gaps
L8  (tenancy filters)     ← independent; closes S-01
L10 (pricing truth)       ← independent; closes R-01
L4  (business substrate)  ← depends on L5 rollups; the last big build
L14 (grow execution)      ← depends on L4+L5+L7
```

**Everything in the first five rows reuses existing code paths; only L4 and L7 are genuinely new subsystems, and L7 is small (the recovery worker already proves the pattern).**

---

## 4. What is deliberately NOT in the target

- A second app-builder or hosting layer (Totalum keeps that role).
- An agent framework rewrite — the tool/confirmation ladder stays.
- A general CRM product; the substrate serves the founder's app and Atai's advice, not generic sales pipelines.
- Multi-region/multi-instance cache topology — revisited only when a second instance is real.
