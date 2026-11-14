# Atai — Phase 1 Implementation-Readiness Report

**Document type:** Capability audit & readiness report (Phase 1, read-only — no code changed)
**Date:** 2026-11-14
**Spec:** Atai Pricing, Plans & Entitlement Specification (master commercial spec)
**Verdict:** **NOT READY to implement the full spec as advertised.** The billing/credit engine is mature and reusable; the plan catalog, entitlement enforcement, annual billing, and several headline Scale features are absent or only partially built. Implementing the spec truthfully requires ~9 phases, of which Phases 2–7 carry the bulk of new work.

---

## 0. Executive summary

The codebase has a **production-grade credit ledger, Dodo webhook pipeline, and Runtime metering layer** that the new subscription system can build on without replacement — satisfying hard rule #4 ("don't break existing billing"). However:

- **The plan catalog is wrong.** Current plans are `free / explorer($12) / starter($79) / business($139) / professional($219) / enterprise($499)` — six plans, all monthly, with credit-quantity tiers and free-text feature strings. The spec wants `Explorer(free) / Starter($89.99) / Growth($199.99) / Scale($499.99) / Enterprise(custom)` with monthly + annual billing. Names collide (current `explorer` is paid; spec `Explorer` is free); `Growth`/`Scale` IDs don't exist.
- **Entitlement enforcement is essentially absent.** Nothing gates creation, builds, deploys, domains, hosting, databases, agents, marketing, or lessons by plan. The only real guards are credit balance and HTTP rate limits. Free/Explorer users can already deploy production apps with their 500 welcome credits.
- **Annual billing does not exist.** The `interval: "yearly"` type is defined but unused; Dodo is wired for monthly only.
- **Cost modelling is insufficient to set credit allocations.** Current `mirrorCredits` values are hard-coded round numbers with no documented cost-model derivation. No per-plan contribution-margin tool exists — violating hard rule #1.
- **Several Scale selling points are not built.** Agent Start / Scout / Optimize, continuous app improvement, marketing automation (scheduling/publishing), knowledge base, and multi-business BI comparison are absent or explicitly stubbed — violating hard rule #3 if advertised.

The report below maps every spec section to current implementation status and recommends a phased path that preserves existing billing while closing the gaps truthfully.

---

## 1. Capability mapping — spec section → implementation status

Legend: **REAL** = working code, enforces behavior. **PARTIAL** = exists but incomplete or not enforced. **STUB** = scaffolding only. **UI-ONLY** = shown in UI, no backend. **ABSENT** = not found.

### 1A. Pricing & plan catalog (spec §2, §3–7)

| Spec requirement | Status | Evidence |
|---|---|---|
| Explorer = FREE, planning-only, 500 pre-publication credits | **PARTIAL / contradicted** | `config.ts:100-128` `free` plan grants 500 welcome credits (`WELCOME_BONUS_CREDITS=500`, `:287`) with NO production restriction. Current `explorer` (`:130-162`) is a **paid $12** plan advertising "Full application builds", "Deployment system", "Database management". |
| Starter $89.99/mo | **PARTIAL** | `config.ts:164-188` `starter` exists but at **$79**, 300k credits, "Use your own domain". No business/app/subdomain limits. |
| Growth $199.99/mo, MOST POPULAR, 4 businesses, 1 domain | **ABSENT** | No `growth` plan ID. Flagship badge (`popular:true`) is on `business` ($139) at `config.ts:199`. |
| Scale $499.99/mo, unlimited businesses, 4 domains, agents | **ABSENT** | No `scale` plan ID. Closest is `professional` ($219) / `enterprise` ($499 fixed, not custom). |
| Enterprise = custom pricing | **PARTIAL** | `config.ts:230-252` `enterprise` has `custom:true` but a **fixed $499** price — `custom` only hides it from the grid, not "contact sales". |
| Annual prices (989.89 / 2199.89 / 5499.89) | **ABSENT** | All plans `interval: "monthly"`. No annual prices, no yearly Dodo products. `dodo-service.ts:85-88` hardcodes monthly period. |
| Monthly/Yearly toggle on pricing page | **ABSENT** | `app/pricing/page.tsx` has no toggle. |
| Growth strongest visual emphasis | **ABSENT** | Badge is on `business`. No scaled flagship card. |
| Feature comparison table | **ABSENT** | Features are in `<details>` disclosures (`plan-card.tsx:286-292`). |
| Enterprise shown separately | **PARTIAL** | Shown separately on `/pricing` (`page.tsx:365-379`) but not on `/settings/billing` (`page.tsx:211` filters `!custom`). |

