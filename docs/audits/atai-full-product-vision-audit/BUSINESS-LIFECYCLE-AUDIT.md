# 4. Business Lifecycle Audit

> This document audits each stage as a **complete user journey**, not as a page inventory. Severity reflects user/business impact: P0 = core promise or money, P1 = major blocker, P2 = significant friction, P3 = polish.

## 4.1 START — discovery, validation, planning

### What happens today (traced)

1. The founder submits an idea, URL or GitHub repo on `/new/*` or the landing composer.
2. `POST /api/projects` → `createUserProject` validates the source, applies idempotency/dedupe, stages attachments, persists the project, then fires `void startProjectPipeline(project.id)` without awaiting (`lib/projects/create-project.ts:176,211,231`).
3. Scratch: straight to specification. Website: Firecrawl crawl → LLM understanding → spec. GitHub: README + tree → spec.
4. The planning orchestrator runs research → planner → critic → repair → validator → sanitizer, then persists the spec and sets `specification_ready`/`plan_ready` (`lib/planning/orchestrator.ts:126,426,637-641`).
5. **The pipeline stops at a plan.** `autoLaunchBuild` is only called from `app/api/projects/[id]/launch/route.ts:50` (and referenced but unused in `github-pipeline.ts:7`). A founder must review and explicitly build.

**Verified positive:** the UI's promise "Atai plans first — nothing is built until you approve the plan" is honoured (`app/new/idea/page.tsx`; `app/api/projects/[id]/launch/route.ts`). This is a deliberate and defensible product choice.

### Findings

**ST-1 (P0) — Market and competitor "research" is model prior presented as research.**
- Expected: evidence of demand, market size, competitor set, differentiation.
- Actual: `lib/planning/stages/research.ts` is a text-only LLM gap analysis with no search/tool calls; on failure it returns empty findings and the pipeline continues. `lib/marketing/competition-snapshot.ts:6-15` states outright that Atai "does not collect live market or competitor data anywhere"; the competitor resource route uses model memory and no web search. The market-research resource route is credit-charged with no grounding.
- Impact: a founder can pay for confident, fabricated market claims. This is the single largest trust risk in the START stage and contradicts the "intelligent business partner" promise.
- Evidence: `lib/planning/stages/research.ts`; `lib/marketing/competition-snapshot.ts:6-15`; `app/api/projects/[id]/resources/market-research/route.ts`; `app/api/projects/[id]/resources/competitors/route.ts`.
- Resolution: separate "AI hypotheses" from "evidence"; ground research in real sources (search, crawl, public data) with citations, or stop charging for it and label it clearly as a starting hypothesis.

**ST-2 (P1) — The plan is not a business case.**
- Expected: target customer, problem, demand, competitors, differentiation, viability, revenue, costs, pricing, milestones/roadmap, risks.
- Actual: 19 structured sections cover vision, target users, roles, marketing, features, flows, data, auth, admin, backend, integrations, design, SEO, business model, revenue model, runtime integrations and pricing. **There is no first-class costs, unit economics, risks, goals, milestones/roadmap or launch plan section** (`lib/analysis/plan-sections.ts`).
- Impact: the founder receives an application specification, not an investable or operable business plan. Downstream modules cannot reason about costs or risks because the data does not exist.
- Evidence: `lib/analysis/plan-sections.ts` ids; `lib/types/specification.ts:1-152`.

**ST-3 (P1) — GitHub "extend" does not ingest the code.**
- Expected: understand an existing repository and extend it.
- Actual: README + file-tree only; extend mode passes `githubZipUrl` as *text inside the prompt* (`lib/analysis/github-pipeline.ts:266-333`). The builder never fetches, parses or embeds the code.
- Impact: "bring your existing product" is a headline promise that reduces to summarising a README.
- Evidence: `lib/analysis/github-pipeline.ts:181-248,266-333`; `autoLaunchBuild` imported but uncalled at line 7.

**ST-4 (P1) — The initial run has no durable execution.**
- Expected: analysis/planning completes even if the founder closes the tab.
- Actual: the pipeline is started fire-and-forget inside the request; completion is observed by polling. `recoverStalledPipeline` only runs when some route is hit; a 45-second `created` window is aggressive (`lib/projects/pipeline-recovery.ts:328-374`). A crash or cold start can strand a project until the user returns and *something* triggers recovery.
- Impact: silent stalls, duplicate retries, support load.
- Evidence: `lib/projects/create-project.ts:176,211,231`; `lib/projects/pipeline-recovery.ts`; no queue/cron in repo.

