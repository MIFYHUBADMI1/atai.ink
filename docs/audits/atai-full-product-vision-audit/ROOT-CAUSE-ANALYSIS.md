# ROOT-CAUSE ANALYSIS

**Assignment:** ATAI — Audit Findings Validation & Gap-Closure Planning (Task 2)
**Date:** 2026-11-09
**Method:** for every major gap, decompose the failure by layer — missing *data*, missing *API*, missing *frontend*, missing *orchestration*, missing *permissions*, missing *job substrate* — then name the single root cause and the smallest foundational change that fixes the whole class (so the programme builds foundations, not symptom patches). Evidence in AUDIT-FINDINGS-VALIDATION; findings merged per its duplicate table.

---

## Gap 1 — Cross-tenant payment exposure (S-01 + R-03)

| Layer | Status | Detail |
|---|---|---|
| Data | **Present** | Keys already carry a project binding; payments already carry `_ataiProjectId` metadata (attribution stamp, `adapter.ts:200`) |
| API | **Partially missing** | Dodo `listPayments`/`listPayouts` accept no project filter (`client.ts:188-202`, `mapper.ts:279-327`) |
| Permissions | **Missing** | No server-side enforcement that a project-context key only reads its own project's money |
| Frontend | Present | Key UI exists |

**Root cause:** tenancy is enforced nowhere between the key and the adapter. Scopes are granted too broadly at provisioning (`service.ts:83-85`), and the Dodo read path trusts the caller instead of filtering by the key's project.
**Smallest foundational change:** one server-side rule — *adapter-level project filter for project-context keys* + narrowed `PROVISIONED_KEY_SCOPES` + explicit scopes required for new manual keys. Fixes S-01, R-03, and future-proofs every new adapter.

## Gap 2 — Deletion is not true (S-02 + D-01, folding D-07/D-12)

| Layer | Status | Detail |
|---|---|---|
| Data | **Missing** | Cascade covers 2 of ~23 collections (`mongo-store.ts:541-566`) |
| API | **Present but incomplete** | Delete route exists; lacks revocation + Totalum teardown steps |
| Permissions | **Missing** | Runtime auth never checks project liveness (`authenticate.ts:135-195`) — the safety net that should make stale keys dead |
| Orchestration | **Missing** | No compensating action toward Totalum (no delete call anywhere) |

**Root cause:** deletion was implemented as a Mongo-row operation when the real object is a *system* (rows + armed credentials + a live Totalum app). The auth layer's missing liveness check is the second half of the same hole.
**Smallest foundational change:** extend the one deletion transaction (revoke keys by projectId → cascade/null linked collections → Totalum warn-or-delete) and add a project-liveness check at runtime auth. One transaction + one auth condition closes S-02, D-01, D-07, D-12.

## Gap 3 — No founder business substrate (gap A)

| Layer | Status | Detail |
|---|---|---|
| Data | **Missing entirely** | No customers/orders/revenue collections (49-collection inventory) |
| API | **Missing** (nothing to expose) | — |
| Frontend | **Misleading, not missing** | Finances/Intelligence render proxies and honest disclaimers |
| Ingestion | **Partial** | Runtime attribution stamps exist; analytics events exist; nothing assembles them into business objects |

**Root cause:** the product grew capability-by-capability around Atai's own operations; nobody ever defined *the founder's business* as a data model. Everything downstream (Intelligence, Growth, AI advice, payouts reporting) is starved from this single absence.
**Smallest foundational change:** define the founder-owned object layer (customers, orders, revenue rollups) once, fed by runtime attribution — then every consumer is a *reader* of one foundation instead of a new build.

## Gap 4 — Co-founder has no memory (D-02 + AI-gap-1)

| Layer | Status | Detail |
|---|---|---|
| Data | **Present** | Transcript persisted; store returns full history (`lib/collab-chat/store.ts`) |
| API | **Present** | Chat routes exist |
| Orchestration | **Missing** | Agent prompt carries only the current message (`agent.ts:189-190`); replay never invoked (`:222-225`) |
| Frontend | Present | Flat transcript UI exists |

**Root cause:** orchestration gap, not infrastructure. The memory was built; the agent never reads it.
**Smallest foundational change:** replay a bounded thread window as messages in the agent turn. One-file-class fix that also unblocks AI-gap-3 (context assembly) — the same assembly point gains plan/economics context later.

