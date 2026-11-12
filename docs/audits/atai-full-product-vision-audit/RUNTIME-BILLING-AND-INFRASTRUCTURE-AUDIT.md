# RUNTIME, BILLING & INFRASTRUCTURE AUDIT

**Audit:** ATAI.INK Full Product Vision & Expectation-Gap Audit (Part 8 of 16)
**Date:** 2026-11-09
**Method:** Read-only code inspection. Claims carry `path:line` citations and VERIFIED / INFERRED / UNVERIFIED labels. No live services were called, no production state inspected, no code modified.

---

## 1. What this document covers

Atai's runtime is the layer that (a) routes capability calls from generated apps to providers, (b) meters and bills them against Atai's credit system, and (c) rides on top of third-party infrastructure — Totalum for app building/hosting, MongoDB for state, OpenRouter for AI, Dodo for money, ImageKit for files, Firecrawl for scraping. This document audits routing, metering, credit economics, purchase flows, recovery, and infrastructure reality.

Headline: **the metering core is unusually disciplined (idempotent, fail-closed, reconcilable), but three pricing paths disagree with each other, subscription-refill and provider-cost economics are not modeled, and nothing self-heals because no scheduler exists.**

---

## 2. The two-stack architecture

VERIFIED.

```
Founder browser ── Atai (Next.js app, MongoDB state)
                     │  builds & hosts                meters & bills
                     ▼                                     ▲
              Totalum platform                     generated app
              (app builder, DB, hosting)                 │ ATAI_API_KEY
                                                          ▼
                                              Atai Runtime  POST /api/runtime/v1
                                                          │
                                              authenticate → authorize → route
                                                          │
                              OpenRouter · Dodo · Firecrawl · analytics (internal)
                                                          │
                                              meter → credit_ledger
```

- Generated apps authenticate with `ATAI_API_KEY` (`atai_<env>_<secret>`), whose plaintext is shown once, SHA-256-hashed, and never stored (`lib/runtime/key-crypto.ts:15-77`).
- Provisioning maps build completion → development key, production deploy → production key, deterministically (`lib/runtime/provisioning/service.ts:96-108`).
- Totalum is the sole builder and host; Atai holds no compute for generated apps. Atai's own API surface (this Next.js app) is where all runtime calls land.

---

## 3. Capability routing

VERIFIED. One request schema, one router, adapters per provider (`lib/runtime/router/router.ts`, `provider-registry.ts`, `capability-registry.ts`).

| Capability family | Provider | Notes |
|---|---|---|
| `ai.*` (text/image/speech/transcription) | OpenRouter (single model pin, `lib/analysis/model.ts:7`) | Atai pays OpenRouter via platform key; free-model pins currently mask cost |
| `payments.*` | Dodo (platform account) | createPaymentLink, createCustomer, createSubscription, listPayments, listPayouts |
| `search.web`, `web.scrape` | Firecrawl | platform key |
| `email`, `notifications`, `maps`, `calendar`, `vectors`, `db`, `analytics`, `test` | routed per registry | `auth` and `storage` are listed in contracts but NOT routed (baseline audit §6) |
| `test` | internal echo | excluded from provisioned scopes |

INFERRED: several capabilities are contract-first with thinner adapters (email/calendar/vectors/db); the runtime's *product* claim outruns the *implemented* surface for those. The capability matrix (ATAI-VISION-AND-CAPABILITY-MATRIX.md) carries the per-capability status.

---

## 4. Metering pipeline — the strongest subsystem in the repo

VERIFIED (`lib/runtime/metering/charge.ts`):

```
calculateRuntimeCredits()      pure pricing calculation
        ↓
chargeRuntimeUsage()           the ONLY mutation point
        ↓
consumeCredits()               transactional debit, subscription-first,
                               unique idempotencyKey runtime_<requestId>
```

- **Idempotency:** ledger enforces a unique `idempotencyKey`; retry/replay of the same billable request is a recognized no-op (`charge.ts:19-33`, `lib/billing/credit-service.ts` idempotency checks).
- **Fail-closed:** a ledger/DB failure throws `runtime_billing_unavailable` (503) — an unknown financial state is never reported as a successful unbilled call (`charge.ts:120-128`). Insufficient balance → 402 (`:132-144`). Provider-side failure after a usage-based charge refunds idempotently (`:165-220`).
- **Usage records:** every event lands in `runtime_usage` with the resolved pricing rule snapshot (`lib/billing/runtime-config.ts:210-217`), so price edits never rewrite history.
- **Rate ceilings:** 300 req/min/key platform cap, project-level caps may only tighten (`lib/runtime/platform-limits.ts:6-15`); per-key authenticated-request cap and auth-failure throttling in `authenticate.ts`.

