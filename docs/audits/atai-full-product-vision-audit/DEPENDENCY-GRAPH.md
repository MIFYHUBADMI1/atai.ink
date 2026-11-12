# DEPENDENCY GRAPH & IMPLEMENTATION ORDER

**Assignment:** ATAI — Audit Findings Validation & Gap-Closure Planning (Task 3)
**Date:** 2026-11-09
**Basis:** validated findings (AUDIT-FINDINGS-VALIDATION) and root causes (ROOT-CAUSE-ANALYSIS). Ordering follows the brief's ten emphasis areas, in sequence: test reproducibility & CI → security & data integrity → business data foundation → AI business context & orchestration → reliable background execution → existing application generation & deployment (protect, don't rebuild) → business operations → financial data & reporting → marketing & growth → application intelligence.

**Ordering note:** the audit's earlier PRIORITIZED-IMPLEMENTATION-ROADMAP placed engineering guardrails at P1-3, *after* the trust fixes. The current brief explicitly puts test reproducibility and CI first; that reordering is deliberate and this document supersedes the old order. The fixes are unchanged — only the sequence.

---

## 1. Workstream nodes

| Node | Workstream | Fixes dissolved | Brief area | Reuses |
|---|---|---|---|---|
| W1 | Test reproducibility & CI — un-ignore tests, restore 3-gate CI, error tracker, artifact hygiene | J, S-07, R-09 | 1 | Existing 210-file suite + tracked `vitest.config.ts`; zero new code to write for the suite itself |
| W2 | Runtime tenancy — server-side project filter on money reads, narrowed provisioned scopes, explicit manual-key scopes | S-01, R-03 | 2 | Existing key metadata (`_ataiProjectId` stamp), existing scope model |
| W3 | Deletion truth — extend deletion transaction (revoke → cascade → Totalum warn-or-delete) + project-liveness check at runtime auth | S-02, D-01, D-07, D-12 | 2 | Existing delete route, existing key-revocation service, existing Totalum service methods |
| W4 | Pricing truth — one cost function for all paths; heavy multiplier surfaced or retired | R-01, UX-1 | 2 (money integrity) | Existing `getBuildCost`/`getTierCost` — converge, don't invent |
| W5 | Founder UX trust fixes — verification enforced server-side, mobile credit meter, flag-gated "Soon" | UX-2, UX-3, UX-4 | 2 (trust) | Existing session/verification plumbing |
| W6 | Business data foundation — founder-owned objects (customers, orders, revenue rollups) + ingestion from runtime attribution | gap A core | 3 | Existing runtime attribution stamps, existing analytics events, existing Mongo store patterns |
| W7 | AI business context & orchestration — thread replay (memory), context assembly (plan/economics/rollups), consent-gated built-app read tool | D-02, AI-gaps 1/3, D-04 | 4 | Existing transcript store (full history already returned), existing Totalum query API, existing cofounder tool registry |
| W8 | Background execution substrate — persisted jobs (status/attempts/lease) + trigger; **first consumer = webhook recovery heartbeat** | C, R-02, S-06, R-07 | 5 | Existing lease pattern (`ai-lease.ts`), existing recovery logic in `webhook-recovery.ts` (only the trigger is missing) |
| W9 | Generation & deployment protection — no rebuild; CI guards builds, deletion truth owns Totalum teardown, launch reconcile preserved | area 6 (protective) | 6 | Totalum integration is strong — nothing to build; only guard |
| W10 | Business operations — scheduled work on the substrate (campaign/task scheduling hooks, SEO re-audit scheduling) enabled by founder switches | part of I | 7 | Existing founder-owned feature switches (`/settings/features`), existing campaign/task schemas |
| W11 | Financial data & reporting — provider-cost normalization policy + margin reporting; per-project Dodo reconciliation report; export bundle | R-04, D-06, D-10 | 8 | Existing `runtime_usage` cost fields, existing admin financials aggregation, existing export route |
| W12 | Marketing & growth workflows — campaign↔content↔task links, task outcomes, execution on the substrate, measurement on rollups | D-09, I | 9 | Existing campaigns/tasks/studio UIs (well-built, just unlinked) |
| W13 | Application intelligence — founder-facing analytics reads (API+UI), daily rollups, corrected Intelligence/Growth copy, outcome feedback to the AI | D-03, B, AI-gap 7 | 10 | Existing ingestion pipeline end-to-end; rollups need W8; copy fix pairs with reads |
| W14 | Honest copy sweep — replace fabricated narration, re-label competition output | G, AI-gap 2 | cross | Existing named-squads corpus precedent |

## 2. Edges (why each dependency exists)

```
W1 ──→ everything        (no regression net exists; nothing ships unguarded)
W2 ──→ W6                (business objects inherit the tenancy rule — build objects after the rule)
W3 ──→ W9                (Totalum teardown defined by the deletion transaction)
W6 ──→ W7, W9, W11       (AI context, ops, financial reporting read the object layer)
W7 ──→ W12               (growth AI needs context/memory before it can advise on campaigns)
W8 ──→ W9, W10, W13-rollups, W12-execution
                          (every scheduled consumer waits for the substrate)
W13-reads ──→ W13-rollups→ W14-copy-pair (copy flips to truth only when reads exist)
W13-rollups ──→ W12-measurement, W13-outcome-feedback
W6 ──→ W11-reconciliation, W11-export-bundle
```