### 1B. Subscription billing & Dodo (spec §13)

| Spec requirement | Status | Evidence |
|---|---|---|
| Dodo as provider | **REAL** | `lib/env.ts:208-230`, `dodo-service.ts`. |
| Webhook signature verification (before processing) | **REAL** | `dodo-webhook.ts:28-121` (Standard Webhooks, HMAC-SHA256, `timingSafeEqual`, 5-min replay window). Verified before persisting (`webhook/route.ts:82-98`). |
| Idempotency / dedup | **REAL** | Webhook-id dedupe (`route.ts:121-150`); ledger idempotency keys; recovery worker `webhook-recovery.ts:168-231`. |
| Event handling (payment/subscription/refund/dispute) | **REAL** | `dodo-event-processing.ts:107-274` handles full event set; unattributable → `unresolved`, never guessed. |
| Checkout (server resolves plan/pack, never client price) | **REAL** | `checkout/route.ts:44-235`; server resolves from `config.ts`, auto-provisions Dodo product. |
| Entitlements update only after verified events | **REAL** | Verified-then-process flow. |
| Monthly checkout | **REAL** | Working. |
| Annual checkout | **ABSENT** | No yearly Dodo products or checkout path. |
| Plan change / upgrade / downgrade (in-place) | **PARTIAL** | No dedicated route. "Switch to X" POSTs a **new** checkout (`plan-card.tsx:239-270`); activation cancels prior sub (`activate-subscription.ts:51-62`). `subscription.plan_changed` only updates 4 fields, no proration/credit re-grant (`dodo-event-processing.ts:461-474`). UNVERIFIED whether Dodo emits `plan_changed` with `product_id`. |
| Cancellation | **REAL** | `subscription/cancel/route.ts:11-82` (`cancel_at_next_billing_date`) + retention UI. |
| Payment failure handling | **REAL** | `payment.failed` → `past_due`/`payment_failed` status. |
| Invoice / receipt / payment history (user-facing) | **ABSENT** | `payment_records` written but only admin reads them (`admin/billing/overview/route.ts:31`). User `overview/route.ts` exposes balance + ledger only. |
| Refund handling | **REAL** | Proportional refund reversal + separate rows (`dodo-event-processing.ts:194-274`). |
| Billing notifications (email/push) | **ABSENT** | No billing email/notification found. |
| Subscription status sync | **REAL** | `sync/route.ts`, `overview/route.ts`. |

### 1C. Credits, ledger & Runtime metering (spec §9)

