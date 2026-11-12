# WHAT TO BUILD AND WHAT TO AVOID

**Assignment:** ATAI — Audit Findings Validation & Gap-Closure Planning (Task 4)
**Date:** 2026-11-09
**Basis:** validated findings + root causes. This document is the anti-scope-creep guard for the implementation programme: every "build" below is justified by a validated finding; every "avoid" is justified by an existing, verified asset.

---

## 1. BUILD — the foundations (each dissolves a whole class)

| Build | Dissolves | Why it must be built |
|---|---|---|
| Three-gate CI + un-shipped tests | J, S-07, R-09 | 2,499 passing cases exist but protect nothing; one regression deploy away from a billing incident |
| Server-side tenancy rule on money reads + narrowed provisioned scopes | S-01, R-03 | the only finding where one leaked key is a platform-wide incident |
| Extended deletion transaction + runtime liveness check | S-02, D-01, D-07, D-12 | users get billed by apps they deleted; a public surface the founder believes is gone |
| One pricing function for all paths | R-01, UX-1 | every automated launch charges 2× the advertised price |
| Founder-owned business objects (customers, orders, revenue rollups) | gap A | the promise's core object layer does not exist; everything "run/grow" reasons over proxies |
| Job substrate (persisted jobs: status/attempts/lease + trigger) | C, R-02, S-06, R-07 | nothing can act on a schedule; webhook recovery waits for a human |
| Analytics daily rollups + founder-facing reads | D-03, B | data is collected, unseen, and dies in 90 days |
| AI thread replay + context assembly + consent-gated built-app read tool | D-02, AI-gaps 1/3, D-04 | the flagship agent forgets every turn and can't see the business it advises on |
| Provider-cost normalization policy + margin reporting | R-04 | unit economics unmeasurable; heavy multipliers are guesswork |
| Campaign/content/task links + outcomes, executed on the substrate | D-09, I | "grow" produces documents, not outcomes |

## 2. IMPROVE — exists, make it true/complete (do not rebuild)

| Asset | Verified state | The improvement |
|---|---|---|
| Deletion route (`app/api/projects/[id]/route.ts:267-284`) | works for its 2 collections | extend the transaction; don't write a second delete path |
| Dodo adapter | correct per-call behaviour | add project filter + scopes; don't replace the adapter |
| Provisioning service | correct key mechanics | narrow scope constants; don't redesign keys |
| Cofounder agent (`lib/cofounder/agent.ts`) | tool governance, leases, refunds all work | add replay + context; don't rewrite the agent loop |
| Collab-chat store | returns full history already | consume it; don't build a memory framework |
| Intelligence/Growth pages | exist, render honest-but-stale copy | point them at real reads; keep their layout |
| Export route (`export/route.ts:14-40`) | core fields only | widen the field list + bundle linked collections |
| Pricing page | well-built | render the same function the paths use |
| Dashboard shell | solid desktop shell | responsive exposure of the meter; flag-gate "Soon" |
| Auth verify flow | works | add server-side enforcement; don't redesign auth |

## 3. INTEGRATE — don't duplicate an existing system