VERDICT: this is production-grade billing plumbing. The problems live in what it charges, not how.

---

## 5. Credit economics

### 5.1 Valuation

VERIFIED. One canonical constant: **3,750 credits = $1 USD** (`lib/billing/credit-valuation.ts:100-155`, exact bigint math, aggregate-then-convert pattern mandated for reports).

### 5.2 Purchase pricing vs valuation (INFERRED inconsistency)

Permanent packs in `lib/billing/config.ts:274-278`:

| Pack | Price | Implied credits/$ | vs standard 3,750 |
|---|---|---|---|
| 200k | $59 | 3,390 | 9.6% worse |
| 500k | $119 (popular) | 4,202 | 12% better |
| 1M | $219 | 4,566 | 21.8% better |
| 5M | $859 | 5,820 | 55% better |
| 15M | $2,499 | 6,002 | 60% better |

Not *wrong* (volume discounts are normal), but the "standard credit value" constant and the storefront disagree with each other by up to 60%, and nothing in the UI explains the anchor. Any USD-denominated reporting that uses 3,750 will misstate founder-pack economics.

### 5.3 Build pricing — three paths, two answers (VERIFIED divergence)

| Path | Function charged | Default for "simple" | Where |
|---|---|---|---|
| Manual build route / follow-up edits / co-founder build tool | `getBuildCost(tier)` → `BUILD_TIERS` | **50,000** | `app/api/projects/[id]/build/route.ts:76`, `lib/billing/build-auth.ts:34-41`, `lib/projects/project-actions.ts:126,254`, `lib/cofounder/tools/applications.ts:38` |
| Automated launch pipeline (`autoLaunchBuild`) | `getTierCost(tier, pipelineMode)` with heavy scaling | **100,000** (heavy simple = legacy ×2, `lib/credits/credits.ts:44-83`) | `lib/analysis/pipeline.ts:135` |
| New projects | `pipelineMode` forced `"heavy"` | always heavy | `lib/projects/create-project.ts:120`, `lib/projects/continue-start.ts:10` |
| Pricing page | — | "A simple launch is 50,000 credits" | `app/pricing/page.tsx:27,42,329` |

Consequence: a new founder whose plan completes and auto-launches pays the heavy price (100k for simple) through `autoLaunchBuild`, while the pricing page and the manual/retry path both say 50k. Two code paths charge different amounts for the same tier, and the founder-facing copy matches only the cheaper one. This is exactly the class of "terms contradicting pricing" finding the pre-MVP audit flagged; it persists in a new location.

### 5.4 Other charges

- Deploy: 500 credits default, admin-configurable, "lifetime hosting" (`app/api/projects/[id]/deploy/route.ts:20-27`), rate-limited 10/day.
- Collaborate costs: chat 2, plan analysis 10, auto-complete 8 (defaults, admin-configurable, `lib/billing/runtime-config.ts:16-30`).
- Pipeline: scrape 5 / heavy 100, plan 5 / heavy 100, deep crawl 500 / heavy 1000 (`runtime-config.ts:63-79`). Heavy multipliers here are margin knobs, not cost-derived (INFERRED — no provider-cost linkage).

### 5.5 Subscription vs permanent buckets

VERIFIED. Two buckets with consumption order subscription-first, transactional with balance clamps (`credit-service.ts:423-609`). Subscription grants are idempotent per period-day: `sub_grant_<subId>_period_<day>` (`dodo-event-processing.ts:369`). Renewal failure marks `past_due` and keeps credits for Dodo's own retry (`dodo-event-processing.ts:289-301`).

INFERRED gap: no proration, no mid-period cancellation credit handling, no downgrade path beyond the webhook states — fine for launch, thin for a real subscription business.

---

## 6. Money in: Dodo purchase flow

VERIFIED:

- Checkout uses Dodo catalog products (`pdt_…` via `product_cart`, default product `DODO_CHECKOUT_DEFAULT_PRODUCT_ID`); hosts are `test./live.dodopayments.com` at root path (previously-fixed bugs, confirmed by current code shape in `lib/billing/dodo-service.ts` / `lib/env.ts:209-229`).
- Webhooks follow the Standard Webhooks spec: HMAC-SHA-256 over `id.timestamp.body` with base64-decoded secret, ±5-minute replay window, constant-time compare (`lib/billing/dodo-webhook.ts:18-90+`); events persisted before processing with webhookId-level idempotency and duplicate-race handling (`app/api/billing/webhook/route.ts:127-170`).
- Every grant/clawback writes a ledger row keyed by stable business id (`payment_…`, `refund_…`, `sub_grant_…`), so the recovery path replays the *same* logic rather than a weaker copy (`lib/billing/webhook-recovery.ts:20-46`).

---

## 7. Recovery and reconciliation — correct logic, no heartbeat

VERIFIED:

- `webhook-recovery.ts` re-runs failed/unresolved events through the identical idempotent handlers, with atomic event claims, lease windows, attempt budgets, and a terminal `manual_review` state (`:20-46`, `claimNextEvent` design at `lib/db/collections.ts:502`).
- **Nothing self-fires.** The module's own comment states it: "this repository has NO job substrate/cron" (`webhook-recovery.ts:41`). Recovery runs only when an admin POSTs `/api/admin/billing/webhooks` (grep: sole caller). Failed payment events sit unprocessed indefinitely unless a human remembers.
- Build/deploy status is client-polling only; a founder who closes the tab leaves a build unpollable until they return (recovery-on-return exists via `lastPolledAt`, `lib/types/project.ts:255-258`).
- Reconciliation (`lib/finances/reconciliation.ts`) shares the same eligibility vocabulary — good — but is likewise pull-only.

This is the single most important infrastructure gap: **the money layer is durable but inert.** Dodo retries its own deliveries, so most events arrive; the unhandled residue (network failures, unresolved attribution, expired leases) has no clock.

---

## 8. Infrastructure inventory

VERIFIED (from code/env reads; live infrastructure not inspected — UNVERIFIED for uptime, region, backups):