| Spec requirement | Status | Evidence |
|---|---|---|
| Unified credit ledger (single source) | **REAL** | `credit_ledger` Mongo collection, atomic `withTransaction()`, idempotency keys (`credit-service.ts:152,337,437,778`). |
| No duplicate ledger | **REAL** | `runtime/contracts/billing.ts:10-11` explicitly forbids a second balance system; runtime charges use `consumeCredits`/`grantCredits`. |
| Subscription vs permanent credit separation | **REAL** | `creditBuckets[]`, `CreditBalance{total,subscription,permanent}` (`credit-service.ts:41-45,72-78`). |
| Consumption order (subscription first) | **REAL** | `consume-plan.ts:45-107` sorts by `expiresAt`, consumes subscription then permanent. |
| Subscription credit expiry | **PARTIAL** | `expireSubscriptionCredits()` exists (`credit-service.ts:868-1022`) but is **webhook-driven only** — no proactive scheduler. Missed webhook = credits don't expire until recovery. |
| Permanent credits never expire | **REAL** | `grantCredits` with `creditType:"permanent"` has no expiry. |
| Monthly grant on renewal | **REAL** | `handleSubscriptionRenewed` (`dodo-event-processing.ts:348-403`) expires old bucket, grants new. |
| Runtime metering | **REAL** | Full pipeline `lib/runtime/metering/`: preflight → execute → meter/refund. `charge.ts:60-161`, `usage.ts:25-58`, `pricing.ts`. Admin-configurable pricing rules. |
| Build authorization (reserve/finalize/release) | **REAL** | `build-auth.ts:45-223`. |
| Explorer 500 credits restricted to planning (no production) | **ABSENT** | Welcome credits are unrestricted permanent credits. No usage-scoping mechanism exists. |
| Annual: pay upfront, issue credits monthly | **ABSENT** | No annual plan, no monthly scheduler, no `nextBillingDate`-driven grant. |
| Per-plan credit allocation admin-configurable | **PARTIAL** | `app_settings` DB override exists for build/runtime/infra pricing (`runtime-config.ts`) but **NOT** for plan `mirrorCredits` — those are compile-time constants in `config.ts`. |
| Credit quantities derived from cost model | **ABSENT** | `mirrorCredits` (50k/300k/600k/1.4M/5M) are hard-coded round numbers. `BASELINE_COST_MODEL_V1` defines wholesale unit pricing but nothing maps it to per-plan allocations. No per-plan contribution-margin tool. |

### 1D. Business, project & infrastructure limits (spec §4–6, §10, §12)

| Spec requirement | Status | Evidence |
|---|---|---|
| Server-side business creation cap (Starter=1, Growth=4, Scale=∞) | **ABSENT** | `create-project.ts:98-233` never calls `countDocuments`, never reads subscription. Fork is a second uncapped path (`fork/route.ts:148-180`). "Business" is a UI synonym for Project — no `businessesCol` exists. |
| Production app/project cap | **ABSENT** | No `isProduction`/count gate anywhere. |
| Explorer blocked from production (build/deploy/hosting/DB/domains) | **ABSENT** | `build/route.ts`, `deploy/route.ts`, `domain/route.ts` have NO plan check. Free users deploy with 500 welcome credits (= deploy cost). |
| Free Atai subdomain (Starter=1) | **PARTIAL (provider only)** | `publish-menu.tsx:362` uses `*.totalum-project.com` (Totalum's domain, not Atai's). No count cap, no plan gate. |
| Included custom domain registration (Growth=1, Scale=4, year 1) | **ABSENT** | No registrar integration. Custom domain = BYO DNS only (`domain/route.ts:15-67`), no plan check, no count, no eligibility. |
| Hosting allocation quota | **ABSENT** | `app/hosting/page.tsx` is a `ComingSoonPage` stub. |
| Database capacity quota | **PARTIAL (unlinked to plan)** | Totalum per-project DB (`totalum/service.ts:198-272`), infra credit cap real (`service.ts:72-92`) but not plan-bound. |
| Storage quota enforcement | **ABSENT (dead code)** | `checkStorageLimit` (`service.ts:344-352`) has **zero callers**. `storageUsedBytes` has no writer — `overQuota` is permanently false. |
| Priority compute (Scale) | **ABSENT** | "Priority builds" is a feature string only (`config.ts:204`). |
| Downgrade: never delete data/apps | **PARTIAL** | Infra `handleExpiration` preserves data (`service.ts:275-329`); project deletion is explicit-only (`projects/[id]/route.ts:269-291`). But account-level downgrade is silent — `plan_changed` rewrites 4 fields, no project scan, no infra resync, no warning. |
| Downgrade: identify over-limit resources | **PARTIAL** | Storage boolean only (`service.ts:314`), no app/domain/hosting enumeration. |
| Downgrade: block new consumption beyond allowance | **ABSENT** | No enforcement. |
| Downgrade: communicate consequences first | **ABSENT** | `cancel-subscription-button.tsx:201-222` lists credit/support losses only, even claims "Unlimited Projects". |
| Renewal costs disclosed (domains) | **ABSENT** | Only vague copy (`publish-menu.tsx:471`). |

