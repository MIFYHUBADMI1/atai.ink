# CRITICAL GAPS & FINDINGS

**Audit:** ATAI.INK Full Product Vision & Expectation-Gap Audit (Part 11 of 16)
**Date:** 2026-11-09
**Purpose:** The single consolidated register. Every entry summarizes a finding evidenced in the domain documents (lifecycle ST-/BU-/LA-/RUN-/MA-/GR-/IM-, AI audit, UX audit, BUSINESS-DATA D-xx, RUNTIME R-xx, SECURITY S-xx) and adds nothing unevidenced. Severity reflects the *promise*: does this gap prevent Atai from being what it says it is?
**Tone note (per brief):** nothing here is softened. Where the code is excellent, the domain docs say so; this document exists for the gaps.

---

## A. The business substrate does not exist

**Problem.** Atai's promise is to help founders *run and grow a business*. The database contains zero founder-business objects: no customers/contacts/leads, no orders, no invoices, no expenses, no vendors, no staff/roles, no payouts. The only things that exist are Atai's own operational records (projects, builds, credits) and 90-day-expiring event rows from generated apps.
**Evidence.** Full 49-collection inventory (CURRENT-CODEBASE-BASELINE §4); absence of customer/order/finance collections (BUSINESS-DATA §3); founder "revenue" is metadata-attributed view of Atai's commingled Dodo account (BUSINESS-DATA §8, D-06); Totalum DB reachable only via founder-facing console, invisible to the AI (BUSINESS-DATA D-04).
**Why it matters.** Every "run/manage/grow" feature (Intelligence, Growth, campaigns, tasks, lessons) currently reasons over plan text and runtime request counts — proxies, not the business. The AI co-founder cannot advise on customers it cannot see; the analytics pipeline measures activity Atai cannot show.
**User impact.** A founder with a deployed app and paying customers gets a workspace that says "revenue your app generates is invisible to Atai" (`lib/marketing/growth-overview.ts:522-527`).
**Affected parts.** Intelligence, Growth, Market & Grow modules, co-founder advice quality, finances, competitive positioning (COMPETITIVE §3).
**Consequence if unresolved.** Atai remains an app builder wearing a business-platform story. Churn happens at exactly the moment a founder succeeds — when real customers appear, the platform has nothing for them.
**Solution direction.** Founder-owned business object layer (customers, orders, revenue rollups) fed by runtime attribution + a consent-gated read model over the built app's Totalum data; this is the roadmap's central build (PRIORITIZED-IMPLEMENTATION-ROADMAP P1 wave).

---

## B. Data that exists is invisible, contradicted, or expiring

**Problem.** The analytics pipeline works end-to-end (ingest → store → TTL) and its intended consumers deny it exists.
**Evidence.** Ingestion live (`lib/db/collections.ts:629-633`, `analytics/store.ts:36-104`); Intelligence renders nine metrics as "Atai does not collect events… yet" (`lib/intelligence/overview.ts:334-367`); Growth says the same (`growth-overview.ts:509-516`); no founder-facing reader exists; 90-day TTL with no rollups (`analytics/mapper.ts:20,146`).
**Why it matters.** The measurement promise is the hinge of "grow." Data collected today dies in 90 days having been seen only by the AI co-founder (consent-gated) and the app itself.
**User impact.** Founders are told their app's usage cannot be known while the rows sit in the database.
**Affected parts.** Intelligence, Growth, co-founder analytics tool, future recommendations/experiments.
**Consequence if unresolved.** Either the honest-copy brand breaks (copy is already factually wrong) or the data keeps expiring unseen — wasted pipeline and wasted trust.
**Solution direction.** Founder-facing summary reads + persisted daily rollups; fix Intelligence/Growth copy (D-03).

---

## C. The AI team has no memory and no hands

**Problem.** The flagship "co-founder" forgets every turn; nothing in the platform can act on a schedule.
**Evidence.** Agent prompt carries only the current message (`lib/cofounder/agent.ts:189-190`); transcript persisted but never replayed (`:222-225`); three conversation stores unreconciled (BUSINESS-DATA §6, D-05); no job substrate/cron/queue anywhere (`webhook-recovery.ts:41` self-declares it); campaigns/tasks explicitly inert (`lib/types/db.ts:895-900`).
**Why it matters.** "An AI team" implies continuity (it remembers, follows up, executes). One-shot turns + plan-only artifacts make it a stateless consultant with a checklist.
**User impact.** Founders repeat themselves; the co-founder cannot reference the previous message; "campaigns" never send anything and "tasks" never fire.
**Affected parts.** Co-founder agent, plan-chat vs agent behavior split, campaigns, tasks, any future scheduling (lessons digests, SEO re-audits, webhooks recovery).
**Consequence if unresolved.** The AI-team claim stays unmarketable, and the job-dependent roadmap phases stay blocked.
**Solution direction.** Replay bounded thread history in the agent turn (trivial, D-02); job substrate as the roadmap's Phase-0-class prerequisite (ROADMAP P0/P1).