## Gap 5 — Pricing contradicts itself (R-01 + UX-1, part of gap D)

| Layer | Status | Detail |
|---|---|---|
| Data/calculation | **Divergent, not missing** | Three cost sources: `getBuildCost` (50k), `getTierCost(tier,"heavy")` (100k), pricing-page copy (50k) |
| API | Present | Each path charges correctly *per its own function* |
| Frontend | Present but contradicts | Pricing page advertises the flat number |
| Permissions | N/A | — |

**Root cause:** no single pricing truth. Each path grew its own cost expression; the default path (`continue-start.ts:10` heavy mode) silently selects the expensive one.
**Smallest foundational change:** one pricing function consumed by manual build, automated build, analysis, and pricing page; heavy multiplier either surfaced on the pricing page or retired. Calculation problem — no schema change required.

## Gap 6 — Analytics collected but unseen and expiring (D-03 + gap B)

| Layer | Status | Detail |
|---|---|---|
| Data | **Present** | Ingestion live (`collections.ts:629-633`, `analytics/store.ts`) |
| Persistence | **Missing** | 90-day TTL, no rollups (`analytics/mapper.ts:20,146`) |
| API | **Missing** | No founder-facing reader |
| Frontend | **Contradicted** | Intelligence/Growth say "not collected" (`overview.ts:334-367`, `growth-overview.ts:509-516`) |
| Job substrate | **Missing** | Rollups need scheduled execution |

**Root cause:** the pipeline was built up to storage and stopped; reads, rollups, and copy were never wired to the data that already exists. Three sub-causes with different owners: (a) missing API+frontend reads (quick), (b) missing rollup persistence (needs substrate), (c) stale copy (trivial, but only *after* reads exist or the lie flips direction).
**Smallest foundational change:** daily rollup collection + founder-facing summary reads; fix copy in the same PR as the reads.

## Gap 7 — No job substrate (C + R-02 + S-06 + R-07 + I scheduling)

| Layer | Status | Detail |
|---|---|---|
| Persistence | **Missing** | No jobs collection, no status, no attempts field anywhere |
| Execution | **Missing** | No cron/queue/worker (`webhook-recovery.ts:41` self-declares); long ops run in-request (`agent.ts:14` 240s, `totalum/service.ts:176` 60s) |
| Retry semantics | **Missing** | Recovery is lease-based but triggered only by manual admin POST |
| Status observability | **Missing** | No admin view of pending/failed work beyond webhook recovery |

**Root cause:** nothing persists *intent to do work later*. Every downstream symptom — webhook heartbeat (S-06/R-02), campaign/task scheduling (I), analytics rollups (gap 6), SEO re-audits, lessons digests — is a consumer of this one missing foundation.
**Smallest foundational change:** one jobs abstraction (persisted job records with status/attempts/lease + a trigger). Per project record, deployment target options exist; the substrate itself, not any consumer, is the deliverable. **Do not build the consumers in the same phase.**

## Gap 8 — Provider cost invisible (R-04, part of gap D)

| Layer | Status | Detail |
|---|---|---|
| Data | **Partial** | `runtime_usage` stores provider cost "WHERE AVAILABLE" (`admin/runtime/financials/route.ts:26-33`) |
| Calculation | **Missing** | Mixed currencies summed without conversion; OpenRouter-path cost depends on provider reporting |
| Frontend | **Missing** | No margin view derivable from what's stored |

**Root cause:** transaction *records* exist but are incomplete and unnormalized — a capture + policy gap, not a schema gap.
**Smallest foundational change:** record raw cost + currency with an explicit normalization policy (or FX rate), then compute margin per capability in admin financials.

## Gap 9 — Copy that fabricates or contradicts (gap G)

| Layer | Status | Detail |
|---|---|---|
| Frontend copy | **Wrong** | `build-messages.ts:393,401,408` fabricates; `dashboard-shell.tsx:275-283` "Soon" unconditional; `competition-snapshot.ts:6-15` presents invention as briefing |
| Data/flag | **Missing** | No feature-flag gate behind "Soon" |
| Orchestration | Present | Honest-corpus precedent exists (named squads) |

**Root cause:** copy written ahead of capability and never reconciled; the honesty brand is violated by strings, not by architecture.
**Smallest foundational change:** replace fabricated narration with the existing honest corpus; gate "Soon" on a real flag; re-label competition output. String-level fixes — cheap, high brand value, sequenced after reads so Intelligence/Growth copy flips to truth in the same wave.