**Conflicting entitlement systems found:**
1. Account subscription plans (`config.ts`) — credit catalog, no numeric entitlements.
2. Per-project infrastructure plans (`infrastructure/plans.ts`: `testing/basic/starter/pro/business/enterprise`) — storage/credits, purchased with credits, independent of account subscription. **Name collision**: both use `starter`/`business`/`enterprise` with different meanings.
3. Spec taxonomy (`Explorer/Starter/Growth/Scale/Enterprise`) matches neither.
4. `app/pricing/page.tsx:42-70` adds a fourth layer of marketing copy.

### 1E. AI Co-founder, teams & agents (spec §3–6, §11)

| Spec requirement | Status | Evidence |
|---|---|---|
| AI Co-founder (limited → core → advanced → premium) | **PARTIAL** | `lib/cofounder/` (29 files) exists. Tiering/customization/plan-gating status UNVERIFIED in this audit pass — needs Phase 6 deep-dive. |
| Core AI specialist teams (Starter) | **PARTIAL** | Team registry/prompts likely exist in `lib/cofounder/`. Plan-gating: ABSENT (no `hasFeature` checks found anywhere). |
| Advanced marketing team / AI team collaboration (Growth) | **ABSENT** | No multi-agent coordination. Marketing modules are single-shot AI calls. |
| Agent Start | **UNVERIFIED — likely STUB/DOC-ONLY** | Search found no executable agent-start implementation; needs Phase 6 confirmation. |
| Scout | **PARTIAL** | Competition research (`competition-research.ts`) does what Scout describes (market/competitor research via Firecrawl) but is not branded/framed as an "agent" and has no autonomous execution. |
| Optimize | **ABSENT** | No continuous-improvement/auto-optimize implementation found. |
| Continuous application improvement (monitoring, bug diagnosis, authorized code mods) | **ABSENT** | No monitoring/auto-fix/self-healing. No approval gates for authorized code modifications. |
| Knowledge base (editing, customization, retrieval, business context) | **ABSENT** | No RAG/embeddings/vector store found. |
| Premium AI teams / scaling partners / smart team management / role customization (Scale) | **ABSENT** | No team management intelligence. |
| Business-specific intelligence (e-commerce/SaaS/digital/service) | **PARTIAL** | `lib/resources/business-intelligence.ts` has deterministic derivations from plan content; not model-specific operational intelligence. |
| Full Co-founder customization (Scale) | **ABSENT** | UNVERIFIED — needs Phase 6. |

> **Critical for hard rule #3:** Agent Start, Optimize, continuous app improvement, knowledge base, and marketing automation must NOT be advertised as available until Phase 6 confirms real implementations.

### 1F. Marketing, advertising, competition, education, BI (spec §4–6)

