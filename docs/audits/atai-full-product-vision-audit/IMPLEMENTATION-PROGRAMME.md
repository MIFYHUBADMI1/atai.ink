# IMPLEMENTATION PROGRAMME

**Assignment:** ATAI — Audit Findings Validation & Gap-Closure Planning (Task 5)
**Date:** 2026-11-09
**Basis:** AUDIT-FINDINGS-VALIDATION (what still stands), ROOT-CAUSE-ANALYSIS (what to fix at the root), DEPENDENCY-GRAPH (order), WHAT-TO-BUILD-AND-WHAT-TO-AVOID (scope guard).
**Rule honoured throughout:** every phase ends with something the founder can *see or feel*, large phases are split into independently reviewable stages, and no phase silently changes architecture. **Nothing in this document has been implemented; execution starts only on explicit founder approval.**

---

## Phase 1 — The Engineering Net (Test Reproducibility & CI)

| Field | Content |
|---|---|
| **Business objective** | No change ships to the money path or lifecycle again without passing 2,499 verified tests; the repo is identical for every machine that clones it |
| **User problem** | Indirect but existential: a silent billing regression would ship today undetected; a fresh clone has zero tests, zero CI |
| **Audit findings addressed** | J, S-07, R-09 (consolidated workstream W1) |
| **Existing files/systems** | 210 test files (2,499 green, validated 2026-11-09), tracked `vitest.config.ts`, `package.json` scripts (`test`, `build`), `.gitignore` |
| **Backend changes** | None — repo hygiene only |
| **Frontend changes** | None |
| **DB implications** | None |
| **API implications** | None |
| **AI/integration implications** | None |
| **Security considerations** | `.env`/`.env.local` stay ignored and unopened; suite verified hermetic (no test reads real secrets) before tracking |
| **Testing requirements** | Restore test tracking (same commit as ignore-rule change); prove a no-env clean-clone run passes; artifact patterns added |
| **Dependencies** | None — first |
| **Risks** | CI build gate ~16 min locally → mitigate with cache + nightly full build option; 4 stray tracked log artifacts need founder approval to `git rm --cached` |
| **Acceptance criteria** | Clean clone → `npm install` → `npm test` green with no env files; every push runs typecheck+test+build; a deliberately broken commit fails the pipeline <30 min |
| **Definition of done** | ≥210 test files tracked in git; three gates green on `main`; zero stray artifacts tracked; REGRESSION-AND-CI-STRATEGY §3 guardrails all true |
| **Founder-perceivable improvement** | An honest, visible quality signal protecting every credit charged — the phase the founder's trust in all later phases rests on |

Full developer-ready detail: **PHASE-01-DETAILED-PLAN.md** (companion file).

---

## Phase 2 — Security & Trust Integrity

**Objective:** close every finding where current behaviour can harm or mislead a founder. Four independently reviewable stages.

### Stage 2A — Runtime tenancy (S-01, R-03)
| Field | Content |
|---|---|
| User problem | Any leaked generated-app key can read every Atai founder's customer payments |
| Findings | S-01, R-03 |
| Existing systems | Key metadata with project binding; `_ataiProjectId` attribution stamp; scope model |
| Backend | `mapper.ts`/`client.ts` (dodo adapter): enforce server-side `_ataiProjectId` filter for project-context keys; `provisioning/service.ts`: narrow `PROVISIONED_KEY_SCOPES` (drop `payments` from default set); `authorize.ts`: require explicit scopes for new manual keys |
| Frontend | Key UI displays effective scopes (small) |
| DB | None |
| API | Dodo list endpoints return project-scoped results; wider reads require admin/platform identity |
| AI/integration | Runtime contracts unchanged for the generated app's own data |
| Security | This *is* the security fix; verify empty-scope keys can't widen past their project |
| Testing | Adapter scoping tests (own-project visible, other-project 404/empty); provisioning scope regression tests; existing runtime suite green |
| Dependencies | Phase 1 |
| Risks | Generated apps legitimately reading own payments must keep working — verified by existing runtime tests before widening scopes |
| Acceptance | A project-context key querying payments sees only its project's records; provisioned keys no longer carry `payments` unless a founder grants it |
| DoD | Stages in CI; founder demo: leak simulation shows isolation |

