# BUSINESS DATA & INTEGRATION AUDIT

**Audit:** ATAI.INK Full Product Vision & Expectation-Gap Audit (Part 7 of 16)
**Date:** 2026-11-09
**Method:** Read-only code inspection. Every claim carries a `path:line` citation and an evidence label — VERIFIED (read in code), INFERRED (derived from code behavior), or UNVERIFIED (could not be confirmed in this pass).
**Boundary:** No production data was read, no external services were called, no code was modified. Collection *schemas* were verified in code; live data quality was not.

---

## 1. What "integration" means for Atai — and what this document covers

Atai's promise requires data to flow across six domains: the founder's plan, the built application, customers of that application, the founder's money, Atai's money, and the AI co-founder. This document audits whether those flows actually exist, where the same fact is stored twice, which relationships are missing or unenforced, and what happens on deletion.

Headline: **the plumbing inside each domain is disciplined, but the domains barely connect to each other.** There is no business object graph (customer → order → revenue) because the business objects themselves do not exist as data; the only cross-domain links that exist are `projectId` / `userId` string references.

---

## 2. Source-of-truth map

VERIFIED. One authoritative store per domain; several domains have *two* stores, one of which is legacy or invisible.

| Domain | Authoritative store | Second store | Divergent? |
|---|---|---|---|
| Founder identity / auth | `users` | `sessions`, `verification_tokens` | No — linked by userId |
| Project + plan | `projects` (embedded `specification`, `understanding`, `aiArtifacts`, `planAnalysis`) | `planning_runs` (run history) | No |
| Built app lifecycle | `build_runs` | `projects.totalumProjectId`, `projects.state` | State is duplicated in project doc; reconciliation exists (poll-based) |
| Atai money in | `payment_records` (Dodo) | `subscription_records`, `topups` | Coherent; both keyed by Dodo ids |
| Credits | `credit_ledger` (double-entry, idempotency keys) | `users.credits/subscriptionCredits/permanentCredits` buckets | Buckets are projections of the ledger; consumption is transactional (`credit-service.ts:423-609`) |
| Provider cost | `runtime_usage` | `provider_usage` | **`provider_usage` has no writers left** — only `app/api/me/avatar/route.ts:25` reads it. Dead store (VERIFIED: grep of all non-test writers found none) |
| Webhook durability | `webhook_events` | `credit_ledger` idempotency keys | Coherent |
| Product analytics of built apps | `analytics_events` | — | See §5 — written but never surfaced |
| Co-founder actions | `cofounder_pending_actions` | `cofounder_conversations`, `project_chats` | Three conversation stores, see §6 |
| Marketing artifacts | `campaigns`, `content_items`, `brand_profiles`, `seo_audits`, `growth_tasks` (+history) | — | All project-scoped, none cross-linked, see §7 |
| Built-app business data (customers, orders, invoices, expenses, payouts) | **Does not exist anywhere** | — | The built app's records live only in its Totalum database, reachable solely through the founder-facing database console (`app/api/projects/[id]/database/query/route.ts:1-30`, records create/edit/delete/link routes) |

---

## 3. The entity graph that exists

VERIFIED (collection shapes in `lib/types/db.ts`, `lib/types/project.ts`, `lib/types/collab-chat.ts`).

```
users ──< sessions
  │
  ├──< projects ──< build_runs
  │      │  (embedded: specification, understanding, conversation,
  │      │            aiArtifacts, planAnalysis, planUpdateNotes,
  │      │            deploymentHistory, infrastructure, analyticsConsent)
  │      ├──< project_assets / project_attachments
  │      ├──< project_chats (co-founder threads)
  │      ├──< cofounder_conversations
  │      ├──< campaigns (+campaign_history)        ┐
  │      ├──< growth_tasks (+history)              ├─ plan/tracking only,
  │      ├──< content_items / brand_profiles       │  no execution rows
  │      ├──< seo_audits                           ┘
  │      ├──< analytics_events  (90-day TTL)
  │      ├──< runtime_usage
  │      ├──< api_keys / project_runtime_config
  │      └──< planning_runs
  ├──< credit_ledger ──> payment_records / build_runs (referenceType/Id)
  ├──< payment_records ──< subscription_records (via dodoSubscriptionId)
  ├──< referrals (account-level only)
  └──< project_likes / user_follows / project_forks (Explore social graph)
```