| Component | Provider | Evidence |
|---|---|---|
| Atai app host | Not determinable from repo (Vercel Analytics package only, `package.json:22`) | UNVERIFIED |
| Database | MongoDB, `MONGODB_URI`, singleton client, no ORM (`lib/db/mongodb.ts:85-100`) | VERIFIED |
| Files | ImageKit, key pair in `lib/env.ts:85-95` | VERIFIED |
| AI | OpenRouter, platform key (`lib/analysis/model.ts:7`) | VERIFIED |
| Payments | Dodo (`lib/env.ts:209-229`) | VERIFIED |
| Scraping | Firecrawl (`lib/runtime/router/adapters/firecrawl/config.ts:24-34`) | VERIFIED |
| Builder/hosting for generated apps | Totalum, platform key (`lib/integrations/totalum/client.ts:14`) | VERIFIED |
| Email (Atai's own) | via auth flows (verification tokens) — provider not visible in this pass | UNVERIFIED |

Missing infrastructure pieces, all VERIFIED-absent: no cron/queue/worker, no cache layer beyond in-process maps (`lib/cache/single-flight.ts`, store-level caches), no CDN strategy visible, no backup/restore tooling (grep found none), no uptime/Sentry-style error reporting (logger is stdout-JSON only, `lib/logging/logger.ts:60-66`).

INFERRED risk: Atai's availability is a function of one Node process + MongoDB + Totalum. The build path (Totalum 60s timeout at `lib/integrations/totalum/service.ts:176`) and long AI turns (240s agent cap) run in-request — a slow provider holds a serverless function open, which on metered hosting is a cost and reliability exposure.

---

## 9. Findings

**R-01 (P0) — Build pricing contradicts itself across paths, and the automated path new founders actually take is the expensive one.**
Evidence: §5.3 citations. Impact: the pricing page's "50,000 credits" promise is false for heavy-mode auto-launches (100k for simple). Founder trust + refund exposure. Fix shape: one pricing function consumed by all three paths; heavy multiplier surfaced on the pricing page or retired.

**R-02 (P0) — No scheduler exists anywhere in the money path.**
Evidence: `webhook-recovery.ts:41`, admin-only caller (grep). Impact: failed billing events (grants, clawbacks, subscription transitions) stay unprocessed until someone remembers to POST an admin endpoint; unresolved refunds mean founders keep credits they were paid back for. Fix shape: even a 5-minute external cron hitting the existing admin recovery endpoint (with its own auth) closes 80% of the gap.

**R-03 (P1) — Provisioned app keys carry the full capability set, including `payments`, and Dodo reads are account-wide.**
Evidence: `PROVISIONED_KEY_SCOPES` = all routed capabilities except test (`lib/runtime/provisioning/service.ts:83-85`); `listPayments`/`listPayouts` filter only limit/status/subscription/customer against **platform** credentials (`lib/runtime/router/adapters/dodo/mapper.ts:279-327,416-420`, `client.ts:188-202`). Impact: any leaked generated-app key can read *every* customer payment across all Atai founders (emails, amounts). Cross-tenant financial exposure. Fix shape: metadata-scoped reads (`_ataiProjectId` filter server-side) + narrower provisioned scopes + per-project Dodo customer filters.

**R-04 (P1) — Provider cost is invisible for the dominant AI path.**
Evidence: OpenRouter usage flows through Atai's platform key; free-model pins currently report zero cost; `runtime_usage` stores provider cost "WHERE AVAILABLE" (`app/api/admin/runtime/financials/route.ts:26-33`), and mixed currencies are summed without conversion (admin financials aggregation). Impact: unit economics (credit price vs provider cost) are unmeasurable today; heavy-mode multipliers are guesswork. Fix shape: normalize provider cost into one currency (or store raw + FX policy), report margin per capability.

**R-05 (P1) — "Lifetime hosting" for 500 credits vs Totalum infrastructure subscriptions.**
Evidence: deploy route copy (`deploy/route.ts:20-27`); `InfrastructureSubscription` type with Totalum credit limits and storage quotas (`lib/types/project.ts:131-160`). Impact: if Totalum bills Atai ongoing infrastructure credits per project while Atai charges founders once, hosting margin decays with every deploy and the terms copy overpromises. UNVERIFIED against the live Totalum contract — flag for business confirmation. Fix shape: reconcile the two models before scaling marketing.

**R-06 (P2) — Pack pricing contradicts the standard credit valuation anchor.**
Evidence: §5.2 table vs `credit-valuation.ts`. Impact: any founder-facing USD framing ("your credits are worth $X") will disagree with what they paid. Fix shape: document the anchor as accounting-standard, show pack-implied values where USD is quoted.

**R-07 (P2) — Long operations run in-request.**
Evidence: agent turn 240s cap (`lib/cofounder/agent.ts:14`), Totalum deploy call 60s (`totalum/service.ts:176`), no queue. Impact: serverless timeout exposure; one stuck provider call blocks a slot (mitigated by leases, `lib/api/ai-lease.ts`). Fix shape: the deferred job substrate (roadmap dependency).

**R-08 (P2) — Subscription lifecycle has no proration/downgrade handling.**
Evidence: §5.5. Impact: edge cases land in `manual_review` with no operator tooling beyond the recovery endpoint. Fix shape: accept for now; document policy.

**R-09 (P3) — Error reporting is stdout-only.**
Evidence: `lib/logging/logger.ts:60-66`. Impact: incidents are discovered by users, not alerts. Fix shape: attach a hosted log drain/error tracker; no code-path change needed.

**R-10 (P3) — No backups/restore tooling in repo.**
Evidence: grep "backup|snapshot|restore" — auth-related matches only. Impact: UNVERIFIED whether MongoDB Atlas backups exist operationally; if not, a database incident is existential. Fix shape: confirm provider-side backups + document RPO/RTO.

---

## 10. What is genuinely strong

Worth saying plainly, because it shapes the roadmap: the credit ledger (double-entry, unique idempotency keys, bucket clamps inside transactions), the runtime metering contract (single mutation point, fail-closed, priced-rule snapshots), the webhook pipeline (verify-first, persist-before-process, replay through identical handlers), and the honest unit vocabulary (`reversal-types.ts` refusing to net clawbacks into "credits handed back") are better than the product's current size requires. These are assets to keep, not rework targets. The gaps are one scheduler, one pricing truth, one cost model, and one tenant-scoping rule.