**ST-5 (P2) — Failure handling is state-only.**
- Expected: clear diagnosis and a one-click recovery.
- Actual: failures set `analysis_failed`/`plan_failed` and a message; auto-retry is capped at one (`runWithAutoRetry`), and manual retry dispatches per state (`retryProjectStep`). There is no notification, alert or background recovery.
- Evidence: `lib/analysis/pipeline.ts:50-68`; `lib/projects/pipeline-recovery.ts:171-223,378-450`.

### Critical question — does Atai understand the business after START?

**Partially.** It stores a structured application specification (vision, users, features, revenue, pricing) and can inject it into the co-founder and plan chat. It does **not** store validated market facts, competitors, costs, risks, goals or a business model with unit economics. The "understanding" is an app spec plus founder prose, not a business knowledge base. Downstream modules each re-project a subset (see §7), so consistency is limited.

---

## 4.2 BUILD — creation and digital infrastructure

### What happens today (traced)

- `startProjectBuild` / `POST /build` classify complexity, rate-limit (5/hour), reserve credits, atomically claim the build slot, call Totalum `launchProject`, initialise infrastructure, and refund on failure (`lib/projects/project-actions.ts:103-203`).
- Totalum is the sole builder. The build brief is one long prompt mandating Next.js/Tailwind/Totalum SDK, auth, admin console, marketing, runtime integrations and the `ATAI_API_KEY` contract (`lib/analysis/prompt-builder.ts:246-405`).
- Progress is polled from `/api/projects/[id]/status`, which syncs the Totalum agent, sets `build_complete`, captures a summary, and refunds on failure (`app/api/projects/[id]/status/route.ts:504-550`).
- Follow-up edits call the Totalum agent with a capping/instruction prompt (`lib/projects/project-actions.ts:220-307`; `FOLLOWUP_PROMPT_MAX = 12_000`).

### Findings

**BU-1 (P0) — The same build is billed two different prices.**
- Expected: one advertised price for one action.
- Actual: the automated pipeline calls `getTierCost(tier, "heavy")`, scaling the base by the heavy/legacy ratio (~2×), so a simple build is 100,000 credits (`lib/analysis/pipeline.ts:135`; `lib/credits/credits.ts:62-73`). The manual `/build` route calls `getBuildCost(tier)` (flat, 50,000) (`app/api/projects/[id]/build/route.ts:77`). The pricing page advertises 50,000 (`app/pricing/page.tsx:27,329`).
- Impact: the first charge a founder sees can be double the advertised price, and the same action costs different amounts by entry point. This is a consumer-trust and support problem, not just a bug.
- Evidence: cited above; default pipeline mode is forced to `heavy` in `lib/projects/continue-start.ts:10` and `lib/projects/create-project.ts:120`.

**BU-2 (P1) — "Production-ready" is a prompt claim, not a verified property.**
- Expected: generated apps are tested, secure and operable.
- Actual: one long Totalum prompt; no test generation, CI, staging, security scan, dependency audit or acceptance check. Atai cannot inspect the generated code (`getFiles` throws `documentationPending`).
- Impact: apps can look complete in preview and fail in production; Atai cannot detect or attest otherwise.
- Evidence: `lib/analysis/prompt-builder.ts:246-405`; `lib/integrations/totalum/service.ts` (`getFiles` unsupported); no CI/tests for generated apps.

**BU-3 (P0) — A generated business cannot collect its own money.**
- Expected: the app sells, the founder receives the funds.
- Actual: Dodo checkout uses Atai's platform credentials and a single default product id; the adapter documents that payouts settle to the **Atai-owned** Dodo account (`lib/runtime/router/adapters/dodo/mapper.ts:416-420`; `lib/runtime/router/adapters/dodo/config.ts`). There is no connected account, revenue split or payout tool.
- Impact: the most important outcome of a "digital business" — receiving revenue — is not implemented. Finance can *report* attributed payments but cannot deliver them.
- Evidence: cited above; confirmed independently in §8 and §9.