**What is absent from this graph** — VERIFIED against the full 49-collection inventory in CURRENT-CODEBASE-BASELINE.md §4: `customers/contacts/leads`, `orders`, `invoices`, `expenses`, `vendors/suppliers`, `staff/roles/permissions` (beyond a single `users.isAdmin` boolean, `lib/auth/session.ts:164-168`), `payouts` (to the founder), `appointments` as founder-owned data, `inventory`. A founder cannot record, and Atai cannot track, a single real business transaction of their company. The "manage the business" promise has no substrate.

---

## 4. The one real integration seam: built app ↔ Atai Runtime

VERIFIED. The generated app talks to Atai exclusively through the runtime gateway with its `ATAI_API_KEY` (`lib/runtime/provisioning/service.ts:38-41`).

- Requests are authenticated by hashed key lookup; identity (userId/projectId/environment/scopes) is derived server-side, never from client input (`lib/runtime/auth/authenticate.ts:135-195`).
- Usage is metered per call into `runtime_usage` with resolved pricing snapshots (`lib/billing/runtime-config.ts:210-217`).
- Analytics events are stamped with `projectId` from the key identity (`lib/types/db.ts:972-988`), 90-day TTL (`lib/runtime/router/adapters/analytics/mapper.ts:20`).
- Payment attribution works by metadata stamping: the payments adapter writes `_ataiProjectId` into Dodo metadata (`lib/runtime/router/adapters/dodo/adapter.ts:200`), and project finances read it back (`lib/finances/project-finances.ts:543-568`).

INFERRED consequence: everything the founder's business *is* — their customers, their orders, their money — exists **only if it happens to flow through a runtime capability**. A customer who buys something via the Dodo adapter appears in Atai finances. A customer who emails, books, or signs up exists only inside the Totalum database, where the co-founder cannot see it (no database tool in `lib/cofounder/tools/` — VERIFIED by listing the tool files: analytics, applications, campaigns, growth, navigation, plans, projects, seo, studio, tasks, workspace) and no Atai collection mirrors it.

---

## 5. Written but invisible: the analytics events paradox

This is the most consequential integration failure found in this audit, and it is fully VERIFIED:

1. **Ingestion exists.** The runtime `analytics` capability persists events with project scoping, TTL, and index coverage (`lib/db/collections.ts:629-633`, `lib/runtime/router/adapters/analytics/store.ts:36-104`).
2. **The platform's own Intelligence page claims it does not exist.** `lib/intelligence/overview.ts:334-367` renders nine metrics as `notInstrumented("Atai does not collect events from your generated app yet…")` — appEvents, activeUsers, journeys, retention, appErrors, appPerformance, customerFeedback, recommendations, experiments.
3. **Growth says the same.** `lib/marketing/growth-overview.ts:509-516`: "Atai does not yet collect visitor analytics for generated apps."
4. **The only readers** are (a) the co-founder tool behind a three-gate consent check (`lib/cofounder/tools/analytics.ts:34-62`) and (b) the generated app itself via its own key. **No founder-facing page reads `analytics_events`.**
5. **90-day TTL with no rollups.** Events are auto-purged (`lib/runtime/router/adapters/analytics/mapper.ts:146`) and no aggregation table exists, so even the co-founder's view loses all history past 90 days.

So the data pipeline for "understand your customers" is ~70% built and 0% surfaced to its intended audience, while two surfaces actively tell the founder it doesn't exist. This is both a waste of built capability and a trust problem: the honest "not instrumented" copy is now factually wrong.

---

## 6. Three conversation stores, one shared memory that nobody replays

VERIFIED. Founder↔AI conversation is persisted in three places with different shapes and different consumers:

| Store | Written by | Read by |
|---|---|---|
| `projects.conversation` (embedded array) | plan-chat / legacy flows (`lib/analysis/cofounder.ts:217-272` slices last 12 into plan-chat prompts) | plan-chat only |
| `project_chats` (project-scoped threads, 200-msg cap) | the /collaborate ChatPanel (`lib/collab-chat/store.ts`) | **only the UI reload** |
| `cofounder_conversations` (workspace-level) | the header co-founder agent (`lib/cofounder/agent.ts:222-225` persists after each turn) | **only the UI reload** |

