# EXECUTIVE SUMMARY

**Audit:** ATAI.INK — Full Product Vision, Codebase, Business Capability & Expectation-Gap Audit
**Date:** 2026-11-09 · **Method & labels:** see README.md (VERIFIED / INFERRED / UNVERIFIED, `path:line` citations throughout the domain documents). No code was modified; no production systems were touched.

---

## What Atai is today

Atai is an **AI application builder that is real at its core and aspirational at its edges**. Verified end-to-end today: a founder enters an idea or a website, a 19-section plan is produced and editable, a build runs on Totalum, a development preview appears, a production deployment follows, and the built app talks back to Atai through a metered runtime gateway (`ATAI_API_KEY` → capability router → per-request idempotent credit ledger). Around that verified spine sit nine AI surfaces (plan-chat, co-founder agent, studio, SEO, lessons, resources, market kits, competition, ads bench) of very different depths, several of which plan or narrate rather than execute.

The strongest engineering in the repository is the part nobody sees: a double-entry credit ledger with unique idempotency keys, fail-closed runtime metering with pricing snapshots, verify-first webhooks replayed through identical logic, atomic pending-action approvals, and consistent ownership checks on every sampled route. The weakest parts are the ones the promise depends on: the founder's business data does not exist as data, the flagship AI forgets every turn, and three user-facing copy paths contradict the code.

## What it is supposed to become

A business-building ecosystem: the place where a founder starts (plan), builds and launches (Totalum + runtime), runs (customers, orders, revenue), manages (an AI co-founder with continuity and approval-gated hands), and grows (campaigns and measurement wired to real outcomes) — with one honest money and measurement layer underneath.

## How far along it is

- **Build/launch spine: delivered.** Evidence: BUSINESS-LIFECYCLE-AUDIT ST/BU/LA sections; deployment, provisioning, and recovery paths all verified in code.
- **Run/manage/grow: scaffolding without a subject.** No customers/orders/invoices/expenses/payouts collections exist anywhere (BUSINESS-DATA §3); campaigns and tasks are inert lists with no execution tables by explicit design (`lib/types/db.ts:895-900`); analytics events are ingested, expire in 90 days, are read by no founder-facing surface, and two pages still tell the founder the pipeline doesn't exist (`lib/intelligence/overview.ts:334-367`, `lib/marketing/growth-overview.ts:509-516`).
- **AI team: one model, many costumes, no memory.** Every AI surface shares one OpenRouter pin (`lib/analysis/model.ts:7`); the co-founder agent sends only the current message to the model and persists a transcript it never replays (`lib/cofounder/agent.ts:189-190,222-225`).
- **Trust layer: strong plumbing, three leaks.** Pricing contradicts itself across paths (automated launches charge heavy-mode 100k for the "simple" tier the pricing page sells at 50k — `lib/credits/credits.ts:44-83` vs `app/pricing/page.tsx:329`); deletion leaves armed keys and a live hosted app (`lib/store/mongo-store.ts:541-566`, zero Totalum-delete call sites); provisioned app keys can read the account-wide Dodo payment feed (`lib/runtime/provisioning/service.ts:83-85`, `dodo/client.ts:188-202`).
- **Engineering process: unprotected.** No CI (config deleted with `.github/`), the test suite is gitignored so a clean clone ships with zero tests, and error monitoring is stdout-only.

**Rough proportion:** the builder half of the promise is ~80% delivered; the ecosystem half is ~10% delivered (runtime attribution and analytics ingestion exist; every founder-facing surface for them is missing); the AI-team half is ~40% (excellent guardrails and tools; no memory, no scheduled execution).

## The ten biggest gaps (ranked; full detail in CRITICAL-GAPS-AND-FINDINGS.md)

1. **Cross-tenant payment exposure** — one leaked app key reads every founder's customers' payments (P0 security).
2. **Deletion is a lie** — deleted projects keep billing their owners and stay live on Totalum (P0 trust/security).
3. **No business substrate** — the object layer the entire "run/grow" story needs does not exist (P0 by absence).
4. **Co-founder amnesia** — the flagship AI forgets every turn; a one-file-class fix against infrastructure that already exists (P0 by visibility).
5. **Self-contradicting pricing** — same tier, three prices, advertising matches only the cheapest (P0 trust).
6. **Measurement collected, unseen, expiring** — the analytics pipeline works and is shown to no one (P1).
7. **Fabricated narration** — build copy asserts users/economics/competitor-wargames that no process produced (P1 honesty).
8. **Invisible provider cost** — margin and pricing truth are unmeasurable on the dominant AI path (P1).
9. **No job substrate** — nothing in the platform can act on time; recovery is a manual admin POST (P1 prerequisite).
10. **No CI, tests unshipped** — the best code in the repo is unprotected against regressions (P1).

