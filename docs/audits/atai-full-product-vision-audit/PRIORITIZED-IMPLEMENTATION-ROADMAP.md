# PRIORITIZED IMPLEMENTATION ROADMAP

**Audit:** ATAI.INK Full Product Vision & Expectation-Gap Audit (Part 14 of 16)
**Date:** 2026-11-09
**Ordering rule:** dependency-correct, not size-ordered. Every item lists what it REUSES, what is NEW, what it DEPENDS ON, complexity (S/M/L), risks, and acceptance criteria with a concrete verification method. The brief's required ordering is honored: measurement before analytics surfaces, financial records before intelligence reads, approvals/audit trail before any autonomy expansion.

---

## P0 — Trust-critical fixes (each independently shippable; no wave-wide prerequisite)

### P0-1 · Close the cross-tenant payment reads (S-01)
- **Problem:** provisioned keys hold `payments` scope; Dodo reads are platform-credentialed and account-wide (`provisioning/service.ts:83-85`, `dodo/client.ts:188-202`, `mapper.ts:279-327`).
- **Outcome:** a project-scoped key can only read payments attributed to its own project.
- **Reuse:** the `_ataiProjectId` stamp already written at checkout (`dodo/adapter.ts:200`).
- **New:** server-side metadata filter injected for project-context auth; payments scope narrowed or split in `PROVISIONED_KEY_SCOPES`.
- **Depends on:** nothing. · **Complexity:** S–M. · **Risk:** Dodo API may not filter on metadata — verify; fallback is post-fetch filtering + `pageFull` guard.
- **Acceptance:** a key from project A cannot retrieve project B's payment rows; payouts endpoint requires non-project context or admin surface.
- **Verify:** integration test against Dodo test env listing with two projects' keys; code review of filter injection point.

### P0-2 · Make deletion true (D-01 / S-02)
- **Problem:** deletion cascades 3 collections, leaves keys armed, leaves the Totalum app live (`mongo-store.ts:541-566`, `authenticate.ts:135-195`, zero Totalum-delete call sites).
- **Outcome:** deleting a project revokes its runtime keys, removes/nulls linked rows, and either deletes the Totalum project or requires explicit confirmation that the deployed app will be torn down separately.
- **Reuse:** existing transaction; `revokeApiKey` by projectId query; collection list from BUSINESS-DATA §9.1.
- **New:** Totalum teardown call or confirmed-warning flow; orphan sweep deferred to P1-1.
- **Depends on:** nothing. · **Complexity:** M. · **Risk:** Totalum may lack a project-delete API (UNVERIFIED) — ship the warning flow first regardless.
- **Acceptance:** post-delete: key auth fails 401; no founder-chargeable calls succeed; UI states the app's fate.
- **Verify:** unit test on the deletion transaction; manual check that a deleted project's key returns `runtime_error_invalid_api_key`.

### P0-3 · One pricing truth (R-01)
- **Problem:** `autoLaunchBuild` charges heavy-scaled `getTierCost` while the manual path and pricing page say `BUILD_TIERS` (50k simple) (`pipeline.ts:135`, `build/route.ts:76`, `pricing/page.tsx:329`).
- **Outcome:** one function is the only price source; the pricing page displays exactly what every path charges; heavy mode either retires or is a visible founder choice.
- **Reuse:** `runtime-config.ts` admin overrides (already one store).
- **New:** call-site unification only; no new system.
- **Depends on:** nothing. · **Complexity:** S. · **Risk:** founder-facing "heavy" positioning decision is a product call, not code.
- **Acceptance:** identical credit amounts for the same tier across launch route, build route, follow-ups, and the pricing page copy.
- **Verify:** grep for remaining `getBuildCost`/`getTierCost` split; end-to-end: complete a plan, launch, compare ledger amount to page copy.

### P0-4 · Give the co-founder memory (D-02)
- **Problem:** the agent receives only the current message (`agent.ts:189-190`); transcript persisted but never replayed (`:222-225`).
- **Outcome:** multi-turn conversations hold context.
- **Reuse:** `getProjectChat`/`getLatestProjectChat` already return full history (`collab-chat/store.ts`).
- **New:** bounded replay (e.g. last 12 turns) assembled as messages in `runAgentTurn`; cap tokens.
- **Depends on:** nothing. · **Complexity:** S. · **Risk:** longer prompts on a free-tier model → slower turns; mitigate with history cap + existing 240s timeout.
- **Acceptance:** a two-turn conversation ("my app is X" → "what did I say my app is?") answers correctly.
- **Verify:** scripted two-turn call against the dev model pin; manual conversation in the panel.