| Spec capability | Status | Evidence |
|---|---|---|
| SEO audit (foundational) | **REAL** | `seo/service.ts`, `seo/crawl.ts` (Firecrawl), `seo/auditor.ts` (deterministic). Credit-metered. |
| SEO advanced (keyword research, backlinks, rank tracking) | **PARTIAL** | On-page factors only. |
| Content creation (Studio) | **REAL** | `studio/service.ts` — AI generation, persisted, versioned. |
| Content strategy | **PARTIAL** | AI drafts from plan; no performance-driven iteration. |
| Advertising: campaign planning | **REAL** | `campaigns/service.ts` — durable plan store. |
| Advertising: credit charging | **REAL** | `ads/billing.ts` — `ad_campaign_charge`/`refund` in unified ledger. |
| Advertising: real ad platform integration (Meta/Google/TikTok) | **ABSENT** | Manual service-delivery model only. Admin issues quotation, founder pays credits, admin executes manually. |
| Advertising: third-party spend separation | **ABSENT** | Credits are platform currency; no passthrough of real ad spend. |
| Competition research | **REAL** | `competition-research.ts` — Firecrawl multi-source, AI analysis grounded in sources. |
| Competition monitoring (scheduled) | **ABSENT** | One-off runs only. No scheduler/cron. |
| Competition comparison/positioning over time | **PARTIAL** | Snapshots persisted with `contextHash`; no diff view or scheduled re-runs. |
| AI business intelligence & analytics | **ABSENT** | `intelligence/overview.ts` — recommendations `notInstrumented`. Only runtime-call metrics exist. |
| Multi-business BI comparison | **ABSENT** | `platform-finances.ts` is a finance roll-up, not BI comparison. |
| Performance trends | **PARTIAL** | Ad analytics daily series + runtime metrics. No app-level analytics. |
| Customer insights | **ABSENT** | `notInstrumented`. |
| Marketing automation (scheduling, publishing, connected accounts, social management) | **ABSENT** | `campaigns/service.ts:8-13` and `tasks/service.ts:8-11` explicitly state they are NOT execution engines. No cron/queue/worker. No OAuth. |
| Founder education: structured learning paths | **REAL** | `lessons/paths.ts`, `paths-store.ts`, `curriculum.ts` — 4 default paths, ordered lessons, progress tracking, admin-managed. |
| Founder education: per-plan access control | **ABSENT** | Feature flags (on/off) only, not plan-tier gating. All users get the same library. |
| Financial intelligence | **REAL** | `finances/project-finances.ts`, `platform-finances.ts` — real expenses + earnings. |
| Support tiers (standard/direct/priority/premium) | **ABSENT** | No ticketing/routing/SLA. |
| Plan gating across ALL marketing/education/BI modules | **ABSENT** | No `hasFeature`/`requiresPlan` checks in any module or API route. |

### 1G. Entitlement architecture, admin & security (spec §14, §16)

| Spec requirement | Status | Evidence |
|---|---|---|
| Centralized subscription entitlement service | **ABSENT** | No entitlement service. Plan decisions scattered; the only plan source of truth (`config.ts`) is a credit catalog with free-text features. |
| Server-side plan validation on all routes | **ABSENT** | Only credits + rate limits enforced. `SUBSCRIPTION_PLANS`/`getPlanById` never gate a non-billing route. |
| Frontend never sole enforcement | **FAIL** | There is no enforcement at all (client or server) for plan-tier capabilities — worse than client-only. |
| Admin manages prices/credits/limits/entitlements without frontend edits | **PARTIAL** | `app_settings` DB override covers build/runtime/infra pricing (`runtime-config.ts`). Plan prices and `mirrorCredits` are code-only. Admin billing config route (`configuration/route.ts:190-254`) covers costs/rewards only. |
| Versioned record of pricing/entitlement changes | **ABSENT** | No pricing history table. |
| Changes don't modify existing subscribers' entitlements | **UNVERIFIED** | No mechanism to grandfather. |
| Administrative audit logs | **PARTIAL** | `infrastructure/audit.ts:11-68` (infra only). No billing/entitlement audit log. |
| Usage reporting | **PARTIAL** | Per-project economics + runtime breakdowns exist. No per-plan usage reporting. |
| Downgrade safeguards | **ABSENT** (account-level) | See §1D. |
| No duplicate subscription systems | **FAIL** | Two competing plan layers (account subscriptions + per-project infra plans) with name collisions. |

---

## 2. What is reusable (do not rebuild)

These are mature and the spec explicitly says to build on them:

1. **Credit ledger** (`credit-service.ts`) — atomic, idempotent, single source. Reuse as-is.
2. **Dodo webhook pipeline** (`dodo-webhook.ts`, `dodo-event-processing.ts`, `webhook-recovery.ts`) — verified, idempotent, full event handling. Extend for annual + plan-change events.
3. **Runtime metering** (`lib/runtime/metering/`) — preflight/charge/refund/record. Reuse as-is.
4. **Subscription vs permanent credit separation + consumption order + expiry** (`consume-plan.ts`, `credit-service.ts`) — reuse; extend with proactive scheduler.
5. **Build authorization** (`build-auth.ts`) — reuse.
6. **Admin DB-driven config layer** (`runtime-config.ts`, `app_settings`) — extend to cover plan prices + credit allocations.
7. **SEO audit, competition research, content studio, ad request/billing, founder learning paths, financial reporting** — real implementations; reuse and gate by plan.

---

## 3. What is missing (must build)

Grouped by spec phase:

**Phase 2 — Pricing & entitlement architecture:**
- New plan catalog (`Explorer/Starter/Growth/Scale/Enterprise`) with numeric entitlements (businesses, apps, subdomains, domains, hosting, DB, storage, credits, agents, marketing, membership, support).
- Centralized entitlement service (single source of truth consumed by all routes/jobs/runtime).
- Plan-ID migration strategy for existing subscribers (old `business`/`professional` → new `growth`/`scale`).
- Versioned pricing/entitlement history table.
- Grandfathering mechanism.

**Phase 3 — Subscription billing & Dodo:**
- Annual Dodo products + checkout + monthly credit issuance scheduler.
- In-place plan change/upgrade/downgrade route with proration.
- User-facing invoice/receipt/payment history.
- Billing notifications (email).
- Reconcile the duplicate plan layers (account subscriptions vs per-project infra plans).