## What is already strong (verified, worth preserving as-is)

The credit ledger and metering contracts; the webhook verify→persist→idempotent-process pipeline with replay through identical handlers; runtime key cryptography (one-time plaintext, hashed at rest); pending-action atomicity making double-approval impossible; prompt-injection fencing applied consistently across five AI surfaces; upload hardening (stream caps, sharp re-encode, metadata stripping); log redaction by value shape as well as field name; and the `notInstrumented` honesty vocabulary — definitions, caveats, and refusals to fabricate numbers, which is a genuine market differentiator once the data behind it is surfaced (COMPETITIVE §4).

## What prevents the promise

Three things, in order: **tenancy and lifecycle integrity** (the two P0s that can actively harm founders — charges from deleted apps, cross-tenant reads); **the missing subject** (no business data for the ecosystem story to be about); and **continuity** (an amnesiac AI cannot be a "team," and no scheduler means nothing can be autonomous or even reliably recovered). Copy contradictions sit on top of these and spend the honesty reputation that the rest of the engineering has earned.

## What must be fixed first

The P0 wave, all small and independent: close the payments scope hole, make deletion revoke keys and tear down (or explicitly warn about) the Totalum app, unify to one pricing function, replay bounded thread history into the agent, and purge fabricated narration. Days of work, no new subsystems, each shippable alone (PRIORITIZED-IMPLEMENTATION-ROADMAP P0).

## What to stop building

- **More grow-surface modules** (new market kits, more `notInstrumented` metrics, more "Soon" rows) until the measurement layer reads real data — they currently add surfaces that promise what the data layer can't show.
- **More AI surfaces** before the memory fix lands — each new amnesiac assistant deepens the same defect.
- **Pricing-heavy marketing** before the three-path contradiction is resolved — every launch currently risks a billing dispute.
- **Template-gallery or IDE-exposure growth plays** — they contradict the positioning and compete where Atai is weakest (COMPETITIVE §5).

## The most important next stage

**Build the business substrate and its eyes.** Concretely, in dependency order: the job substrate (one small new subsystem whose pattern is already proven by the in-repo recovery worker) → daily analytics rollups + founder-facing reads (turning collected data into permanent history and fixing the "not collected" copy) → the founder-owned business objects (customers, orders, revenue rollups) fed by the attribution metadata that already exists → co-founder read tools over them behind the existing consent gates. That sequence converts Atai from "an app builder with a ledger" into the beginning of the ecosystem — and every step reuses verified infrastructure rather than replacing it (TARGET-ATAI-ARCHITECTURE §3).

## Verdict

**Atai is an AI application builder evolving into a business platform — not yet a business-building ecosystem.** The evidence: the builder-to-deployed-app spine is verified working end-to-end (lifecycle audit), and the runtime/billing plane underneath it is production-grade and honest; but the elements that would make it an ecosystem are structurally absent — there is no founder-owned business data anywhere in 49 collections, the AI that would run the business cannot remember the conversation, nothing can execute on a schedule, and founder revenue settles commingled in Atai's own payment account with metadata as the only separator. It is closer to the ecosystem than its builder competitors are — the metered runtime, the consent-gated approval ladder, and the no-fabrication vocabulary are real, rare assets — but the distance is measured in a missing data layer, not in missing marketing. The P0 fixes are days; the substrate is the next real build; and the honest copy must start telling the truth the code currently contradicts.

---

**Document index:** README (method) · CURRENT-CODEBASE-BASELINE · ATAI-VISION-AND-CAPABILITY-MATRIX · BUSINESS-LIFECYCLE-AUDIT · AI-TEAM-AND-COFOUNDER-AUDIT · USER-EXPERIENCE-AND-JOURNEY-AUDIT · BUSINESS-DATA-AND-INTEGRATION-AUDIT · RUNTIME-BILLING-AND-INFRASTRUCTURE-AUDIT · SECURITY-AND-RELIABILITY-AUDIT · COMPETITIVE-AND-EXPECTATION-BENCHMARK · CRITICAL-GAPS-AND-FINDINGS · TARGET-ATAI-ARCHITECTURE · PRIORITIZED-IMPLEMENTATION-ROADMAP · ACCEPTANCE-CRITERIA-AND-VERIFICATION-PLAN