Explicit non-dependencies (can run in parallel): W4 ∥ W5 ∥ W14 ∥ W2 ∥ W3 once W1 lands; W7-memory needs nothing but W1.

## 3. The graph

```
                     ┌────────────────────────── PHASE 1 ──────────────────────────┐
                     │  W1  Test reproducibility & CI  (area 1)                     │
                     └──────┬───────────────────────────────────────────────────────┘
                            │
       ┌────────────────────┼──────────────────────┬───────────────────────┐
       ▼                    ▼                      ▼                       ▼
┌─ PHASE 2 ─────────┐ ┌─ PHASE 2 ────────┐ ┌─ PHASE 4 ────────┐ ┌─ PHASE 3 ─────────┐
│ W2 Tenancy (ar.2) │ │ W3 Deletion (2)  │ │ W7 AI context(4) │ │ W6 Biz data (3)   │
│ W4 Pricing (2)    │ │ W9 Protect (6)   │ │ W14 Copy (cross) │ │                   │
│ W5 UX trust (2)   │ │                  │ └──────┬───────────┘ └──────┬────────────┘
└───────────────────┘ └────────┬─────────┘        │                    │
                               │                  │                    │
                               ▼                  │          ┌─────────┴──────────┐
                     ┌─ PHASE 5 ──────────┐       │          ▼                    ▼
                     │ W8 Job substrate(5)│◀──────┘   PHASE 6 (parallel)   PHASE 7
                     │  heartbeat first   │           W10 Biz ops (7)      W11 Financial (8)
                     └──────┬─────────────┘           (needs W6+W8)       (needs W6; W8 for
                            │                                              scheduled recon)
              ┌─────────────┼──────────────────────────┐
              ▼             ▼                          ▼
        W13 rollups    W12 grow execution         W10 scheduled work
        (feeds 10)     (needs W7+W8+W13)          (needs W8 + founder switches)
              │
              ▼
      ┌─ PHASE 8 ─────────────────────────────────────────────────────┐
      │ W13 reads+copy (10) → W12 measurement → outcome feedback (10) │
      └───────────────────────────────────────────────────────────────┘
```

## 4. Topological order → the eight phases

| Phase | Brief area | Nodes | Gate to start | Meaningful UX when done |
|---|---|---|---|---|
| 1 | 1. Test reproducibility & CI | W1 | none | green badge on every push; regressions caught before deploy |
| 2 | 2. Security & data integrity | W2, W3, W4, W5, W9, W14 | W1 | cross-tenant hole closed; deletion tells the truth; one price everywhere; mobile shows credits; no fabricated narration |
| 3 | 3. Business data foundation | W6 | W1, W2 | the platform knows the founder's customers/orders/revenue as first-class data |
| 4 | 4. AI business context & orchestration | W7 | W1 (memory), W6 (context) | co-founder remembers, advises from real business + app data |
| 5 | 5. Reliable background execution | W8 (+heartbeat consumer) | W1 | webhook recovery self-heals; the substrate exists for everything scheduled |
| 6 | 7. Business operations | W10 | W6, W8 | scheduled growth work runs with consent under founder switches |
| 7 | 8. Financial data & reporting | W11 | W6, W8 | margins visible; per-project reconciliation; portable export |
| 8 | 9+10. Growth & intelligence | W12, W13 | W7, W8, W6 | analytics seen and permanent; campaigns linked, measured, executed; AI sees outcomes |

**Phase 2 is wide but shallow** — five workstreams, all quick, all independently shippable, all touching trust. Phase 3 and Phase 4 are the deep ones.

## 5. Why this order is the safest and most valuable

1. **The net comes first.** Every later change touches the money path or the lifecycle; W1 means every one of those changes lands under a green 2,499-case suite. Building P0 fixes before the net risks shipping them unverified.
2. **Integrity before features.** W2/W3/W4 close the only findings where users can be harmed or misled by *current* behaviour (cross-tenant reads, zombie apps, wrong prices). Nothing new is worth building while those stand.
3. **Foundation before intelligence.** W6 (business objects) is the root cause of the largest gap (A). Building Intelligence/Grow UI before it would produce more proxies — the exact pattern the audit condemns.
4. **Memory before scheduling.** W7's replay is trivial and independent, but its context assembly wants W6's objects; and W12's growth advice wants W7. Respecting this order prevents building advice on absent data.
5. **Substrate before consumers.** W8 exists once; the heartbeat, rollups, scheduled re-audits and campaign execution are its consumers. Building any consumer first would create a second throwaway trigger mechanism.
6. **Protect, don't rebuild, the builder.** Area 6 (application generation/deployment) is the strongest subsystem in the repo; W9 adds no code beyond what W3 requires. The audit explicitly rejects replacing Totalum.
7. **Reporting after objects.** W11's reconciliation and export want real business objects to report on; doing it earlier would mean reporting over proxies again.
8. **Growth last, intelligence on top.** W12/W13 are the promise's payoff but depend on objects, context, substrate and rollups; sequenced here they finally close the loop (act → measure → learn) that gap I describes as missing.

**Risk-adjusted note:** if founder priorities require a faster visible win, W5 (UX trust) and W14 (narration) can be pulled forward inside Phase 2 — they are the shortest paths to founder-perceivable improvement without violating any dependency.