The critical defect: `runAgentTurn` sends the model `contextBlock + FOUNDER MESSAGE: <current message>` and nothing else (`lib/cofounder/agent.ts:189-190`). The transcript it just persisted is never replayed. The co-founder is fully amnesiac across turns — it cannot refer to what the founder said one message ago except through the compact project brief. Plan-chat, by contrast, does feed history. Two AI conversational surfaces in the same product behave differently, and the flagship one is the one with no memory.

Data-quality note: legacy import exists for `projects.conversation` → `project_chats` (one-time, idempotent, `lib/collab-chat/store.ts:150-197`), but nothing merges the *cofounder_conversations* thread history into anything.

---

## 7. Marketing modules are islands

VERIFIED from the document shapes (`lib/types/db.ts:742-960`) and services:

- `CampaignDoc` has `utmCampaign` and `plannedBudgetCents` but **no contentIds, no taskIds, no outcome fields**. Nothing links a campaign to the content written for it (`ContentItemDoc` has `channel` but no `campaignId`).
- `GrowthTaskDoc.sourceNextStepId` is a link to the derived next-step that seeded it (`lib/marketing/tasks/service.ts:50`), but task completion feeds **no metric** — grep found zero consumers of task status outside the tasks routes.
- SEO audit findings (`SeoAuditDoc.findings`) are never promoted into growth tasks or campaigns — no `auditId` reference exists in tasks/campaigns (grep VERIFIED, zero hits).
- Campaign "execution" tables are explicitly deferred pending a job substrate (`lib/types/db.ts:895-900` comments; `lib/billing/webhook-recovery.ts:41` confirms no job substrate exists). So the marketing pillar can plan and label but never act or measure.

INFERRED: this is honest scaffolding, not integration. Each module was built to display its own state; the founder must be the integrator.

---

## 8. Money flows: coherent on Atai's side, one-way toward the founder

VERIFIED:

- Every credit movement is a double-entry ledger row with an idempotency key and per-bucket balance clamps (`lib/billing/credit-service.ts:1052-1140`); reversal vocabulary is direction-scoped (`lib/billing/reversal-types.ts:23-52`).
- Refund clawbacks are proportional, currency-checked, and idempotent per refund id (`lib/billing/dodo-event-processing.ts:524-560`).
- Founder earnings are *attributed* via Dodo metadata, but the founder's actual money settles in **Atai's Dodo account** (payouts are account-level by design, `lib/runtime/router/adapters/dodo/mapper.ts:412-420`). There is no founder payout system, no connected-account model — a founder's "revenue" in Atai is a metadata-derived view of Atai's own bank account.

INFERRED consequence: the money *data* is integrated; the money *movement* is not. Two founders' revenue lives commingled in one Dodo account with nothing but metadata strings separating them. This is acceptable for bookkeeping today and unacceptable as a business platform claim tomorrow (see SECURITY audit, S-01).

---

## 9. Deletion, cascades, retention, and export

### 9.1 What deleting a project actually deletes

VERIFIED. `lib/store/mongo-store.ts:541-566` runs a transaction that deletes:
1. the `projects` document,
2. `build_runs` (`mirrorProjectId`),
3. `project_attachments` (`projectId`).

It does **not** delete or even touch:

`project_chats`, `cofounder_conversations`, `cofounder_pending_actions`, `campaigns` + `campaign_history`, `growth_tasks` + `growth_task_history`, `content_items`, `brand_profiles`, `seo_audits`, `planning_runs`, `analytics_events`, `runtime_usage`, `api_keys`, `project_runtime_config`, `project_assets`, `project_likes`, `project_forks`, `project_github`, generated lessons, or the embedded `aiArtifacts` copy in… well, that one dies with the project doc. Roughly 20 collections can be left holding orphaned `projectId` references (INFERRED from the cascade code; the exact live-orphan count is UNVERIFIED because production data was not inspected).

### 9.2 Two worst-case consequences (both VERIFIED)

