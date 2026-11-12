# 2. Current Codebase Baseline

> **Purpose:** establish what actually exists in the repository before any judgment about the product. Every number below was produced from source on 2026-11-09, not from README claims.

## 2.1 Stack and runtime

| Item | Observed |
|---|---|
| Framework | Next.js 16.3.3, App Router (`package.json`, `app/`) |
| UI | React 19, Tailwind 4, shadcn/base-ui, lucide-icons, recharts, sonner/react-hot-toast |
| Language | TypeScript 5.7.3 |
| Database | MongoDB 7 driver; database module `lib/db/mongodb.ts`; no ORM |
| Auth | Custom session cookies (`lib/auth/session.ts`), Google + GitHub OAuth routes, bcrypt passwords, hashed session tokens |
| Payments | Dodo Payments (`dodopayments` SDK, `lib/billing/`), Standard Webhooks verification |
| App builder | Totalum (`lib/integrations/totalum/`); **the only app generator/deployer in the repo** |
| AI provider | OpenRouter through `@ai-sdk/openai-compatible`; one shared `MODEL` (`lib/analysis/model.ts:20-24`) |
| Runtime gateway | `app/api/runtime/v1`, `lib/runtime/`, `runtime/contracts/` |
| SDK | `packages/atai-sdk` (+ installed `@atai-group/sdk`) |
| Tests | Vitest; 207 test files exist locally but are **gitignored** (`**/*.test.ts`, `.gitignore`) |
| Jobs | No cron, queue, worker, BullMQ, QStash or scheduler. Long work runs in-request or as fire-and-forget promises. |

## 2.2 Reproducible inventory

```bash
find app -name "page.tsx" | wc -l              # 116
find app/api -name "route.ts" | wc -l          # 173
find app -name "layout.tsx" | wc -l            # 4
grep -rl '"use server"' app lib --include="*.ts" --include="*.tsx" | wc -l   # 0 server actions
find . \( -name "*.test.ts" -o -name "*.test.tsx" \) | grep -v node_modules | wc -l  # 207
grep -rln "cron\|bullmq\|agenda\|qstash" package.json lib app --include="*.ts" --include="*.tsx" | wc -l  # 0
```

**API route families (173 total):** projects 71, admin 39, auth 16, billing 14, runtime 5, public 5, me 3, feature-requests 3, internal 2, health 2, cofounder 2, plus single routes for users, user, start, settings, referrals, lessons, github, finances, explore, credits, credit-costs.

**Page families (116 total):** project workspace 32, admin 29, settings 6, developers 5, new 4, resources 3, lessons 3, feature-requests 2, plus one page each for dashboard, projects, finances, market, ads, competition, hosting, notifications, billing, pricing, docs, explore, start, etc.

**Server actions:** none. All mutations are API routes; UI clients call them directly.

## 2.3 Architecture

```text
Browser (React 19 client components)
  │
  ├─ Next.js App Router pages (116) ─────────────── server components read Mongo via lib/store
  │
  ├─ /api/* (173 route handlers)
  │     ├─ auth/session (lib/auth)
  │     ├─ projects/* → lib/projects, lib/analysis (pipeline), lib/planning
  │     │                  └─ Totalum (build/deploy/domain/versions/logs)
  │     ├─ runtime/v1 → lib/runtime (auth → limits → router → adapters → metering)
  │     │                  └─ OpenRouter, ElevenLabs, Firecrawl, Resend, Supabase,
  │     │                     Mapbox, Cal.com, Cloudflare, Totalum, Dodo, Analytics
  │     ├─ billing/* → Dodo checkout + webhook → lib/billing/credit-service (ledger)
  │     ├─ cofounder/* → lib/cofounder (tool-calling agent + pending actions)
  │     └─ cofounder actions/* → approval endpoint → tool.execute()
  │
  ├─ MongoDB (49 collections; indexes created at runtime in lib/db/collections.ts)
  └─ External: Totalum, Dodo, OpenRouter, Firecrawl, GitHub, ImageKit, OAuth providers
```

**Ownership model:** almost every domain document is scoped by `userId` (and often `projectId`). The runtime adds `projectId + environment + apiKeyId`. There is no organisation/team account concept.

## 2.4 Data model — 49 collections

Grouped from `lib/db/collections.ts` and `lib/db/runtime-collections.ts`. **There is no collection for customers, leads, orders, invoices, expenses, staff, tasks (business), or documents.** The only task/campaign records are founder-facing marketing plans.