### Stage 2B — Deletion truth (S-02, D-01, D-07, D-12)
| Field | Content |
|---|---|
| User problem | Deleted apps keep running and billing; ~20 collections keep orphans |
| Findings | S-02, D-01 (+D-07, D-12 folded) |
| Existing systems | Delete route + transaction; `revokeApiKey`; Totalum service methods; runtime auth |
| Backend | Extend deletion transaction: (1) revoke all runtime keys by projectId, (2) cascade/null every linked collection per an explicit per-collection policy, (3) call Totalum teardown or record an explicit "app remains live" state; add project-liveness check in `authenticate.ts` |
| Frontend | Delete confirmation states the app/keys outcome honestly |
| DB | Cascade scope widens from 2 → ~23 collections; each collection gets an explicit delete/null decision (review table in the stage PR — data-loss safe by review, not by default) |
| API | `DELETE /api/projects/[id]` performs the full transaction; runtime auth rejects keys of dead projects |
| AI/integration | Cofounder context for dead projects ends with the project |
| Security | Revocation on delete; liveness check kills zombie auth |
| Testing | Cascade-scope pin test (extend, don't just snapshot); auth-rejects-dead-project test; Totalum call mocked |
| Dependencies | Phase 1; independent of 2A (parallel-able) |
| Risks | Over-eager cascade deleting data a founder might want → mitigated by explicit per-collection review; Totalum teardown failure → record + retry via later substrate, never silently pretend |
| Acceptance | After delete: keys fail auth, Totalum app torn down (or founder-confirmed live state recorded), zero orphan rows in sampled collections |
| DoD | Stage tests green; founder walks one real (test) project through deletion |

### Stage 2C — One pricing truth (R-01, UX-1) — **contains a founder decision**
| Field | Content |
|---|---|
| User problem | Default automated launch charges 100k for the advertised 50k simple build |
| Findings | R-01, UX-1 |
| Existing systems | `getBuildCost` (flat), `getTierCost(tier,"heavy")` (×2), pricing page copy |
| Backend | One cost function in `lib/credits/credits.ts` consumed by build route, analysis pipeline, automated path; **founder decision:** (a) retire the heavy multiplier, or (b) keep it and surface it on the pricing page — recommendation: (b) for existing economics honesty, (a) for conversion simplicity |
| Frontend | Pricing page renders the same function's output; launch confirm shows the exact charge |
| DB | None |
| API | All three charge sites call one function |
| AI/integration | None |
| Security | N/A |
| Testing | Parity tests: manual, automated, analysis, and page all agree for every tier/mode |
| Dependencies | Phase 1 |
| Risks | Revenue per launch changes under option (a) — founder's call, not ours |
| Acceptance | A new founder on the default path is charged exactly what the pricing page states |
| DoD | Parity tests green; founder approves the multiplier decision |

### Stage 2D — Trust UX + honest copy (UX-2, UX-3, UX-4, G, AI-gap 2)
| Field | Content |
|---|---|
| User problem | Verification shown but not enforced while the reward is gated; mobile hides credits; working pages say "Soon"; narration fabricates facts |
| Findings | UX-2, UX-3, UX-4, gap G, AI-gap 2 |
| Existing systems | Session/verification plumbing; dashboard shell; named-squads corpus; feature-switch system |
| Backend | Server-side verification check gates the verified funnel + welcome bonus (session/`/api/me` exposes verification truthfully) |
| Frontend | Mobile credit meter exposure + responsive top-up; "Soon" chips flag-gated; `build-messages.ts` fabricated lines replaced with honest squads corpus; competition output re-labelled as modeled, not measured |
| DB | None |
| API | Session payload may gain `emailVerified` (server truth) |
| AI/integration | None |
| Security | Server-side enforcement (never trust client verify state) |
| Testing | Component tests: meter visible at mobile widths, "Soon" respects flag; route test: unverified session cannot claim bonus |
| Dependencies | Phase 1; copy pairing with 2C (pricing page consistency) |
| Risks | Enforcement could surprise unverified users → clear inline messaging at the verify step |
| Acceptance | Phone shows balance + top-up; unverified users cannot reach gated rewards without the server saying verified; no fabricated claim remains in build narration |
| DoD | All four surfaces demoed on mobile + desktop |

**Phase 2 UX payoff:** the founder sees one true price, keeps control of deletion, sees their credits on any device, and stops being told fiction.

---

## Phase 3 — Business Data Foundation (the ecosystem build)

| Field | Content |
|---|---|
| Business objective | The founder's *business* becomes first-class data: customers, orders, revenue rollups per project |
| User problem | "Revenue your app generates is invisible to Atai" — the platform has nothing for the founder the moment real customers appear |
| Findings | Gap A (core), enables W7/W9/W11 |
| Existing systems | Runtime attribution stamps (`adapter.ts:200`), analytics events, typed Mongo store patterns, founder feature switches |
| Backend | New founder-owned collections (customers, orders, revenue events) + ingestion: payments adapter stamps materialize as business objects; backfill from historical Dodo metadata; namespace strictly founder-scoped |
| Frontend | Founder-visible surface: finances page gains real customers/orders sections (cards, formatted⇄raw per data-UI conventions); honest empty states |
| DB | New collections + indexes on projectId; no changes to existing collections |
| API | Read endpoints for customers/orders/revenue per project; ingestion internal (adapter → store) |
| AI/integration | None yet — this phase builds what Phase 4 reads |
| Security | Tenancy rule from 2A governs every read; PII minimization in customer records |
| Testing | Store/ingestion tests; backfill idempotency test; read-route authorization tests |
| Dependencies | Phase 1, Stage 2A |
| Risks | Schema over-design → start with the three objects the audit names; historical metadata sparsity → backfill marks partials honestly |
| Acceptance | A payment made in a generated app appears as the founder's order/customer in Atai |
| DoD | Founder demo: real order visible in the finances surface |
| **UX payoff** | First time the platform shows the founder their actual business, not proxies |

---

## Phase 4 — AI Business Context & Orchestration

Three stages: **4A memory**, **4B context assembly**, **4C built-app read tool**.

| Field | 4A — Co-founder memory (D-02, AI-gap 1) | 4B — Context assembly (AI-gap 3) | 4C — Built-app read tool (D-04) |
|---|---|---|---|
| User problem | Co-founder forgets the previous message | Agent ignores finances/economics/plan detail | AI can't see the business records it advises on |
| Existing systems | Transcript store returns full history | Two disjoint context builders to unify | Totalum query API (`totalum/service.ts:198-246`) |
| Backend | Replay bounded thread window as messages in `agent.ts` turn | Single context builder: plan sections + economics + Phase-3 business objects + (consented) analytics summaries | New cofounder tool wrapping the existing Totalum service (read-only: tables, counts, recent records — no raw PII dumps) |
| Frontend | None (transcript UI already flat) | Optional "what the co-founder sees" disclosure | Tool renders as a named action in the existing worklog |
| DB | None | None | None (reads only) |
| API | None | None | New runtime/cofounder tool route if the registry requires it |
| AI/integration | Prompt assembly change only | Never-contradict rule for related sections (existing precedent) | Consent-gated per founder switch; respects `markdown-must-never-leak` rule at the edge |
| Security | Thread scoping per project; no cross-project replay | No new exposure (existing data, existing auth) | Consent gate + PII policy |
| Testing | Multi-turn agent test asserting prior-turn reference | Context-build snapshot test | Tool test: consent off → refuses; on → bounded summary |
| Dependencies | Phase 1 | Phase 3 (objects) + 4A | Phase 1 + founder switch |
| Risks | Long threads → token bloat → bounded window + compact mandate (existing FOLLOWUP_PROMPT_MAX precedent) | Context size → same bound | AI hallucinating over partial data → tool output labelled as record counts, not insights |
| Acceptance | Co-founder correctly references its previous turn; cites real order/revenue when asked about money; reads app records only when consented | | |
| DoD | Founder multi-turn demo on /collaborate | | |
| **UX payoff** | The "co-founder" finally behaves like one: remembers, knows the business, sees the app | | |

---

## Phase 5 — Reliable Background Execution (the substrate)

| Field | Content |
|---|---|
| Business objective | The platform can act on a schedule, reliably and observably |
| User problem | Failed billing webhooks wait for a human; "campaigns" and "tasks" can never fire; analytics will expire |
| Findings | C, R-02, S-06, R-07 (foundation); consumers later |
| Existing systems | Lease pattern (`lib/api/ai-lease.ts`), recovery logic in `webhook-recovery.ts`, internal-key auth (`lib/api/internal-key.ts`), admin recovery endpoint |
| Backend | Jobs collection (kind, status pending/running/done/failed, attempts, lease, runAt, payload, result) + claim/lease semantics + retry with backoff + a trigger (scheduled caller hitting an authenticated internal endpoint — reuse internal-key pattern; external cron is a deployment concern, not code) |
| Frontend | Admin jobs view (status, failures, retry buttons) |
| DB | One new collection + indexes on status/runAt |
| API | Internal trigger endpoint (authenticated); admin jobs endpoints |
| AI/integration | None in this phase — no consumers yet |
| Security | Trigger endpoint locked to internal key/secret; lease prevents duplicate execution |
| Testing | Job lifecycle tests (claim, retry, backoff, lease-expiry recovery); duplicate-claim test; heartbeat consumer test — recovery processes a failed webhook unattended |
| Dependencies | Phase 1; independent of 3/4 |
| Risks | Serverless execution windows → keep jobs short; idempotency → jobs carry idempotency keys like the ledger does; **no consumers built in this phase** (WHAT-TO-AVOID #5) |
| Acceptance | A failing webhook left overnight is recovered by the heartbeat with no human POST |
| DoD | Admin sees the job run; founder demo optional (ops-facing) |
| **UX payoff** | Money events self-heal; the "campaigns/tasks will actually do something" promise becomes buildable |

---

## Phase 6 — Business Operations on the Substrate

| Field | Content |
|---|---|
| Business objective | Scheduled growth work runs — with consent, under founder switches |
| User problem | Founders plan campaigns/re-audits that must be executed by hand elsewhere |
| Findings | I (execution half), part of gap C's promise |
| Existing systems | Substrate (Phase 5); founder-owned switches (`/settings/features`); campaigns/tasks schemas |
| Backend | Consumer jobs: SEO re-audit scheduling, lesson digests, scheduled campaign/task actions — each gated by its founder switch; task completion writes outcomes |
| Frontend | Scheduling controls inside existing grow pages (not new surfaces) |
| DB | `auditId`/`campaignId`/outcome fields on tasks (small additive migrations per existing pattern) |
| API | Schedule/cancel endpoints behind existing feature switches |
| AI/integration | Jobs may call cofounder tools — always via existing approval governance (pending actions) |
| Security | Founder switches enforced server-side; jobs scoped to project |
| Testing | Each consumer job: schedule → execute → outcome recorded; switch-off → job refuses |
| Dependencies | Phase 3, Phase 5 |
| Risks | Automated spend → every scheduled job either free or explicitly priced at schedule time (pre-spend disclosure, UX-8 principle) |
| Acceptance | A founder-scheduled re-audit runs on time and lands findings as tasks |
| DoD | Founder demo: one scheduled action executed end-to-end |
| **UX payoff** | Grow items do something on a schedule for the first time |

---

## Phase 7 — Financial Data & Reporting

| Field | Content |
|---|---|
| Business objective | Margins, reconciliation, and portability become computable from stored truth |
| User problem | Unit economics unmeasurable; founder payouts not reconcilable per project; data not portable |
| Findings | R-04, D-06 (report half), D-10 |
| Existing systems | `runtime_usage` cost fields; admin financials aggregation; export route; Phase-3 objects |
| Backend | Cost normalization: store raw cost+currency with one explicit policy (documented annotate-or-normalize decision); margin per capability in admin aggregation; per-project Dodo reconciliation report from existing metadata; export bundles linked collections |
| Frontend | Admin margin view; founder reconciliation panel; export button gain |
| DB | No schema change beyond annotating cost rows (additive) |
| API | `/api/admin/runtime/financials` gains margin series; export widens |
| AI/integration | None |
| Security | Admin-only surfaces; export authorization unchanged (owner-scoped) |
| Testing | Normalization property tests (fast-check, existing precedent); reconciliation report matches ledger rows; export completeness test |
| Dependencies | Phase 3 (+ Phase 5 for scheduled rollups if rollup persistence lands here) |
| Risks | Currency ambiguity → policy is explicit and documented, never silently summed (never-blend rule) |
| Acceptance | Admin sees margin per capability in one currency-or-annotated form; founder exports a complete project bundle |
| DoD | Founder downloads an export and opens the reconciliation report |
| **UX payoff** | The founder can finally see — and take — their numbers |

---

## Phase 8 — Growth Workflows & Application Intelligence

| Field | Content |
|---|---|
| Business objective | Close the loop: act → measure → learn. Campaigns link and execute; analytics is seen and permanent; the AI sees outcomes |
| User problem | Founders plan growth they must measure elsewhere; data dies unseen in 90 days; the AI can't say whether its advice worked |
| Findings | D-03, B, D-09, I (measurement half), AI-gap 7 |
| Existing systems | Rollup collection + substrate (Phase 5), business objects (Phase 3), Intelligence/Growth pages, cofounder context (Phase 4) |
| Backend | Nightly rollup job (substrate consumer); founder-facing summary reads API; `campaignId` on content + `auditId` on tasks (if not landed in Phase 6); campaign completion reads rollups; outcome feedback into cofounder context |
| Frontend | Intelligence/Growth render real metrics (replacing "not collected" copy — in the same PR as the reads); campaign pages show linked content/task outcomes |
| DB | Rollup collection (pre-populated from surviving events; older data honestly marked absent) |
| API | Founder analytics summaries; rollup reader |
| AI/integration | Cofounder context gains rollup-derived metrics; recommendations become evidence-based |
| Security | Owner-scoped reads; tenancy rule applies |
| Testing | Rollup math property tests; read authorization; copy-truth test (page renders metric when events exist) |
| Dependencies | Phase 3, 4, 5, 6 |
| Risks | First rollups thin → honest "history begins today" framing, never fabricated continuity |
| Acceptance | A founder sees yesterday's real events in Intelligence, older-than-90-days history preserved in rollups, and a campaign outcome attributed |
| DoD | Founder demo: the full loop — schedule, act, measure, ask the co-founder what worked |
| **UX payoff** | "Grow" and "improve" stop being documents: the measurement promise the product already makes becomes true |

---

## Cross-programme invariants

1. **Tests first:** every stage lands with its tests green in CI (Phase 1's net).
2. **No silent architecture change:** new collections are additive; existing ones only gain fields; deletions reviewed per-collection.
3. **Honesty preserved:** copy changes only when the capability behind them is true — reads and copy ship in the same PR.
4. **Founder switches respected:** all automated work remains behind `/settings/features`.
5. **Money paths keep their discipline:** idempotency, reversal identity, fail-closed metering untouched except where a finding requires a change — and then covered by parity tests.
6. **Windows reality:** `npx next build` (~16 min) remains the only prerender/RSC check; scheduled per stage-merge, not per commit.