1. **Runtime keys survive deletion.** `authenticateRuntimeRequest` resolves the key and returns; nothing checks that `projectId` still exists (`lib/runtime/auth/authenticate.ts:135-195`). `grep` for `revokeApiKey` callers shows only manual dashboard revocation, rotation, and provisioning retries — never project deletion. A deleted project's deployed app keeps a valid key: it keeps calling AI/payments, keeps **charging its owner's credits**, and keeps writing analytics rows for a project that no longer exists.
2. **The Totalum project is never deleted.** `lib/integrations/totalum/service.ts` exposes delete endpoints only for domain/records/secrets — there is no project-deletion call anywhere (grep VERIFIED, zero call sites), and the DELETE handler at `app/api/projects/[id]/route.ts:267-284` makes none. A founder who deletes a project in Atai leaves a live, public, Totalum-hosted application running — one they may believe is gone. No Totalum project-delete API is *used*; whether Totalum offers one is UNVERIFIED from here.

### 9.3 Retention and export

- Analytics: 90-day TTL, no rollups (§5).
- Everything else: no retention policy at all — deliberately so in places (topups TTL was removed for audit durability, `lib/db/collections-topups-retention.test.ts`; sessions/tokens/rate_limits keep TTLs, `lib/db/collections.ts:376-381`).
- Export: `GET /api/projects/[id]/export` (`app/api/projects/[id]/export/route.ts:14-40`) returns only core project fields. No chats, campaigns, tasks, analytics, finances, assets, artifacts. The founder cannot take their business data out of Atai in any complete form. Data portability is currently a compliance-shaped stub.

---

## 10. Permission boundaries over this data

VERIFIED (sampled exhaustively across route families):

- Every project-scoped route checks `project.userId !== user.id` before acting; deletion is atomic ownership-filtered (`mongo-store.ts:551-555`).
- Internal `/api/internal/*` is constant-time shared-secret auth, fails closed when the key is unset (`lib/api/internal-key.ts:41-67`), with hashed-identifier rate limiting (`lib/api/internal-limit.ts:5-9`).
- Runtime keys authenticate identity without any project-liveness check (§9.2) and scope semantics treat empty scope list as *all capabilities* (`lib/runtime/auth/authorize.ts:29-32`) — manual dashboard keys default to that.
- Co-founder reads are owner-scoped; analytics reads additionally gated by flag + consent (`lib/cofounder/tools/analytics.ts:34-62`).
- `users.isAdmin` is the entire RBAC model; there are no roles between founder and admin.

---

## 11. Disconnected modules summary

| Surface | Says / does | Reality | Verdict |
|---|---|---|---|
| Intelligence | "Atai does not collect events yet" (overview.ts:334) | Ingestion pipeline live since analytics adapter shipped | **Contradicted by code** |
| Grow | "Site visitors not collected" (growth-overview.ts:509) | Same | **Contradicted by code** |
| Co-founder | "Persistent collaborator who knows your project" (prompts.ts) | No transcript replay; memory = one compact brief | **Overstated** |
| Campaigns/Tasks | Plan + track | Nothing executes, nothing feeds metrics | Honest but inert |
| Finances | Attributed founder revenue | Reads Atai's commingled Dodo account via metadata | Data honest, money movement absent |
| Database console | Full CRUD on built-app data | Exists, founder-only; co-founder cannot see any of it | Real integration gap |
| Export | "Export project" | Core fields only | Stub |
| Delete project | "Permanently deletes" | 3 of ~23 collections; app stays live; keys stay valid | **Misleading** |

---

## 12. Findings

Severity: P0 = blocks the promise or is unsafe; P1 = breaks trust/data; P2 = major rework later; P3 = quality.

**D-01 (P0) — Deleting a project deletes neither the running app nor its credentials.**
Evidence: `lib/store/mongo-store.ts:541-566` (cascade scope), `lib/runtime/auth/authenticate.ts:135-195` (no liveness check), zero `revokeApiKey`/Totalum-delete call sites (grep). Impact: zombie apps keep spending owner credits; founder's mental model of deletion is false; orphaned rows accumulate in ~20 collections. Consequence if unresolved: credentialed spend and a live public app the founder believes is deleted — a refund/complaint magnet and a security exposure. Fix shape: extend the deletion transaction (revoke keys by projectId, null out or delete the linked collections) and either call Totalum delete or surface an explicit "the deployed app will remain" warning plus a later teardown action.