---

## D. Money correctness: three pricing truths and an invisible cost model

**Problem.** The same build costs different credits depending on path; the standard credit valuation disagrees with pack pricing by up to 60%; provider cost is unmeasured on the dominant AI path.
**Evidence.** Manual/follow-up path charges `getBuildCost` (50k simple) vs automated `getTierCost(tier, "heavy")` (100k simple) vs pricing page "50,000 credits" (`app/api/projects/[id]/build/route.ts:76`, `lib/credits/credits.ts:44-83`, `lib/analysis/pipeline.ts:135`, `lib/projects/create-project.ts:120`, `app/pricing/page.tsx:329` — RUNTIME §5.3); pack-implied values 3,390–6,002 credits/$ vs the 3,750 anchor (`config.ts:274-278`, `credit-valuation.ts:100-155` — RUNTIME §5.2); OpenRouter costs flow through the platform key with free-model pins and mixed-currency aggregation (`admin/runtime/financials/route.ts:26-33` — RUNTIME R-04).
**Why it matters.** Credits are the product's currency; ambiguity here is a trust and refund generator.
**User impact.** New founders on the automated launch path are charged 2× the advertised simple-tier price without explanation.
**Affected parts.** launch/auto-build path, build route, pricing page, admin financials, margin modeling.
**Consequence if unresolved.** Every launch is a potential billing complaint; unit economics stay unmeasurable.
**Solution direction.** One pricing function for all paths; heavy multiplier either surfaced on the pricing page or retired; normalize provider cost to one currency or record it raw with an explicit policy (R-01, R-04).

---

## E. Lifecycle integrity: deletion is a lie

**Problem.** Deleting a project deletes 3 of ~23 linked collections, leaves runtime keys valid, and never touches the Totalum app.
**Evidence.** Cascade scope (`lib/store/mongo-store.ts:541-566`); no key revocation on delete and no project-liveness check at auth (`lib/runtime/auth/authenticate.ts:135-195`; grep: zero revocation call sites on delete); no Totalum project-delete call anywhere (`app/api/projects/[id]/route.ts:267-284`; `totalum/service.ts` exposes deletes only for domain/records/secrets).
**Why it matters.** "Permanently deletes" is user-facing copy; behind it, the app stays live, keys stay armed, and ~20 collections keep orphaned rows.
**User impact.** A founder who deletes a project keeps getting billed for its runtime calls and leaves a public app running.
**Affected parts.** Deletion transaction, runtime auth, provisioning, Totalum integration, data hygiene.
**Consequence if unresolved.** Zombie apps = ongoing charges + a public surface the founder believes is gone; orphan accumulation degrades every future query.
**Solution direction.** Extend the deletion transaction: revoke keys by projectId, cascade/null the linked collections, warn-or-delete on Totalum (D-01, S-02).

---

## F. Tenancy: one account, many founders, full-scope keys

**Problem.** Provisioned app keys carry every capability including `payments`, and Dodo reads execute with platform credentials against the account-wide feed.
**Evidence.** `PROVISIONED_KEY_SCOPES` = all routed capabilities (`provisioning/service.ts:83-85`); `listPayments`/`listPayouts` platform-credentialed and unfiltered by project (`dodo/client.ts:188-202`, `mapper.ts:279-327,416-420`); empty scope list = all capabilities for manual keys (`authorize.ts:29-32`).
**Why it matters.** One leaked app key exposes every Atai founder's customer payments (emails, amounts) — cross-tenant financial exposure.
**User impact.** Potentially every founder, via any other founder's leaked key.
**Affected parts.** Runtime contracts, Dodo adapter, provisioning scopes, key UI.
**Consequence if unresolved.** A single key leak is a platform-wide data incident.
**Solution direction.** Server-side `_ataiProjectId` filtering for project-context keys; narrow provisioned scopes; explicit scopes required for new manual keys (S-01, S-03).

---

## G. Copy that fabricates, copy that contradicts

**Problem.** Several user-facing strings assert things the code contradicts.
**Evidence.** Build narration claims "200 real users", "modeled unit economics", "war-gamed … every known competitor" (`lib/build-messages.ts:393,401,408`); competition module self-declares "no live market or competitor data anywhere" (`lib/marketing/competition-snapshot.ts:6-15`); Intelligence/Growth "not collected" copy vs live ingestion (§B above); dashboard renders "Soon" badges unconditionally on Grow items (`dashboard-shell.tsx:275-283`); admin console seeded with hardcoded credit claims (pre-MVP audit, still open).
**Why it matters.** The honesty positioning is Atai's stated differentiator (COMPETITIVE §4.4); each contradiction is a small betrayal of it, and the fabricated-claims narration is the worst of the set because it invents facts.
**User impact.** Founders believe events/competitions/economics were measured when they were not.
**Affected parts.** Build messaging, Intelligence, Growth, dashboard, admin.
**Consequence if unresolved.** Erodes the one brand attribute that costs nothing to keep.
**Solution direction.** Replace narration with the named-squads honest corpus (project precedent exists); fix the two "not collected" surfaces once data reads ship; gate "Soon" on a real flag.