| Don't build | Because this exists and is verified |
|---|---|
| A second builder/host | Totalum is the sole, working builder+host (BUILD/LAUNCH stages verified strong) |
| Custom payment rails | Dodo checkout + webhook + recovery logic is engineered and idempotent |
| A new analytics pipeline | ingestion → store → TTL works end-to-end; it needs readers, not a rewrite |
| A new conversation store | three already exist (that's the problem — D-05); unify, never add a fourth |
| Direct provider calls outside the runtime | the runtime gateway (auth → limits → router → adapters → metering) is the single metered seam; every new capability must route through it |
| A second usage ledger | `provider_usage` is a dead store (D-08) — drop or repoint, never populate in parallel with `runtime_usage` |
| A bespoke scheduler/queue framework | the substrate should be jobs records + a trigger reusing the existing lease pattern (`lib/api/ai-lease.ts`); heavy frameworks (BullMQ/QStash) only if the simple trigger proves insufficient at scale |
| A new Totalum integration for the AI read tool | `lib/integrations/totalum/service.ts:198-246` already exposes queries — the tool wraps it |
| An ORM or migration framework | the Mongo store layer is consistent and typed; migrations have a working pattern |

## 4. PRESERVE — verified strengths the programme must not damage

- **Metering pipeline** — "the strongest subsystem in the repo" (RUNTIME §4): fail-closed charging, `runtime_<requestId>` idempotency, double-entry ledger.
- **Launch reconcile** — lost Totalum launch acks are reconciled, not refunded as failures (project record; preserved through every phase).
- **Credit-reversal identity discipline** — refunds reverse under the *same identity* the charge used (seo tests pin this; keep it true everywhere).
- **Consent-gated analytics to the AI** — the existing consent controls are the model for the new read tool.
- **Founder-owned feature switches** (`/settings/features`) — SEO/campaigns/tasks toggles; scheduled work must remain under them.
- **Honest-corpus precedent** (named squads) — the template for replacing fabricated narration.
- **Prompt-injection defenses** — layered and verified (SECURITY §6).
- **Build brief integrity** — no truncation in the launch handoff; never introduce truncation "for safety".

## 5. SIMPLER SOLUTIONS — where the fix is smaller than it looks

| Looks like | Actually |
|---|---|
| An AI memory system (vector DB, summarizers) | **bounded thread replay** — the store already returns full history (`lib/collab-chat/store.ts`); one assembly change |
| A background-processing platform | **jobs collection + one trigger**; the first consumer (heartbeat) is a scheduled POST to an endpoint that already exists |
| A data warehouse for analytics | **one daily-rollup collection** computed by the substrate; reads become trivial |
| A pricing microservice | **one function file** consumed by three call sites + the page |
| A real-time analytics dashboard | **server-computed summaries rendered into the existing Intelligence/Growth pages** (recharts pattern already proven on /finances) |
| An export "platform" | **widen one route's field list** and bundle the linked collections |
| Per-route rate-limit engineering | **one shared middleware limiter** applied to the 133 unthrottled routes, prioritizing AI-cost surfaces |
| An FX engine for provider costs | **store raw cost+currency with one explicit policy** (normalize-or-annotate) and compute margin in the existing admin aggregation |
| A mobile credit-meter feature | **remove `hidden lg:block`** and place the top-up affordance responsively — a CSS-class fix with a small layout change |

## 6. DEFER — real but not now (with the condition that unlocks each)

| Item | Finding | Unlock condition |
|---|---|---|
| Team/multi-seat permissions | D-11 | team features become real |
| Proration/downgrade tooling | R-08 | subscription volume makes edge cases frequent; document policy meanwhile |
| Backup/restore tooling UI | R-10 | confirm provider-side backups first (business action, not code) |
| In-process cache invalidation redesign | S-08 | second app instance exists |
| Payouts connected accounts | D-06 | reconciliation report proves demand; accounting/legal input received |
| Experiments/recommendations framework | AI-gap 7 | rollups (W13) ship and 90-day history accumulates |
| SEO re-audit / lesson-digest scheduling | part of I | substrate (W8) ships |
| Social-graph orphan sweep beyond cascade | D-12 | cascade fix ships; live orphan data inspected |
| ESLint v9 migration | J adjacent | CI stable; lint is never a Phase-1 gate |

## 7. DON'T BUILD — actively harmful or redundant

1. **Any AI feature that reasons over plan text and presents it as business intelligence** — this is the exact failure (AI-gap 2, gap G) the programme exists to remove. New AI surfaces must read real objects or say so.
2. **A fourth conversation surface.** Unify D-05; never add.
3. **Fabricated narration replacements** ("smarter" template banks). Replace with the honest corpus; do not enrich fiction.
4. **A custom builder/host migration** away from Totalum. Nothing in the audit supports it; W9 protects what exists.
5. **Consumers of the job substrate before the substrate** (scheduled campaigns, re-audits, digests) — they'd each hand-roll a trigger and be thrown away.
6. **New collections that mirror existing ones** (the D-08 mistake again). Every new object lands in the founder-owned layer, not beside it.
7. **A rewrite of metering/ledger/webhooks.** They are the strongest code and the safest thing to leave alone; CI exists to keep them that way.
8. **Real-time dashboards before rollups** — they'd query 90-day TTL rows, misreport history, and die again.
9. **Microservice decomposition, k8s, or multi-region work** — single-instance realities; S-08 is explicitly a defer-to-scaling item.
10. **Any bypass of the founder's feature switches** — scheduled/automated work must respect `/settings/features`; autonomy here was an explicit product decision, not a gap.