| Domain | Collections | Notes |
|---|---|---|
| Identity & access | `users`, `sessions`, `verification_tokens`, `rate_limits` | session token hashed; TTL indexes on tokens/limits |
| Projects & builds | `projects`, `build_runs`, `project_assets`, `project_attachments`, `publish_events`, `planning_runs`, `project_github`, `project_forks`, `project_likes`, `user_follows` | plan/spec/conversation/aiArtifacts are **embedded** in `projects` |
| Credit & money | `credit_ledger`, `build_authorizations`, `payment_records`, `subscription_records`, `topups`, `webhook_events`, `provider_usage` | ledger is double-entry style with unique `idempotencyKey` |
| AI & co-founder | `cofounder_conversations`, `cofounder_pending_actions`, `project_chats`, `planning_runs` | no memory/embedding collection |
| Marketing & growth | `seo_audits`, `content_items`, `brand_profiles`, `growth_tasks`, `growth_task_history`, `campaigns`, `campaign_history` | all link-only by `projectId`; no execution/scheduling records |
| Learning | `resources`, `lessons`, `business_lessons`, `learning_paths`, `lesson_categories`, `user_lessons` | generic curriculum + per-project AI packs |
| Community | `feature_requests`, `feature_request_votes`, `feature_request_status_history`, `feature_request_updates`, `feature_request_internal_notes`, `doc_feedback`, `referrals` | concern Atai itself, not the founder's customers |
| Runtime | `api_keys`, `runtime_usage`, `project_runtime_config` | key hash only; usage carries provider cost |
| Analytics | `analytics_events` | first-party app events, 90-day TTL |
| Cache | `firecrawl_cache` | 7-day TTL |

**Embedded (not separate collections):** project specification/plan sections, `conversation`, `aiArtifacts`, `deploymentHistory`, `buildSummary`, `infrastructure`, `runtimeProvisioning`, `analyticsConsent`, `creditBlock`, `planAnalysis`, `planUpdateNotes`. Embedding means the plan and its history are only reachable through the project document.

**Indexes:** created idempotently on first request (`ensureIndexes`, `lib/db/collections.ts:293-661`), in batches to avoid connection-pool exhaustion. Unique constraints include project id, credit idempotency key, Dodo payment/subscription/webhook ids, brand-profile-per-project.

## 2.5 AI systems inventory

| Surface | Entry | Model | Context | Persistence |
|---|---|---|---|---|
| Workspace co-founder agent | `app/api/cofounder/route.ts` → `lib/cofounder/agent.ts` | shared `MODEL` | compact project brief, plan one-liners, credits, build state, consent | `cofounder_conversations` (200 msgs) |
| Project plan chat (Collaborate) | `app/api/projects/[id]/plan-chat/route.ts` → `lib/analysis/cofounder.ts` | shared `MODEL` | full focus/related plan sections, findings, 15 decisions, 12 messages | `project_chats` + `project.conversation` |
| Planning pipeline | `lib/planning/orchestrator.ts` | per-stage ids, default `openrouter/auto` | serialized previous stage | `planning_runs` + project spec |
| Plan analysis / autocomplete | `lib/analysis/plan-analysis-service.ts` | shared `MODEL` | spec + findings | cached on project |
| Lessons | `lib/lessons/generate.ts` | shared `MODEL` | plan context + Firecrawl/YouTube grounding | `business_lessons` |
| Market research / competitors resources | `app/api/projects/[id]/resources/*` | shared `MODEL` | idea + plan, **no web grounding** | cached on project |
| Marketing Studio | `lib/marketing/studio/**` | shared `MODEL` | deterministic brand profile | `content_items`, `brand_profiles` |
| SEO recommendations | `lib/marketing/seo/**` | shared `MODEL` (temp 0.2) | deterministic Firecrawl audit | `seo_audits` |
| Build narration | `lib/build-messages.ts` | **no model** | time-based template bank | none |

**Verdict:** there is **one model with role prompts and a sequential stage pipeline**, not a multi-agent system. No agent-to-agent messaging, delegation, shared scratchpad, embeddings or long-term memory.

## 2.6 Runtime gateway inventory

- **Capabilities routed** (`runtime/contracts/router.ts:106-143`): `ai.text`, `ai.embed`, `ai.speak`, `ai.image`, `ai.video`, `ai.speech`, `ai.transcribe`, `ai.vision`, `search.web`, `web.scrape`, `email`, `notifications`, maps operations, `calendar`, `vectors`, `db`, `analytics`, `payments` (4 ops), `test`. `auth` and `storage` appear in the capability list but are **not routed**.
- **Adapters** (`lib/runtime/router/adapters/register-all.ts`): OpenRouter, ElevenLabs, Firecrawl, Resend, Supabase, Mapbox, Cal.com, Cloudflare, Totalum, Dodo, Analytics.
- **Auth**: `atai_<env>_<secret>` keys, SHA-256 hash only, expiry, scopes, rate limit 300/min/key, 20 failed auth/5 min (`lib/runtime/auth/authenticate.ts`).
- **Metering**: admin pricing rules → legacy fallback → deny if unconfigured (`lib/runtime/metering/resolver.ts`); fail-closed delivery (`router.ts:297-314`).
- **Provisioning**: generated app gets `ATAI_API_KEY` injected into Totalum secrets with **all routed scopes except `test`** (`lib/runtime/provisioning/service.ts:83-85`).

## 2.7 Billing inventory