## Gap 10 — Grow pillar can plan but never act (I + D-09)

| Layer | Status | Detail |
|---|---|---|
| Data | **Missing links** | No `campaignId` on content, no `auditId` on tasks, no outcome fields (`lib/types/db.ts:895-900`) |
| Job substrate | **Missing** | Execution requires gap 7 |
| Metrics | **Dependent** | Measurement loop requires gap 6 rollups |
| Frontend | Present | Campaigns/tasks/studio UIs exist and are well-built |

**Root cause:** grow modules were built as *documents* (plans) with no linkage and no actuator. The missing pieces are one link field each plus the substrate and rollups — UI is NOT the bottleneck.
**Smallest foundational change:** add the two link fields + task outcomes, then attach execution to the substrate and measurement to the rollups. Strictly sequenced after gaps 6 and 7.

## Gap 11 — Portability & conversation unification (H + D-05 + D-10)

| Layer | Status | Detail |
|---|---|---|
| Data | Present | All three conversation stores have real data; exportable fields exist |
| API | **Stub** | `export/route.ts:14-40` returns core fields only |
| Abstraction | **Missing** | No one thread abstraction across three stores |

**Root cause:** accretion — three chat surfaces grew at three times; export was written for the happy path only.
**Smallest foundational change:** one thread abstraction (embedded legacy stays read-only) + export bundles the linked collections. No urgency driver beyond compliance-shaped risk; sequenced late.

## Gap 12 — UX P0 trust breaks (UX-2, UX-3, UX-4)

| Finding | Missing layer | Root cause | Fix shape |
|---|---|---|---|
| UX-2 verification not enforced, reward gated | **Permission (server-side)** | Client decides when verification succeeded (`auth-panel.tsx:342`); server never re-checks before granting the funnel | Enforce server-side; gate welcome credits on verified email |
| UX-3 mobile can't see credits/top up | **Frontend** | Meter wrapper `hidden lg:block` (`dashboard-shell.tsx:163-165`) | Responsive exposure; trivial |
| UX-4 "Soon" badges on working pages | **Frontend + flag** | Unconditional chip (`dashboard-shell.tsx:275-283`) | Gate on real flags (pairs with gap 9) |

**Root cause (common):** UI states written from assumptions instead of server truth. Pattern repeats across UX-2/4 and gap 9.

## Gap 13 — Engineering cannot protect the money (J + S-07 + R-09)

| Layer | Status |
|---|---|
| Tests | **Present, unshipped** (210 files / 2,499 green — REGRESSION-AND-CI-STRATEGY) |
| CI | **Missing entirely** (`.github/` deleted) |
| Error tracking | **Missing** (stdout-only, `logger.ts:60-66`) |
| Lint | **Broken** (v9/legacy mismatch) |

**Root cause:** repo rebuild dropped CI config and the tests were never re-tracked; the suite survived only on one machine.
**Smallest foundational change:** un-ignore tests + three-gate CI (typecheck → vitest → build) + an error tracker. Everything else in the programme depends on this net existing first.

---

## Root-cause classes across all gaps

| Class | Gaps | Implication |
|---|---|---|
| **Missing data model** | 3 (substrate), partially 10 (links) | Build once, define the founder-business objects; do not hand-roll per feature |
| **Missing orchestration only** (data exists) | 4 (memory), 6a (reads exist as data) | Cheapest class — wire what exists |
| **Missing permissions/enforcement** | 1 (tenancy), 2b (liveness), UX-2 | Server-side truth rules; never trust caller/context assumptions |
| **Missing calculation/single-source** | 5 (pricing), 8 (cost normalization) | One function/one policy; no schema change |
| **Missing job substrate** | 7, 6b (rollups), 10 (execution), S-06/R-02 | One foundation; all consumers wait for it |
| **Missing shipping/engineering infra** | 13, part of every phase | Prerequisite for all |
| **Copy/assumption drift** | 9, UX-4, UX-2's presentation half | String + flag fixes; pair each with the capability change that makes it true |

**Reading of the table:** six of thirteen gaps are foundations (substrate, tenancy rule, deletion transaction, pricing function, CI net, rollup store) whose completion dissolves the remaining symptoms. That is the shape of the implementation programme.
