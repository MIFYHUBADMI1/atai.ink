# AUDIT FINDINGS VALIDATION

**Assignment:** ATAI — Audit Findings Validation & Gap-Closure Planning (Task 1)
**Validation date:** 2026-11-09 (same day as the audit)
**Method:** every P0/P1 finding re-verified by reading the cited source at its cited location on the current tree; P2/P3 spot-checked; duplicate findings consolidated; classifications per the assignment vocabulary.

---

## 1. Baseline: where the code is now

| Item | Value | How established |
|---|---|---|
| Branch | `main` | `git rev-parse --abbrev-ref HEAD` |
| HEAD | `e7cc3b330c3060904eb5574640e5b03b03d89f57` (2026-11-09 06:50:40 +0300) | `git rev-parse HEAD` |
| Commit the audit was written against | `e7cc3b3` | audit README scope section |
| Uncommitted working-tree files | 79 (lessons / ads / studio WIP) | `git status --porcelain` |
| Tests on current tree | 210 files, 2,499 tests, **all passing**, 409 s | full `vitest run` executed during validation |

**HEAD has not moved since the audit.** Every finding was therefore re-checked against the exact tree the audit described, plus the WIP overlay.

### 1.1 The uncommitted WIP — examined, preserved, no findings invalidated

Per the assignment rule ("never overwrite, discard or revert existing uncommitted work"), the WIP was inspected via `git diff e7cc3b3 -- lib/db/collections.ts lib/types/db.ts` — the only two shared files it touches — and nothing was modified:

- `lib/db/collections.ts` (+41 lines): three new lesson collections — `lesson_categories`, `learning_paths`, `user_lessons` — plus index setup. Additive; no existing collection renamed or dropped.
- `lib/types/db.ts` (+3 lines): `kitInput?: Record<string, string>` added to the ads-bench document type. Additive.

**Classification of the WIP:** additive lessons/ads feature work. It touches none of the areas any finding depends on (runtime auth, deletion transaction, credit paths, analytics pipeline, cofounder agent, Dodo adapter). **No finding is invalidated by the WIP.** The full test suite passing on this tree (2,499/2,499) additionally confirms the WIP does not break current behaviour.

---

## 2. Validation verdicts — every P0/P1

Status vocabulary: **Still valid** / **Already resolved** / **Partially resolved** / **No longer applicable** / **Requires additional verification** / **Incorrectly classified**.

### Security (SECURITY-AND-RELIABILITY-AUDIT §10)

| ID | Sev | Finding | Status | Re-verification evidence |
|---|---|---|---|---|
| S-01 | P0 | Provisioned `payments` scope + account-wide Dodo reads = cross-tenant financial read | **Still valid** | `lib/runtime/provisioning/service.ts:83-85` (PROVISIONED_KEY_SCOPES = all routed capabilities); `lib/runtime/router/adapters/dodo/client.ts:188-202` (platform-credentialed `listPayments`); `mapper.ts:279-327,416-420` (filters limited to limit/status/subscription/customer — no project filter) |
| S-02 | P0 | Deletion leaves valid runtime keys + live Totalum app | **Still valid** | `lib/store/mongo-store.ts:541-566` (cascade covers only build_runs + attachments); `lib/runtime/auth/authenticate.ts:135-195` (no project-liveness check); grep: zero revocation call sites on delete |
| S-03 | P1 | Empty-scope manual keys = all capabilities; dot-subsumption widens further | **Still valid** | `lib/runtime/auth/authorize.ts:29-32` (empty scopes ⊇ all) |
| S-04 | P1 | Unthrottled routes incl. AI-cost surfaces | **Still valid — count corrected** | Recount: 40/173 routes contain any limiter (`checkRateLimit|checkInternalLimit|checkAuthRequest|acquireAiLease`) → **133/173 unthrottled**, not 126/173 as printed. The correction makes the finding *worse*, not weaker. Zero-limiter AI-cost routes confirmed: `analyze-plan`, `auto-complete`, `plan-chat`, `resources/action-plan`, `market/ads-kit`, `generate-visual` |
| S-05 | P1 | No error tracking / uptime alerting | **Still valid** | `lib/logging/logger.ts` — console-JSON only; no tracker wiring anywhere |

### Runtime / billing (RUNTIME-BILLING-AND-INFRASTRUCTURE-AUDIT §9)