**D-02 (P0) — The co-founder has no conversation memory.**
Evidence: `lib/cofounder/agent.ts:189-190` (only current message), persisted-but-never-replayed transcript at `:222-225`. Impact: the "co-founder" cannot hold a multi-turn conversation, contradicts its own positioning, and wastes the transcript infrastructure already built. Fix shape: replay the thread (bounded, e.g. last N turns) as messages — the store already returns full history (`lib/collab-chat/store.ts` `getProjectChat`).

**D-03 (P1) — Analytics is collected, 90-day-expiring, and shown to no one who could act on it.**
Evidence: §5 citations. Impact: the entire measurement promise (Intelligence, Growth, recommendations, experiments) is starved of data that already exists and expires. Fix shape: founder-facing summary reads + persisted daily rollups; align Intelligence/Growth copy with reality.

**D-04 (P1) — Built-app business records are invisible to the AI.**
Evidence: no database tool in `lib/cofounder/tools/`; Totalum query API exists at `lib/integrations/totalum/service.ts:198-246` but is exposed only through founder-facing routes. Impact: "your AI team helps you run your business" stops at the boundary of the data the AI can read. Fix shape: a read-only, consent-gated co-founder database-summary tool (tables, counts, recent records — no raw PII dumps), reusing the existing Totalum service.

**D-05 (P1) — Three conversation stores with no unification.**
Evidence: §6 table. Impact: memory defects (D-02), legacy import complexity, inconsistent behavior between surfaces. Fix shape: one thread abstraction; embedded `projects.conversation` stays read-only legacy.

**D-06 (P1) — Founder revenue settles commingled in Atai's Dodo account with metadata-only attribution.**
Evidence: `mapper.ts:412-420` (account-level payouts), `adapter.ts:200` (attribution stamp). Impact: bookkeeping works today; at any scale this becomes an accounting/compliance problem and caps any "payouts" promise. Fix shape: connected accounts or at minimum a reconciliation report per project (the metadata already supports it).

**D-07 (P2) — ~20 collections can orphan on project deletion.**
Evidence: §9.1 list. Impact: storage bloat, future queries must defensively filter for dead projectIds. Fix shape: cascade extension in D-01; a sweep job for historic orphans.

**D-08 (P2) — `provider_usage` is a dead store.**
Evidence: zero writers (grep); only reader is `app/api/me/avatar/route.ts:25`. Impact: confusion risk — a second, divergent usage ledger that nothing populates. Fix shape: drop the collection + type, or repoint the reader.

**D-09 (P2) — Marketing entities are unlinked islands.**
Evidence: §7. Impact: the founder-as-integrator problem; no funnel from "wrote content" → "ran campaign" → "measured result". Fix shape: `campaignId` on content items and tasks, and let campaign completion read analytics rollups (depends on D-03).

**D-10 (P2) — Export is a stub.**
Evidence: `export/route.ts:14-40` field list. Impact: founder data is not portable; GDPR-shaped risk as real business data accumulates. Fix shape: bundle the linked collections per project.

**D-11 (P3) — `users.isAdmin` is the whole permission model.**
Evidence: `lib/auth/session.ts:164-168`. Impact: fine for a solo operator; blocks any team/multi-seat ambition later. Fix shape: defer until team features are real.

**D-12 (P3) — Social graph (likes/follows/forks) has no liveness policy.**
Evidence: shapes at `lib/types/db.ts:427-466`. Impact: forks of deleted projects may render dead references (UNVERIFIED against live data). Fix shape: fold into D-01's cascade.

---

## 13. What this means for the vision

The data layer is the mirror image of the codebase's strengths: **Atai's own operational data (builds, credits, ledger, webhooks, runtime usage) is among the most disciplined schemas this audit has seen in a project at this stage — and the founder's business data barely exists.** The promised business ecosystem needs a founder-owned object graph (customers, orders, revenue, payouts, rollups) that today is 90-day TTL events plus metadata strings. Two fixes unlock disproportionate value: make deletion mean deletion (D-01), and give the founder (and the AI) eyes on the data that already flows in (D-03, D-04).