**Phase 4 — Credits & usage:**
- Explorer 500 planning-only credits (usage-scoped, cannot be spent on production).
- Proactive subscription-credit expiry scheduler (not webhook-only).
- Annual monthly-credit-issuance scheduler.
- Per-plan contribution-margin cost model (the prerequisite for setting credit allocations — hard rule #1).
- Admin-configurable per-plan `mirrorCredits` (move from `config.ts` constants to `app_settings`).
- Fair-use caps / per-plan usage limits / overage handling.

**Phase 5 — Business, project & infrastructure limits:**
- Server-side business/project creation caps by plan.
- Explorer production gate (block build/deploy/hosting/DB/domains).
- Atai-owned free subdomain provisioning + count cap.
- Custom domain registration integration (registrar) + included-domain entitlement + eligibility + renewal disclosure.
- Real hosting/database/storage quota enforcement (replace dead `checkStorageLimit`).
- Priority compute for Scale.
- Account-level downgrade safeguards (over-limit enumeration, block new consumption, pre-downgrade warning, preserve data).

**Phase 6 — AI Co-founder, teams & agents:**
- Deep audit of `lib/cofounder/` (29 files) — confirm tiering/customization status.
- Confirm Agent Start / Scout / Optimize real implementation status. If absent, either build or do NOT advertise.
- Continuous application improvement (monitoring, diagnosis, authorized code mods, testing, deployment assistance, approval gates).
- Knowledge base (RAG, editing, retrieval, business context).
- Premium AI teams, smart team management, role customization.
- Plan-gating of all AI capabilities.

**Phase 7 — Marketing, education & BI:**
- Plan-gating of SEO/content/ads/competition/lessons/finances.
- Competition monitoring (scheduler) + comparison/diff view.
- AI business intelligence & analytics (currently `notInstrumented`).
- Multi-business BI comparison.
- Customer insights (currently `notInstrumented`).
- Marketing automation: scheduler/queue/worker substrate, connected accounts (OAuth), automated publishing with explicit authorization, social media management, AI marketing team coordination.
- Real ad platform integration OR keep manual model but separate third-party spend from subscription credits.
- Per-plan access control on lessons/resources/membership.
- Support tiering.

**Phase 8 — Pricing page & checkout:**
- New 5-plan pricing page with monthly/yearly toggle, Growth flagship emphasis, feature comparison table, Enterprise separately, responsive.
- Checkout experience for annual + plan changes.

**Phase 9 — Testing, security, financial validation:**
- Regression tests for plan migration, entitlement enforcement, downgrade safeguards, annual billing.
- Security verification (server-side enforcement on all routes).
- Per-plan contribution-margin validation (normal/heavy/expensive usage).

---

## 4. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Renaming/removing plan IDs breaks live subscriptions** — checkout metadata `planId` is persisted in Dodo; renewals resolve by `planId`; old IDs → `missing_plan` → `unresolved`, no grant. | **CRITICAL** | Migration strategy: map old→new IDs; grandfather existing subscribers on old entitlements; backfill `subscriptionRecordsCol`. No test currently pins plan IDs/prices. |
| R2 | **No entitlement enforcement at any layer** — free users can deploy production. | **CRITICAL** | Build centralized entitlement service (Phase 2) before touching pricing page. |
| R3 | **Credit allocations are invented, not cost-modelled** — hard rule #1 violation. | **HIGH** | Build per-plan contribution-margin model (Phase 4) before setting final `mirrorCredits`. |
| R4 | **Scale headline features not built** (Agent Start/Optimize, continuous improvement, marketing automation, knowledge base) — hard rule #3 violation if advertised. | **HIGH** | Either build (Phase 6–7) or omit from pricing page until built. Do not display as available. |
| R5 | **Duplicate/conflicting plan systems** (account subscriptions vs per-project infra plans, name collisions). | **HIGH** | Reconcile in Phase 2 — decide whether infra plans become plan entitlements or remain separate add-ons. |
| R6 | **Subscription credit expiry is webhook-only** — missed webhooks leave expired credits active. | **MEDIUM** | Add proactive expiry scheduler (Phase 4). |
| R7 | **`storageUsedBytes` never written** — `overQuota` permanently false; `checkStorageLimit` is dead code. | **MEDIUM** | Implement usage writer + wire `checkStorageLimit` (Phase 5). |
| R8 | **Misleading enforcement claims** — `database-terms/page.tsx` claims write-blocking that no code performs. | **MEDIUM** (legal) | Fix copy or implement the enforcement. |
| R9 | **Free subdomain is Totalum's domain**, not Atai's — no Atai-owned subdomain. | **MEDIUM** | Provision Atai-owned subdomain (Phase 5). |
| R10 | **No invoice/receipt/payment history** for users. | **LOW** | Build in Phase 3. |
| R11 | **Env drift** — `.env.example` lists stale `DODO_PRODUCT_PERM_*` keys vs `config.ts` pack IDs. | **LOW** | Sync env docs during Phase 3. |

---

## 5. Acceptance-criteria readiness (spec §18)

| Acceptance criterion | Ready? | Notes |
|---|---|---|
| All four subscription experiences exist | ❌ | New plan IDs don't exist. |
| Monthly and annual billing work | ❌ | Annual is absent. |
| Pricing matches approved commercial structure | ❌ | Different plans/prices. |
| Growth highlighted as flagship | ❌ | Badge on `business`. |
| Explorer cannot generate/publish production apps | ❌ | No gate. |
| Starter cannot create >1 business | ❌ | No cap. |
| Growth cannot create >4 businesses | ❌ | No cap. |
| Scale unlimited business creation (subject to infra) | ❌ (accidentally ∞ for all) | No cap for anyone. |
| Included custom domain entitlements work | ❌ | No registrar. |
| Credits allocated and consumed correctly | ⚠️ | Engine works; allocations not cost-modelled. |
| Annual subs receive monthly credit allocations | ❌ | No annual, no scheduler. |
| Runtime usage metered correctly | ✅ | Working. |
| AI agent access follows plan entitlements | ❌ | No gating. |
| Marketing automation follows plan entitlements | ❌ | No automation, no gating. |
| Hosting and database limits enforced | ❌ | Dead code. |
| Downgrades preserve customer data | ⚠️ | Partial (infra only). |
| Dodo subscription events synchronize correctly | ✅ | Working. |
| Admins can manage entitlements | ⚠️ | Partial (costs only). |
| Pricing fully responsive | ⚠️ | Exists but wrong content. |
| Existing applications and billing records not broken | ⚠️ | At risk if plan IDs renamed without migration. |
| Regression tests pass | ⚠️ | Existing tests pass but don't cover plan catalog/annual/entitlements. |

**Score: 2 ✅ / 8 ⚠️ / 12 ❌ out of 22.** Not ready for release.

---

## 6. Recommended next steps

1. **Approve this report** as the Phase 1 deliverable.
2. **Phase 2 first:** design the new plan catalog + centralized entitlement service + plan-ID migration strategy. This is the foundation — nothing else can be done safely without it.
3. **Phase 4 cost model in parallel with Phase 2:** build the per-plan contribution-margin model so credit allocations are evidence-based, not invented (hard rule #1).
4. **Decide on Scale features:** for each of Agent Start / Scout / Optimize / continuous improvement / marketing automation / knowledge base — either commit to building (Phase 6–7) or exclude from the pricing page (hard rule #3). Do not advertise unfinished features.
5. **Reconcile the duplicate plan systems** (account subscriptions vs per-project infra plans) before implementing entitlements.
6. **Do not touch the credit ledger, Dodo webhook pipeline, or Runtime metering** — extend them, don't replace them (hard rule #4).

---

## 7. File path index (key files)

**Billing & credits:**
- `lib/billing/config.ts` — plan catalog, cost model, credit types (REPLACE plan list, KEEP ledger types)
- `lib/billing/credit-service.ts` — credit ledger (KEEP)
- `lib/billing/consume-plan.ts` — consumption order (KEEP)
- `lib/billing/dodo-webhook.ts`, `dodo-event-processing.ts`, `webhook-recovery.ts` — Dodo pipeline (KEEP, EXTEND)
- `lib/billing/activate-subscription.ts`, `build-auth.ts`, `runtime-config.ts` (KEEP, EXTEND)
- `lib/runtime/metering/` — metering (KEEP)

**Infrastructure (conflicting layer):**
- `lib/infrastructure/plans.ts`, `service.ts`, `costs.ts`, `audit.ts` — per-project infra plans (RECONCILE)

**Creation & limits:**
- `lib/projects/create-project.ts` — no caps (ADD caps)
- `app/api/projects/[id]/deploy/route.ts`, `domain/route.ts`, `build/route.ts`, `fork/route.ts` — no plan gates (ADD gates)

**AI & marketing:**
- `lib/cofounder/` (29 files) — needs Phase 6 deep audit
- `lib/marketing/seo/`, `competition-research.ts`, `studio/`, `ads/`, `campaigns/`, `tasks/` — real but ungated
- `lib/lessons/paths.ts`, `paths-store.ts`, `curriculum.ts` — real but ungated

**Pricing UI:**
- `app/pricing/page.tsx`, `components/billing/plan-card.tsx` — rebuild for new plans

**Admin:**
- `app/api/admin/billing/configuration/route.ts` — extend for entitlements
- `app/admin/billing/plans/page.tsx` — extend

**Docs (baseline, may be stale):**
- `docs/CREDIT_SYSTEM.md`, `docs/CURRENT_STATUS.md`, `docs/DATABASE_SCHEMA.md`, `docs/SYSTEM_OVERVIEW.md`
- Root: `STATUS.md`, `CHANGELOG.md`, `HEAVY_MODE_PRICING_IMPLEMENTATION.md`, `PHASE_10_CAPABILITY_MATRIX.md`, `audit-phase1.md`, `atai-phase2-audit.md`

---

*This report is the Phase 1 deliverable. No code was modified. Development should not begin until this report is approved and Phase 2 (pricing & entitlement architecture) is designed.*