| ID | Sev | Finding | Status | Re-verification evidence |
|---|---|---|---|---|
| R-01 | P0 | Build pricing contradicts itself across paths; automated path charges 2× | **Still valid** | `app/api/projects/[id]/build/route.ts:76` (flat `getBuildCost`), `lib/analysis/pipeline.ts:135` (`getTierCost(tier,"heavy")`), `lib/credits/credits.ts:44-83` (heavy ×2), `app/pricing/page.tsx:329` ("50,000") — all three paths still disagree |
| R-02 | P0 | No scheduler exists anywhere in the money path | **Still valid** | `lib/billing/webhook-recovery.ts:41` self-declares no job substrate; grep `cron|bullmq|agenda|qstash` across package.json/lib/app still returns nothing; recovery remains admin-POST-only |
| R-03 | P1 | Provisioned keys carry full capability set; Dodo reads account-wide | **Still valid — DUPLICATE of S-01** | Same code as S-01. One underlying problem (tenancy scoping of payments reads + provisioned key scopes) described twice. Consolidate into a single fix |
| R-04 | P1 | Provider cost invisible on the dominant AI path | **Still valid** | `app/api/admin/runtime/financials/route.ts:26-33` (mixed-currency aggregation, "WHERE AVAILABLE" cost) |
| R-05 | P1 | "Lifetime hosting" vs Totalum infrastructure subscriptions | **Requires additional verification** | Unchanged from audit: deploy copy (`deploy/route.ts:20-27`) and `lib/types/project.ts:131-160` are confirmed in source, but the actual Totalum billing contract cannot be verified from the repository. Needs business confirmation of the Totalum agreement before severity can be finalised. Reclassified so it is never the sole basis for a P0 action |

### Business data (BUSINESS-DATA-AND-INTEGRATION-AUDIT §12)

| ID | Sev | Finding | Status | Re-verification evidence |
|---|---|---|---|---|
| D-01 | P0 | Deleting a project deletes neither the running app nor its credentials | **Still valid — DUPLICATE of S-02** | Same code as S-02. One deletion-truth problem; S-02 states the security angle, D-01 the data angle. Consolidate into a single fix |
| D-02 | P0 | The co-founder has no conversation memory | **Still valid** | `lib/cofounder/agent.ts:189-190` (prompt carries only the current message), `:222-225` (transcript persisted, never replayed) |
| D-03 | P1 | Analytics collected, 90-day-expiring, shown to no one who can act | **Still valid** | `lib/intelligence/overview.ts:334-367` and `lib/marketing/growth-overview.ts:509-516` still render "not collected" copy while `lib/db/collections.ts:629-633` + `analytics/store.ts` still ingest; TTL unchanged (`analytics/mapper.ts:20,146`) |
| D-04 | P1 | Built-app business records invisible to the AI | **Still valid** | No database tool in `lib/cofounder/tools/`; Totalum query API (`lib/integrations/totalum/service.ts:198-246`) still founder-routes only |
| D-05 | P1 | Three conversation stores, no unification | **Still valid** | collab-chat store, cofounder transcript, embedded `projects.conversation` — unchanged |
| D-06 | P1 | Founder revenue settles commingled, metadata-only attribution | **Still valid** | `mapper.ts:412-420`, `adapter.ts:200` |
| D-07 | P2 | ~20 collections can orphan on deletion | **Still valid** (fold into the S-02/D-01 fix) | §9.1 list unchanged |
| D-08 | P2 | `provider_usage` dead store | **Still valid** | Zero writers confirmed by grep; sole reader `app/api/me/avatar/route.ts:25` |
| D-09 | P2 | Marketing entities unlinked islands | **Still valid** | No `campaignId` on content, no `auditId` on tasks; `lib/types/db.ts:895-900` pending substrate still deferred |
| D-10 | P2 | Export is a stub | **Still valid** | `app/api/projects/[id]/export/route.ts:14-40` |
| D-11 | P3 | `users.isAdmin` is the whole permission model | **Still valid** | `lib/auth/session.ts:164-168` |
| D-12 | P3 | Social graph has no liveness policy | **Still valid** (UNVERIFIED against live data, as originally labelled) | `lib/types/db.ts:427-466` |

### AI team (AI-TEAM-AND-COFOUNDER-AUDIT §5.8)

| # | Sev | Finding | Status |
|---|---|---|---|
| 1 | P0 | No conversational memory | **Still valid — DUPLICATE of D-02** (same fix) |
| 2 | P0 | Ungrounded research presented as business intelligence | **Still valid** — `lib/marketing/competition-snapshot.ts:4-16` still self-declares "no live market or competitor data anywhere" while the UI presents it as a competitive briefing |
| 3 | P1 | Context fragmentation (two disjoint builders; finance/customers/analytics absent) | **Still valid** |
| 4 | P1 | Simulated team narration/progress | **Still valid** — `lib/build-messages.ts` lines ~393/401/408 still carry "200 real users", "modeled unit economics", "war-gamed" |
| 5 | P1 | No action audit or undo | **Still valid** |
| 6 | P1 | No specialist tool coverage (finance/sales/ops) | **Still valid** |
| 7 | P2 | No outcome feedback | **Still valid** |

### User experience (USER-EXPERIENCE-AND-JOURNEY-AUDIT §6.2)