**BU-4 (P1) — Auth and storage are promised but not provided by the runtime.**
- Expected: generated apps get login and file uploads from Atai.
- Actual: `auth` and `storage` appear in `CAPABILITY_IDS` but are absent from `CAPABILITY_OPERATIONS`, so they cannot be routed (`runtime/contracts/router.ts:106-143`). The build brief tells apps to use Atai for infrastructure, creating a contradiction for any app needing accounts or uploads.
- Impact: apps must bring their own auth/storage (or rely on opaque Totalum scaffolding), undermining the "no external providers" promise.
- Evidence: `runtime/contracts/router.ts:106-143`; `lib/analysis/runtime-capabilities.ts`.

**BU-5 (P1) — Source-code access is indirect.**
- Expected: own your code.
- Actual: `/source` redirects to a signed Totalum URL; `/export` returns project JSON, not source. There is no tarball, GitHub push or repo handoff.
- Impact: lock-in perception and real migration friction.
- Evidence: `lib/integrations/totalum/service.ts:82`; `app/api/projects/[id]/export/route.ts`.

**BU-6 (P2) — Build progress includes fabricated team narration.**
- `lib/build-messages.ts` states "Usability team tested … with 200 real users" (line 393), "Business Strategy team modeled … unit economics" (401), "Competitive Strategy team … war-gamed … every known competitor" (408), shown during builds with no disclaimer (`components/workspace/build-stage-overlay.tsx`). These events did not happen.
- Impact: misrepresentation and a credibility risk if a customer or regulator reads it. Fix the copy or add an unmistakable "illustrative" label.
- Evidence: `lib/build-messages.ts:393,401,408`; overlay component.

### Build boundary with Totalum and Atai Runtime

**Verified:** Atai Runtime does **not** generate applications. It is a metered capability gateway that generated apps call (`app/api/runtime/v1`). Totalum generates and hosts. Provisioning injects an `ATAI_API_KEY` into Totalum secrets on deploy/status rails (`lib/runtime/provisioning/service.ts:158,276-280`). Compatibility with existing Totalum apps is preserved by continuing to use Totalum APIs and its database adapter.

---

## 4.3 LAUNCH — hosting, deployment, publishing

### Findings

**LA-1 (P1) — Publishing is real but completion is poll-driven.**
- `POST /deploy` claims the deployment, charges credits, calls Totalum, records deployment history and a publish event, and provisions the production runtime (`app/api/projects/[id]/deploy/route.ts:1-364,240`). However, status/deployment completion is observed by polling. With no scheduler, a deploy whose tab closes can remain unresolved until a poller hits the route.
- Evidence: deploy/status routes; `lib/billing/webhook-recovery.ts:41-44` (self-documented absence of a job substrate).

**LA-2 (P2) — Failed deploy recovery is manual.**
- On failure the project returns to `ready`; there is no automatic rollback to the last successful version. Rollback exists via `recoverVersion` but must be chosen by the user.
- Evidence: `lib/projects/project-actions.ts:320-423`; `app/api/projects/[id]/recover/route.ts`.

**LA-3 (P2) — Global hosting is a placeholder.**
- `app/hosting/page.tsx:1-11` renders `ComingSoonPage`; only per-project hosting exists.
- Impact: the global "Hosting" nav item is a dead end.

**LA-4 (P2) — Custom domains are delegated, not verified end-to-end.**
- The route returns DNS records and calls Totalum; SSL is implied by Totalum but never configured or checked by Atai. Marked INFERRED.
- Evidence: `app/api/projects/[id]/domain/route.ts:1-92`.

**LA-5 (P2) — No cost/usage visibility for hosting.**
- The project type models infrastructure credits/storage (`InfrastructureSubscription`), but there is no founder-facing hosting cost/usage surface comparable to the runtime finance view.
- Evidence: `lib/types/project.ts:154-183`; no hosting usage route found.

---

## 4.4 RUN — daily business operations

**What exists:** a build-control workspace, raw generated-app database browsing/editing, derived notifications, a marketing to-do list, and feature requests for Atai itself.

**What does not exist:** customers, leads, orders, invoices, expenses, staff, support conversations, business documents, recurring activities or business reminders. There is no collection for any of these (`lib/db/collections.ts`).

**RUN-1 (P0) — There is no business system of record.**
A founder cannot record a customer, an order, an invoice, an expense or a staff member anywhere in Atai. The "Database" tab proxies the generated app's tables (`app/api/projects/[id]/database/tables/route.ts:15-22`), which is raw CRUD without CRM semantics. This is the defining RUN/MANAGE gap.