- Ledger core: `lib/billing/credit-service.ts` (grant/reserve/consume/refund/expire, bucket-aware subscription vs permanent credits, idempotency keys).
- Dodo webhook: HMAC verification (`lib/billing/dodo-webhook.ts`), event dedupe, `webhook_events`, recovery worker logic (`webhook-recovery.ts`) triggered **only by an admin POST**.
- Checkout: server-side catalog pricing (`app/api/billing/checkout/route.ts`), rate limit + per-user lock.
- Top-ups: legacy Mobile Money path returns 410; only checkout is live.
- Admin billing: overview, configuration, reconciliation, ledger, payments, transactions, webhooks, audit logs.
- Finance projections: `lib/finances/**` (credits vs provider USD cost vs attributed Dodo payments), explicit "not recognized revenue" and no FX invention.

## 2.8 Integrations

| Integration | Purpose | Status |
|---|---|---|
| Totalum | build, deploy, domains, versions, logs, secrets, DB | real service wrapper; all app generation depends on it |
| Dodo Payments | checkout, subscriptions, webhook, payments/payouts reads | real; read feeds are account-wide (see §8/§9) |
| OpenRouter | all AI text/image/video/speech | real; free-model pins in env |
| Firecrawl | website crawl, SEO audit, lesson grounding | real, cached |
| GitHub | repo metadata/readme/tree, OAuth | real, shallow (no code ingestion) |
| ImageKit | media | real |
| Google/GitHub OAuth | sign-in | real |
| Resend | runtime email | adapter gated by env |
| Supabase | runtime notifications | adapter gated by env |
| Mapbox | runtime maps | adapter gated by env |
| Cal.com | runtime calendar | adapter gated by env |
| Cloudflare | embeddings/vectors | adapter gated by env |
| ElevenLabs | speech | adapter gated by env |

## 2.9 Admin surface (19 route dirs / 39 API routes)

Billing (overview, configuration, reconciliation, webhooks, user billing), ledger, payments, transactions, users, referrals, cancellations, dodo-products, feature requests, feedback, infrastructure, planning runs, runtime (pricing, usage, financials), tools, lessons, resources, learning. All server-guarded by `requireAdmin` or an inline `isAdmin` check.

## 2.10 Analytics & observability

- First-party app analytics: `analytics_events` + runtime `analytics.track/summary`. **No founder UI renders it**; only the co-founder tool reads it, behind operator flag + per-project consent (default off).
- Platform analytics: Vercel Analytics on the marketing site; `lib/analytics/start-funnel.ts` instruments Atai's own `/new` funnel.
- Logging: `lib/logging/logger.ts` with key/value redaction. No metrics, error tracker, alerting or dashboards for runtime/billing failures.
- Health: `/api/health` and authenticated `/api/runtime/v1/health`. No deep readiness check (Mongo/provider reachability not probed).

## 2.11 Testing baseline

- 207 test files under `app/`, `lib/`, `components/`, `packages/atai-sdk/tests` — **all gitignored**, so a clean clone has zero tests and no CI configuration in the repo.
- Coverage concentrates on credits, runtime routing/auth, webhooks, project lifecycle, planning parsing, marketing services and UI panels.
- The suite was not run for this audit; historical context: ~2,400 cases green on 2026-11-08 (not revalidated here).

## 2.12 Major unfinished / placeholder areas

| Area | Evidence | State |
|---|---|---|
| Global hosting overview | `app/hosting/page.tsx:1-11` → `ComingSoonPage` | placeholder |
| Global market / ads / competition | `app/market/page.tsx`, `app/ads/page.tsx`, `app/competition/page.tsx` → `ComingSoonPage` | placeholder |
| Runtime `auth` and `storage` capabilities | listed in contracts, absent from `CAPABILITY_OPERATIONS` | missing |
| Founder payout / connected merchant | Dodo adapter is account-level; no per-founder merchant mapping | missing |
| CRM / orders / invoices / expenses | no collections or routes | missing |
| Job substrate / scheduler | no queue/cron; self-documented absent | missing |
| GitHub code ingestion into builder | zip URL passed as prompt text only | partial |
| Onboarding checklist | `components/onboarding-checklist.tsx` has no importers | dead code |
| Global nav duplicate | `components/workspace/atai-sidebar.tsx` has no importers | dead code |
| `autoLaunchBuild` from idea/website funnels | only called by `/api/projects/[id]/launch` | disconnected |

## 2.13 Technical debt signals

- Two credit mutation paths: the ledger-first `credit-service` (stable keys) and legacy wrappers that mint a fresh `cryptoId()` per retry (`lib/credits/credits.ts`, `lib/store/mongo-store.ts:88-148`).
- Two navigation systems and three vocabularies for "business/project/workspace/product".
- Pricing displayed in the UI and pricing used by the two build paths disagree (see §4/§6).
- Embedded plan/conversation documents in `projects` make history and multi-surface context harder to query; no versioning beyond `planUpdateNotes`.
- Numerous local scratch artifacts at repo root (`.tmp-*`, `.tsbuildinfo`, logs) and `.env`/`.env.local` in the working tree.
- `provider_cost` aggregation in `app/api/admin/runtime/financials` lacks the USD filter enforced in four other finance modules.