### P0-5 · Stop fabricating facts in build narration (G)
- **Problem:** "200 real users", "modeled unit economics", "war-gamed competitors" invented by copy (`build-messages.ts:393,401,408`) while `competition-snapshot.ts:6-15` declares no live data.
- **Outcome:** narration matches the named-squads honest corpus already in the codebase (project precedent).
- **Reuse:** existing squads copy corpus; the notInstrumented vocabulary.
- **Depends on:** nothing. · **Complexity:** S.
- **Acceptance:** no build message asserts a measured outcome that no measurement path produced.
- **Verify:** grep the narration corpus for claim verbs (users/economics/war-game) and read each remaining line.

---

## P1 — Operational truth (requires P0 stable; internal order below)

### P1-1 · Job substrate + recovery heartbeat (R-02 / S-06 / C)
- **Problem:** nothing self-fires; webhook recovery is admin-POST-only (`webhook-recovery.ts:41`, sole caller grep).
- **Outcome:** a `jobs` collection + claim-loop entrypoint + 5-minute external cron; first jobs: webhook recovery, stale-build sweep, orphan sweep.
- **Reuse:** the recovery worker's claim/lease/budget pattern verbatim (`webhook-recovery.ts:20-46`) — it is the reference implementation.
- **Depends on:** P0-2 (so orphan sweep has defined cascade targets). · **Complexity:** M. · **Risk:** double-execution — mitigated by reusing the atomic claim vocabulary.
- **Acceptance:** a failed webhook event processed without any human POST within 10 minutes of failure; cron auth fails closed.
- **Verify:** inject a `failed` event in staging, confirm state transition via the cron path alone.

### P1-2 · Analytics rollups + founder reads (D-03 / B-gap)
- **Problem:** events expire in 90 days unseen; Intelligence/Growth copy says "not collected" (`analytics/mapper.ts:20,146`, `intelligence/overview.ts:334`, `growth-overview.ts:509`).
- **Outcome:** daily rollup rows (permanent), founder-facing summary API + Intelligence/Growth sections reading real data with the existing honesty labels; copy corrected.
- **Reuse:** `computeSummary` aggregation (`analytics/store.ts:36-104`), `notInstrumented` metric pattern, consent gate.
- **Depends on:** P1-1 (schedules the rollup); a run-on-read backfill is the acceptable interim.
- **Complexity:** M. · **Risk:** first 90 days show partial history — disclose.
- **Acceptance:** Intelligence appEvents/activeUsers display measured numbers once an app reports via `atai.analytics`; rollups survive event TTL expiry.
- **Verify:** send a test event through the runtime, view Intelligence, delete the raw event, confirm the rollup row remains.

### P1-3 · Money-path engineering guardrails (J / S-07 / R-09)
- **Problem:** no CI; tests gitignored; stdout-only logging (`git ls-files`).
- **Outcome:** tests tracked + minimal CI (typecheck → vitest → `next build`); error tracker attached.
- **Depends on:** nothing. · **Complexity:** S–M. · **Risk:** 16-minute Windows builds in CI — use a Linux runner; keep local build verification ritual.
- **Acceptance:** a pull request that breaks the ledger tests cannot merge; an unhandled server exception appears in the tracker.
- **Verify:** push a deliberately failing test on a branch; confirm CI red.

### P1-4 · Provider-cost truth (R-04)
- **Problem:** OpenRouter costs invisible on the dominant AI path; admin financials sum mixed currencies (`admin/runtime/financials/route.ts:26-33`).
- **Outcome:** one recorded cost policy (normalized currency or raw+explicit), margin visible per capability.
- **Reuse:** `runtime_usage` cost fields + pricing snapshots.
- **Depends on:** nothing. · **Complexity:** M. · **Risk:** no FX source — record raw with currency, never convert silently (aligns with the never-blend rule).
- **Acceptance:** admin financials never add USD to EUR; per-capability margin computable from stored data.
- **Verify:** aggregate query returns per-currency columns; spot-check one OpenRouter usage row's cost field.