**RUN-2 (P1) — The Workspace is a build console, not an operating room.**
The home project surface shows build/launch/hosting steps and "product health" flags that are infrastructure states (`lib/workspace/workspace-view-model.ts:625-684`). No revenue, customers, orders, spend or tasks. A returning founder cannot answer "how is my business doing today?".

**RUN-3 (P1) — Notifications are not delivered.**
The inbox is built client-side from project, credit and feature-request state; read/dismissed state is localStorage (`lib/dashboard/view-model.ts:360-385`; `lib/dashboard/notifications-store.ts:12-24`). There is no notification collection, email/in-app delivery or event-driven alerting.

**RUN-4 (P1) — "Tasks" are marketing to-dos; nothing executes.**
`growth_tasks` is a manual list with status/priority/due and an audit trail. The service states it is not a scheduler and nothing runs on a timer (`lib/marketing/tasks/service.ts:5-12`). There is no internal workflow engine.

**RUN-5 (P2) — Team collaboration is absent.**
No organisation, membership, roles or staff model. "Team progress" is a projection of build workstreams, explicitly "not separate hired agents" (`components/workspace/team-progress.tsx:365`; `lib/workspace/progress-view-model.ts:9-11`).

---

## 4.5 MANAGE — business intelligence and financial management

### What exists (verified)

- Project and portfolio credit consumption, provider USD cost with an honest four-state availability vocabulary (`lib/finances/cost-status.ts`).
- Attributed Dodo earnings filtered by `_ataiProjectId` (`lib/finances/dodo-earnings.ts:14-30`).
- OLS projections labelled ESTIMATE with insufficient-data states (`lib/finances/project-finances.ts:469-520`); ARR/valuation from dominant-currency subscriptions only (`:547-600`).
- Explicit refusal to net mixed currencies or invent FX (`lib/finances/net-position.ts:47-61`); `recognizedRevenue: not_supported` (`project-economics.ts:446-448`).
- Admin reconciliation with 17 finding types, read-only by construction.

### Findings

**MA-1 (P0) — "Business finances" is an infrastructure bill, not a P&L.**
A founder can see credits spent and runtime-attributed payments. They cannot record revenue, expenses, payroll, rent or any non-runtime cost, so there is no P&L, cash-flow statement or budget. No POST/PATCH exists under `app/api/finances` (only `summary`). The page title overstates what is measured (`components/finances/platform-finances-view.tsx:56`).

**MA-2 (P1) — The four money domains are separated in code but conflated in naming.**
Credits, provider cost, attributed app earnings and Atai platform revenue are distinct in `lib/finances/*`. The founder-facing label "Business finances / Your whole business in numbers" invites them to read runtime spend as their business's finances. Merchants also cannot take delivery of attributed earnings (no payouts).

**MA-3 (P1) — Profitability cannot be computed from the data.**
Without costs and manual revenue, "am I profitable?" is unanswerable except in the narrow sense of "did runtime-attributed payments exceed runtime credits/provider cost?" `recognizedRevenue: not_supported` is honest, but it means the promised business-intelligence layer has no input.

**MA-4 (P1) — Financial goals and reports are missing.**
No goals, budgets, categories or statements. Only projections and an operator reconciliation tool.

**MA-5 (P2) — One money aggregate mixes currencies.**
`app/api/admin/runtime/financials/route.ts` sums `providerCost` without a USD filter; four other finance modules enforce the filter and a structural test guards them but not this route, so the defect is invisible to CI.

**MA-6 (P2) — Reconciliation is manual and operator-only.**
Webhook/credit reconciliation exists but runs only when an admin posts to the recovery route; there is no scheduled reconciliation or alert on unresolved events.

---

## 4.6 GROW — marketing, sales and customer acquisition

### What exists (verified)

- Marketing Studio drafts (landing hero, feature blurb, welcome email, ad headline) with immutable versions and proposal-only refinement.
- A real bounded SEO audit of the project's own deployed URL (SSRF-closed), deterministic rules, credits with refund.
- Campaign plans (objectives/channels/budget) and growth tasks as manual records.
- Growth overview with 5 of 9 metrics honestly `not_instrumented`.

### Findings