| ID | Sev | Finding | Status | Re-verification evidence |
|---|---|---|---|---|
| UX-1 | P0 | Money story inconsistent at first spend | **Still valid — founder-facing symptom of R-01** | Same four citations re-read: `app/pricing/page.tsx:27,42,329`; `lib/projects/continue-start.ts:10` + `create-project.ts:120` (heavy default); `lib/analysis/pipeline.ts:135`; flat build path. Consolidate with R-01 |
| UX-2 | P0 | Email verification presented but not enforced, reward gated | **Still valid** | `components/auth/auth-panel.tsx:342` still calls `onAuthenticated(next)` from the verify view without enforcement |
| UX-3 | P0 | Mobile cannot see credits or top up | **Still valid** | `components/dashboard/dashboard-shell.tsx:163-165` — meter still `hidden lg:block`; top-up link still `xl+` |
| UX-4 | P1 | "Soon" badges on working pages | **Still valid** | `dashboard-shell.tsx:275-283` — unconditional (confirmed not flag-gated) |
| UX-5 | P1 | Workspace shell fragments at the core handoff | **Still valid** | collaborate/edit/source/environment/hosting siblings still render `AppHeader` |
| UX-6 | P1 | Onboarding skippable forever; checklist is dead code | **Still valid** | `components/onboarding-checklist.tsx` still has zero importers |
| UX-7 | P1 | Typed intent lost before signup (sessionStorage + auth-required POST) | **Still valid** | `app/api/start/pending/route.ts:25` still requires auth |
| UX-8 | P1 | Micro-spends have no visible price | **Still valid** | cost constants in `lib/billing/runtime-config.ts`; no confirmation UI found |
| UX-9 | P1 | No single "first outcome" path | **Still valid** | three CTA destinations unchanged |
| UX-10 | P1 | Plan review least scannable for the biggest spend | **Still valid** | plan page unchanged |

### Consolidated letter-gaps (CRITICAL-GAPS-AND-FINDINGS A–J)

A, B, C, D, E, F, G, H, I, J — **all Still valid**. Two notes: (1) J's test figures were UNVERIFIED at audit time and are now VERIFIED — 210 files / 2,499 passing cases measured during this validation (see REGRESSION-AND-CI-STRATEGY); (2) C's evidence is identical to R-02/S-06 — one substrate, one fix.

---

## 3. Summary of classifications

| Classification | Count | Findings |
|---|---|---|
| Still valid | 38 of 40 checked | everything except the two rows below |
| Still valid, corrected | 1 | S-04 (126→133/173 unthrottled; severity unchanged) |
| Requires additional verification | 1 | R-05 (Totalum contract is a business fact, not a repo fact) |
| Already resolved / Partially resolved / No longer applicable / Incorrectly classified | 0 | none |

**Duplicate findings describing one underlying problem** (per the assignment's instruction not to create separate tasks for symptoms solvable by one foundational change):

| One problem | Findings merged | One fix |
|---|---|---|
| Runtime tenancy / payments-read scoping | S-01 + R-03 | Server-side project filtering + narrowed provisioned scopes (one change in runtime auth/adapter/provisioning) |
| Deletion is not true | S-02 + D-01 (+ D-07, D-12 fold in) | One extended deletion transaction: revoke keys, cascade/null linked collections, Totalum warn-or-delete |
| Co-founder memory | D-02 + AI-gap-1 | One bounded thread replay in the agent turn |
| No job substrate | C + R-02 + S-06 + R-07 (+ GROW scheduling dependencies) | One foundational substrate; webhook heartbeat, campaign/task scheduling, rollups, SEO re-audits are all *consumers* of it, not separate builds |
| Pricing truth | R-01 + UX-1 (+ part of gap D) | One pricing function consumed by all paths; heavy multiplier surfaced or retired |
| Analytics collected-but-unseen | D-03 + gap B (+ part of AI-gap-7) | Founder-facing reads + daily rollups + corrected copy |
| Engineering cannot protect the money | J + S-07 (+ R-09) | Un-ignore tests + CI + error tracker (one workstream) |
| Unverified micro-items | UX-2 ↔ S-10 share one file (`auth-panel.tsx`) but are distinct behaviours (enforcement vs soft gate) — kept as separate fixes in one file touch | two small fixes, one file |

---

## 4. Working-tree preservation statement

No application file, test file, environment file, configuration file or database state was modified during validation. The only writes performed were the audit documents themselves under `docs/audits/atai-full-product-vision-audit/`. The 79-file WIP stands exactly as found; the two shared files it touches (`lib/db/collections.ts`, `lib/types/db.ts`) were read, not edited. Environment files were never opened.

**Validation is complete: the audit stands as written, with one numeric correction (S-04), one reclassification (R-05), and eight duplicate consolidations that shape the implementation programme.**