---

## H. Founder data is not portable and partially perishable

**Problem.** Export returns core fields only; analytics expire after 90 days with no rollups; conversation history lives in three unreconciled stores.
**Evidence.** `export/route.ts:14-40` field list; TTL with no aggregation (`analytics/mapper.ts:20,146`); three-store table (BUSINESS-DATA §6).
**Why it matters.** As real business data accumulates, non-portability becomes a switching lock and a compliance-shaped risk; perishable analytics undermine "your data, your business."
**User impact.** Founders cannot take their history with them, and old analytics vanish.
**Affected parts.** Export route, analytics storage, collab-chat/cofounder stores.
**Consequence if unresolved.** Lock-in by accident, resentment on exit; future GDPR-class requests are unanswerable.
**Solution direction.** Full-project export bundle; daily rollups making history permanent; one thread abstraction (D-05, D-10).

---

## I. The grow pillar can plan but never act or learn

**Problem.** Campaigns and tasks are lists; nothing executes, nothing links, nothing feeds metrics; SEO findings never become tasks; content never attaches to campaigns.
**Evidence.** No execution tables, deferred pending substrate (`lib/types/db.ts:895-900`); no `campaignId` on content, no `auditId` on tasks, task completion feeds no metric (BUSINESS-DATA §7, D-09).
**Why it matters.** "Grow" currently produces documents, not outcomes.
**User impact.** Founders plan campaigns they must execute by hand elsewhere, with no measurement loop inside Atai.
**Affected parts.** Campaigns, tasks, content studio, SEO audits, growth overview.
**Consequence if unresolved.** The grow pillar stays decorative; retention relies on build/deploy alone.
**Solution direction.** Sequence after B (rollups) and C (job substrate): content→campaign links, task outcomes, scheduled executions with consent (ROADMAP P2).

---

## J. Engineering process cannot protect the money

**Problem.** No CI runs anywhere; the test suite is gitignored so a clean clone has zero tests; ESLint is broken (v9/legacy mismatch); error monitoring is stdout-only.
**Evidence.** `.gitignore` test patterns (VERIFIED); CI config deleted with `.github/` during git re-attachment (project memory; absent on disk); logging is console-JSON (`logging/logger.ts:60-66`); ~203 test files / ~2,400 passing cases existed locally 2026-11-08 (UNVERIFIED at audit time; not re-run).
**Why it matters.** The ledger, metering, and webhooks are the best-engineered parts of the repo and have nothing standing between them and a regression deploy.
**User impact.** Indirect: a billing regression ships silently.
**Affected parts.** Repo hygiene, deployment pipeline, ops.
**Consequence if unresolved.** Inevitable silent regression in exactly the code that must never regress.
**Solution direction.** Un-ignore tests, restore a minimal CI (typecheck + test + build), attach an error tracker (S-07, R-09).

---

## The ten biggest gaps, ranked

Ranking weighs promise impact × user harm × blast radius:

1. **S-01 — Cross-tenant payment-feed exposure** (F). One leaked app key reads every founder's customers' payments. Security, P0.
2. **S-02/D-01 — Deletion leaves live apps and armed keys** (E). Users get charged by apps they deleted. Trust + security, P0.
3. **A — No founder business substrate** (A). The promise's core object layer does not exist. Scope, P0-by-absence.
4. **D-02 — Co-founder has no memory** (C). The flagship AI fails its most basic expectation. One-file fix; P0-by-visibility.
5. **R-01 — Build pricing contradicts itself, automated path charges 2×** (D). Every launch risks a billing dispute. Trust, P0.
6. **D-03 — Analytics collected, unseen, expiring** (B). The measurement pipeline is built and wasted. P1.
7. **G — Fabricated build narration & contradicted copy** (G). Direct honesty violations. P1.
8. **R-04 — Provider cost unmeasured** (D). Margin and pricing truth impossible. P1.
9. **C — No job substrate** (C). Blocks recovery heartbeat, campaigns, scheduling, rollups. P1 (prerequisite).
10. **J — No CI, tests unshipped** (J). The strongest code is unprotected. P1.

Deliberately *not* in the top ten despite real severity: unthrottled routes (S-04, mitigated by credits+leases), export stub (H), marketing-islands (I) — all real, all lower than the ten above because they degrade rather than betray or endanger.

---

## One-paragraph summary for the founder

The codebase's money and infrastructure plumbing is genuinely excellent; its business data layer and AI continuity are genuinely absent; and three user-facing contradictions (pricing paths, "not collected" copy over live data, fabricated build narration) are actively spending the honesty reputation the product needs to justify the rest. Fix order: close the tenancy hole, make deletion true, make pricing single-truth, give the co-founder memory, ship the analytics the platform already collects — then build the founder-owned business objects that turn an app builder into the ecosystem the vision describes.