**GR-1 (P0) — No growth workflow actually reaches a customer.**
Nothing publishes, sends, posts, schedules or spends. The ads page says every piece is a draft copied by hand (`app/project/[projectId]/ads/page.tsx:10-14`); campaigns "never spend" (`lib/marketing/campaigns/service.ts:10-15`); the calendar is intent only (`lib/marketing/studio/library.ts:9-12`). There is no email marketing, social publishing, ad-platform integration, lead capture or sales pipeline.

**GR-2 (P1) — Outcome tracking is absent.**
With no visitor, payment or conversion instrumentation in the founder UI, a founder cannot tell whether an AI recommendation worked. Five growth metrics are `not_instrumented`; the UI still renders all nine cards, so most of the grid reads "not measured yet" (`lib/marketing/growth-overview.ts:507-565`).

**GR-3 (P1) — Market and competition are AI drafts, not intelligence.**
See ST-1. The competition page is explicitly plan-text + AI hypothesis.

**GR-4 (P1) — Discoverability contradicts availability.**
Project Ads and Competition are implemented but badged "Soon" in `components/workspace/atai-nav.ts:75,79`; global `/ads`, `/market`, `/competition` are `ComingSoonPage`. Campaigns and Tasks have no sidebar entry at all (reachable only through co-founder navigation). Growth features default off (`lib/marketing/feature-flags.ts`), so a new founder may not see them at all.

**GR-5 (P2) — Content and campaigns are disconnected.**
`content_items` and `campaigns` have no link; a campaign cannot reference its creative, and planned budget is never reconciled with any spend source.

---

## 4.7 IMPROVE — application intelligence

### What exists (verified)

- Runtime health metrics (requests, failure rate, p50/p95) from `runtime_usage`.
- First-party app event ingestion via the `analytics` runtime capability (`track`/`summary`), stored in `analytics_events` with 90-day TTL.
- Per-project consent default off; operator flag; the co-founder `get_product_analytics` tool is triple-gated.
- A strong metric-trust vocabulary (`available`, `measured_zero`, `unavailable`, `not_instrumented`).

### Findings

**IM-1 (P0) — The intelligence capability is invisible, and the page says it does not exist.**
`lib/intelligence/overview.ts:334-337` states "Atai does not collect events from your generated app yet", but ingestion is implemented (`lib/runtime/router/adapters/analytics/adapter.ts:23-48`; `analytics_events`). No founder UI renders the analytics summary; the co-founder tool is the only consumer. The product both under-claims and hides the one differentiated improvement signal it has.

**IM-2 (P0) — "Why are users abandoning registration?" cannot be answered.**
The summary aggregates by event **name** only (`adapters/analytics/store.ts:47-56`). There are no ordered funnels, step drop-off, property breakdowns, session/path reconstruction, retention or cohorts. No funnel/journey code exists. Counts, unique/returning visitors and top events are the honest limit.

**IM-3 (P1) — No app-side error or performance capture.**
Platform runtime failures are counted, but the generated app's client/server errors, slow pages or broken flows are not. Application health is therefore unknown.

**IM-4 (P1) — Recommendations are not grounded in app behaviour.**
The AI can advise from the plan and runtime metrics, but not from user journeys, feature usage, errors or conversion. "What should I improve this week?" is generic advice.

**IM-5 (P2) — Metrics and insight surfaces are disconnected.**
`analytics_events` is read only by the co-founder tool; Intelligence and Growth each declare visitor/payment data uncollected. Finance sees attributed payments that Growth says it cannot see. There is no single analytics read model.

---

## 4.8 Lifecycle verdict

| Stage | Verdict | Reason |
|---|---|---|
| START | **Partially successful** | Idea/URL → structured app plan works; business validation and evidence do not. |
| BUILD | **Requires manual intervention** | Real build plumbing, but production quality, auth/storage, payouts and source ownership are incomplete. |
| LAUNCH | **Successful for the happy path, fragile otherwise** | Publish/domain/rollback/history exist; completion depends on polling, failure recovery is manual, global hosting is absent. |
| RUN | **Impossible with current implementation** | No customers, orders, invoices, expenses, staff, support or business tasks. |
| MANAGE | **Blocked** | No business financial records; only infrastructure spend and read-only attributed payments. |
| GROW | **Requires manual intervention** | Drafts and advice only; nothing executes or measures outcomes. |
| IMPROVE | **Partially successful** | Ingestion and runtime metrics exist; founder visibility, funnels and error data do not. |

The lifecycle is therefore **front-loaded**: Atai is credible at turning an idea into an app, and not yet a system for operating the business that app represents.