---

## P2 — Business substrate (the ecosystem build; requires P1-2)

### P2-1 · Founder business objects
- **Problem:** no customers/orders/revenue objects exist anywhere (BUSINESS-DATA §3).
- **Outcome:** `customers`, `orders`, `revenue_rollups`, `payout_ledger` collections + `lib/business/` service; seeded from (a) runtime payment attribution, (b) analytics events, (c) manual founder entry.
- **Reuse:** `_ataiProjectId` attribution, rollups from P1-2, project-scoped store patterns.
- **Depends on:** P1-1, P1-2. · **Complexity:** L. · **Risk:** privacy — customer PII needs a consent + retention policy before any import; manual-entry-first keeps it honest.
- **Acceptance:** a founder can see a customer list and per-customer revenue attributed from real payment metadata; no fabricated rows.
- **Verify:** create a test payment via the runtime payments capability in staging; confirm the customer/order rows and finance joins.

### P2-2 · Co-founder reads over business + app data (D-04)
- **Problem:** the AI cannot see customers (none exist) or built-app records (no tool).
- **Outcome:** consent-gated read tools: business summary (L4) and Totalum database summary (tables/counts/recent — no raw PII dumps), reusing `queryDatabase` (`totalum/service.ts:203`).
- **Reuse:** consent triple-gate pattern (`cofounder/tools/analytics.ts:34-62`).
- **Depends on:** P2-1 for business reads; database tool independent.
- **Complexity:** M. · **Risk:** prompt-injection via record content — keep reads summarized and fenced.
- **Acceptance:** with consent, the co-founder can state table counts and recent activity; without consent, CONSENT_REQUIRED.
- **Verify:** toggle consent on/off; check tool output shape and the fenced prompt in logs.

### P2-3 · Data lifecycle completion (D-07/D-10/H)
- **Outcome:** deletion cascade covers all linked collections (P0-2 scope extension), full export bundle, conversation-store unification plan.
- **Depends on:** P0-2, P1-1 (sweep job). · **Complexity:** M.
- **Acceptance:** export contains chats, campaigns, tasks, analytics rollups, finances summary; zero orphaned rows after a delete.
- **Verify:** round-trip export on a populated test project; orphan-count queries return zero.

---

## P3 — Grow execution (requires P1-2 + P2-1 + P1-1)

- **P3-1 · Link the islands (D-09):** `campaignId` on content items, `auditId`-derived SEO tasks, task outcomes read from rollups. · Complexity S–M.
- **P3-2 · Scheduled execution with consent:** campaigns/tasks gain execution rows run by the job substrate (email via runtime capability only with founder consent; social/posting stays out until per-platform approvals exist). · Complexity L. **Approval-before-autonomy is the ordering rule** — the pending-action ladder is the only execution path until it is extended with scheduled-approval records.
- **P3-3 · Honest grow metrics:** completedPayments/siteVisitors/conversion become measured via attribution + rollups instead of `notInstrumented`. · Depends on P2-1.
- **Acceptance (wave):** a campaign can reference its content, its scheduled sends appear as pending-action-style records with consent state, and its outcome numbers are rollup-derived.
- **Verify:** staging campaign with one scheduled email; confirm consent gate, execution row, and outcome read.

---

## P4 — Scale items (explicitly deferred)

- Multi-instance cache strategy (in-process caches assume one instance).
- Team/roles beyond `isAdmin` (D-11).
- Founder payout rails (connected accounts) — decision, not code, until volume justifies it (R-05/D-06).
- Routed `auth`/`storage` capabilities or their removal from contracts.

---

## Dependency graph (condensed)

```
P0-1 · P0-2 · P0-3 · P0-4 · P0-5      (independent fixes)
          │
      P1-3 (CI)          P1-1 (jobs) ── P1-2 (rollups+reads) ── P1-4 (cost truth)
                          │                    │
                          │              P2-1 (substrate) ── P2-2 (AI reads)
                          │                    │
                     P2-3 (lifecycle)    P3 wave (grow execution)
```

Total honest estimate: P0 is days; P1 is one to two weeks of focused work; P2 is the first genuinely large build; P3 is gated on its predecessors and on consent design. Nothing in this roadmap requires replacing an existing subsystem — the two new constructs are the job substrate (pattern already proven in-repo) and the business-object layer.
