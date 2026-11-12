# 3. Atai Vision → Implementation Capability Matrix

> Status vocabulary is the brief's ten-state scale. A feature is marked complete only where the **user workflow, data, permissions, state transitions and downstream effects** were all observed in source.

| Code | Meaning |
|---|---|
| S1 | FULLY IMPLEMENTED AND VERIFIED |
| S2 | IMPLEMENTED BUT INCOMPLETE |
| S3 | IMPLEMENTED BUT NOT FUNCTIONALLY CONNECTED |
| S4 | IMPLEMENTED BUT NOT USABLE FROM THE USER EXPERIENCE |
| S5 | FRONTEND PLACEHOLDER ONLY |
| S6 | BACKEND IMPLEMENTATION ONLY |
| S7 | MANUAL WORKFLOW DISGUISED AS AUTOMATION |
| S8 | BROKEN OR UNRELIABLE |
| S9 | COMPLETELY MISSING |
| S10 | NOT APPLICABLE / NOT CURRENTLY IN SCOPE |

## 3.1 START — discovery, validation, planning

| Capability | User expects | What Atai provides | Status | Evidence |
|---|---|---|---|---|
| Capture an idea | Describe a business and get structured understanding | Project created; idea persisted; planning pipeline starts fire-and-forget | S1 | `lib/projects/create-project.ts:176,211,231`; `lib/analysis/pipeline.ts` (`runScratchAnalysis`) |
| Analyse an existing website | Crawl a URL and understand the business/product | Firecrawl smart/deep crawl + LLM understanding, cached 7 days | S1 | `lib/analysis/pipeline.ts` (`runWebsiteAnalysis`); `lib/analysis/understanding.ts:116`; `firecrawl_cache` |
| Analyse a GitHub repository | Understand an existing codebase and extend it | Reads README + file tree only; "extend" passes a zip URL as *prompt text*, never fetches code | S2 | `lib/analysis/github-pipeline.ts:181-248,266-333` |
| Market demand research | Evidence about demand, size, trends | Model prior only; no search/browse/market data | S7 | `lib/planning/stages/research.ts` (no tools); `lib/marketing/competition-snapshot.ts:6-15` |
| Competitor research | Identify and compare real competitors | Explicitly none; AI draft forbidden from naming real companies | S7 | `lib/marketing/competition-snapshot.ts:1-16`; `app/project/[projectId]/competition/page.tsx` |
| Viability, costs, risks, roadmap | Structured, checkable business case | Vision/model/revenue/pricing exist; **no costs, risks, goals or roadmap sections** | S2 | `lib/analysis/plan-sections.ts` (19 ids; none for costs/risks/roadmap) |
| Persist the plan | Plan survives and drives later modules | Structured specification on project + 19 section bodies | S1 | `lib/types/specification.ts:1-152`; `lib/analysis/plan-sections.ts` |
| Analyse / autocomplete the plan | Critique and fill gaps | Charged AI analysis + section autocomplete, cached 30 min | S1 | `lib/analysis/plan-analysis-service.ts`; `app/api/projects/[id]/analyze-plan` |
| Plan is the source of truth for all modules | Every module reads the same plan | Modules read the spec, but each projects a different subset; no structured business facts | S2 | See §7 |

## 3.2 BUILD — creation and infrastructure

| Capability | User expects | What Atai provides | Status | Evidence |
|---|---|---|---|---|
| Generate the application | Working app built from the plan | One long Totalum agent prompt; build observed by client polling | S2 | `lib/analysis/prompt-builder.ts:246-405`; `lib/integrations/totalum/service.ts:34`; `app/api/projects/[id]/status/route.ts` |
| Configure authentication | Login for the app's customers | Requested in plan/brief; no Atai auth adapter; outcome depends on Totalum scaffold | S2 | `runtime/contracts/router.ts:106-143` (no auth op); prompt only |
| Configure payments | App can sell and collect money | Dodo checkout works; **funds settle to Atai's merchant account**, no founder payout/connected account | S2 | `lib/runtime/router/adapters/dodo/mapper.ts:416-420`; `dodo/config.ts` |
| Email / file storage | Transactional email and uploads | Email adapter exists but not preconfigured per app; storage capability is **not routed** | S3 | `runtime/contracts/router.ts:106-143` (storage listed, no operation) |
| Get the source code | Own / export the code | Signed Totalum source URL; `export` returns project JSON, not code | S2 | `lib/integrations/totalum/service.ts:82`; `app/api/projects/[id]/export/route.ts` |
| Edit the app after build | Safe follow-up changes with versions | Follow-up agent, version list/diff, rollback plumbing | S1 | `lib/projects/project-actions.ts:220-307`; `components/edit-workspace.tsx:203,1621,1636` |
| Verify production readiness | Tests, staging, security review | None for generated apps; no CI, screenshots/tests, or security scan | S9 | No code path; prompt only |
| Build queue / durable execution | Build survives tab close and restarts | Fire-and-forget + client polling; recovery only when a route is hit | S3 | `lib/projects/pipeline-recovery.ts:328-374`; no job substrate |

## 3.3 LAUNCH — hosting, deployment, publishing

| Capability | User expects | What Atai provides | Status | Evidence |
|---|---|---|---|---|
| Publish the app | One action to go live | Deploy route charges credits, calls Totalum, records history + publish event | S2 | `app/api/projects/[id]/deploy/route.ts:1-364` |
| Custom domain | Add and remove a domain | Totalum add/remove, returns DNS records | S2 | `app/api/projects/[id]/domain/route.ts:1-92` |
| SSL | Automatic HTTPS | Implied by Totalum hosting; not configured by Atai | S2 (INFERRED) | no certificate code |
| Rollback | Return to a previous version | Manual `recoverVersion` + version diff UI | S1 | `app/api/projects/[id]/recover/route.ts`; `service.ts:145-156` |
| Logs | See build/prod logs | Dev/prod log routes | S1 | `app/api/projects/[id]/logs`; `service.ts` |
| Deployment history | See past deploys and outcomes | Per-project history records | S1 | `DeploymentHistoryEntry`; `components/deployment-history.tsx` |
| Recover a failed deployment | Automatic safe recovery | Resets to `ready`; rollback is manual; no automatic last-good restore | S2 | `lib/projects/project-actions.ts:320-423` |
| Global hosting dashboard | Manage all apps' hosting | `ComingSoonPage` | S5 | `app/hosting/page.tsx:1-11` |

## 3.4 RUN — daily operations

| Capability | User expects | What Atai provides | Status | Evidence |
|---|---|---|---|---|
| Unified business workspace | See what needs attention today | Build-control room: next build/launch/hosting step only | S2 | `components/workspace/operating-room.tsx:239-305,390-414`; `lib/workspace/workspace-view-model.ts:625-684` |
| Customers / leads | Manage prospects and customers | No collection, route or UI | S9 | `lib/db/collections.ts` (none) |
| Orders / sales | Track sales | No Atai-side record; only attributed Dodo payments in finance | S9 | `lib/db/collections.ts`; `lib/finances/dodo-earnings.ts` |
| Invoices / payments records | Issue and track invoices | No invoicing; payment records exist for Atai's own billing | S9 | `app/api/finances/summary` only |
| Expenses | Record and categorise costs | No expense entry anywhere | S9 | `app/api/finances/` has only `summary` |
| Business tasks / workflows | Manage operational work | Marketing task list with status/priority/due; nothing executes | S7 | `lib/marketing/tasks/service.ts:5-12` |
| Team / staff | Invite staff, assign work | No organisation, membership or staff model | S9 | no collections/routes |
| Customer communication / support | Talk to customers | None | S9 | none |
| Notifications | Be told what happened | Inbox derived client-side from project/credit state; read state in localStorage | S2 | `lib/dashboard/view-model.ts:360-385`; `notifications-store.ts:12-24` |
| Generated-app data access | Inspect/edit app data | Raw table browse + record CRUD via Totalum proxy — no CRM semantics | S2 | `app/api/projects/[id]/database/**` |

## 3.5 MANAGE — intelligence and finance

| Capability | User expects | What Atai provides | Status | Evidence |
|---|---|---|---|---|
| Track credit spend | Know what the platform costs | Project + portfolio credit consumption | S1 | `lib/finances/project-finances.ts:220-322` |
| Track provider cost | Know underlying model cost | USD provider cost per request, "unavailable" never 0 | S1 | `project-finances.ts:196-214`; `cost-status.ts` |
| Track app revenue | See what the business earned | Attributed Dodo payments filtered by `_ataiProjectId`; read-only | S2 | `lib/finances/dodo-earnings.ts:14-30` |
| Record revenue/expenses manually | Build a real P&L | No manual entry; no expense ledger | S9 | no POST under `app/api/finances` |
| Profit & loss / cash flow | Understand profitability and cash | `recognizedRevenue: not_supported`; no P&L/cash-flow statement | S9 | `lib/finances/project-economics.ts:446-448` |
| Financial goals | Set and track goals | None | S9 | none |
| Financial reports | Export/review statements | Admin reconciliation + projections only | S2 | `reconciliation.ts`; projections OLS-labelled |
| Distinguish money domains | Platform vs business vs credits | Code separates them; UI calls the page "Business finances" while showing infrastructure spend | S2 | `components/finances/platform-finances-view.tsx:56`; `net-position.ts:47-61` |
| Reconciliation | Prove provider usage ↔ credits ↔ money | Read-only admin tool, manual; one aggregate mixes currencies | S2 | `lib/finances/reconciliation.ts`; `app/api/admin/runtime/financials/route.ts` |

## 3.6 GROW — market, marketing, sales

| Capability | User expects | What Atai provides | Status | Evidence |
|---|---|---|---|---|
| Market intelligence | Real market/competitor tracking | None; plan-only AI drafts | S7 | `competition-snapshot.ts` |
| Marketing strategy/plan | Strategy grounded in the business | Plan `marketingPlan` section + AI copy | S2 | `specification.ts`; `lib/marketing/studio` |
| Content creation | Generate landing/email/ad copy | Studio drafts, immutable versions, refine proposals | S2 | `lib/marketing/studio/service.ts`; `refine.ts` |
| Content calendar | Schedule and publish content | `plannedAt` only; no publish field, no scheduler | S7 | `lib/marketing/studio/library.ts:9-12` |
| SEO | Audit and improve the site | Real bounded Firecrawl audit, deterministic findings, credits | S1 | `lib/marketing/seo/auditor.ts`; `service.ts:130` |
| Campaign planning | Plan channels/budget | Durable campaign records, manual status; never spends | S7 | `lib/marketing/campaigns/service.ts:10-15` |
| Ad execution | Launch and optimise ads | None; drafts copied by hand | S9 | `app/project/[projectId]/ads/page.tsx:10-14` |
| Lead generation / CRM | Acquire and manage leads | None | S9 | none |
| Conversion tracking | Measure funnel outcomes | None; growth metrics `notInstrumented` | S9 | `lib/marketing/growth-overview.ts:507-565` |
| Growth task management | Know and track next steps | Manual list with history | S7 | `lib/marketing/tasks/service.ts` |

## 3.7 IMPROVE — application intelligence

| Capability | User expects | What Atai provides | Status | Evidence |
|---|---|---|---|---|
| Runtime health | See requests, failures, latency | Real p50/p95, success rate from `runtime_usage` | S1 | `lib/intelligence/overview.ts:137-209` |
| Ingest app events | Know what users do in the app | Real `atai.analytics` ingest + summary; **no founder UI** | S6 | `lib/runtime/router/adapters/analytics/*`; no UI consumer |
| Active users / retention | Understand engagement | Counts available from events; retention not computed | S2 | `adapters/analytics/store.ts:36-104` |
| Funnels / drop-off | Answer "why do users abandon?" | Events aggregated by name only; no ordered funnels | S9 | `store.ts:47-56` |
| Error monitoring | See app errors | Platform runtime failures counted; no app-side error capture | S2 | `overview.ts`; no app error capability |
| Journey reconstruction | See paths through the app | None | S9 | none |
| Improvement recommendations | "What should I fix this week?" | AI advice from plan/runtime, not app behaviour | S2 | `overview.ts` pending keys |
| Experiments | A/B test improvements | None | S9 | none |
| Intelligence page honesty | Never fake numbers | Strong metric-trust vocabulary; but copy says events are not collected although ingestion exists | S2 | `lib/intelligence/metric-trust.ts`; `overview.ts:334-337` vs analytics adapter |

## 3.8 AI TEAM AND CO-FOUNDER

| Capability | User expects | What Atai provides | Status | Evidence |
|---|---|---|---|---|
| Co-founder conversation | Ask anything about the business | Tool-calling agent, READ→HARD_CONFIRM registry | S2 | `lib/cofounder/agent.ts`; `tool-registry.ts` |
| Conversational memory | Remember earlier turns | Transcript stored but **not replayed** to the model | S9 | `agent.ts:178-241` sends only current message |
| Shared business context | All specialists know the same business | Two disjoint context builders; no shared bus | S3 | `lib/cofounder/context.ts` vs `lib/analysis/cofounder.ts:226-304` |
| Specialist AI team | Strategy, finance, marketing, ops specialists | One model with role prompts; UI narrates squads | S7 | `lib/analysis/model.ts`; `lib/build-messages.ts:1-6,45-53` |
| Tool actions with approval | AI can act, founder approves | Two-phase pending actions, atomic claim, confirm word | S1 | `lib/cofounder/pending-actions.ts:77-108`; `app/api/cofounder/actions/[id]/route.ts` |
| Action audit / undo | Review and reverse actions | Pending-action docs + logs; no undo collection | S2 | `pending-actions.ts`; no audit collection |
| Execute business operations | Send, spend, schedule, publish | No tool sends email, posts, spends ad budget or schedules | S9 | `lib/cofounder/tool-registry.ts:45-56` |
| Finance awareness | Advise on revenue/cost/margin | No finance tool or finance context | S9 | no tool; context builders omit finances |

## 3.9 PLATFORM

| Capability | User expects | What Atai provides | Status | Evidence |
|---|---|---|---|---|
| Runtime gateway for generated apps | One metered API for AI/email/etc. | Authenticated, scoped, metered router with adapter fallback | S1 | `app/api/runtime/v1/route.ts`; `lib/runtime/router/router.ts` |
| Runtime key provisioning | App gets credentials automatically | Key created and injected into Totalum secrets | S1 | `lib/runtime/provisioning/service.ts` |
| Key scopes | Least privilege | Empty scopes = all; provisioned key gets every routed scope | S2 | `lib/runtime/auth/authorize.ts:30`; `provisioning/service.ts:83-85` |
| Credits | Buy, spend, refund transparently | Strong ledger core; legacy paths use unstable keys; refund type bug | S2 | `lib/billing/credit-service.ts`; `lib/credits/credits.ts`; `metering/charge.ts:188-196` |
| Checkout / subscriptions | Buy a plan | Server-priced Dodo checkout + lifecycle | S1 | `app/api/billing/checkout/route.ts`; `dodo-event-processing.ts` |
| Founder payouts | Get the money the app earns | None; funds settle to Atai | S9 | `dodo/mapper.ts:416-420` |
| Admin console | Operate the platform | Broad read views; self-credit and some unvalidated inputs | S2 | 19 admin modules; `app/api/admin/self-credits/route.ts` |
| Analytics consent | Control app-data access | Per-project consent default off + operator flag | S1 | `lib/analytics/consent.ts`; `app/api/projects/[id]/analytics-consent` |
| Security / isolation | Data cannot cross tenants | Strong session/auth; Dodo read feeds are account-wide; some routes unverified | S2 | `lib/auth/session.ts`; `dodo/adapter.ts`; see §9 |

## 3.10 Overall assessment

Counting the 80 assessed capabilities above:

- **S1 fully implemented and verified: 17**
- **S2 implemented but incomplete: 30**
- **S3 implemented but not connected: 3**
- **S4 not usable from UX: 0**
- **S5 frontend placeholder: 1**
- **S6 backend only: 1**
- **S7 manual workflow disguised as automation: 8**
- **S8 broken/unreliable: 0 confirmed** (several S2 items carry reliability risk)
- **S9 completely missing: 20**
- **S10 not applicable: 0**

The distribution is the core finding: **Atai is strongest at infrastructure and weakest at business ownership.** Runtime, ledger, plan persistence, hosting plumbing and approvals are real. Customers, orders, expenses, payouts, market evidence, durable jobs, app funnels and shared AI memory are absent. The product is not "30% done"; it is complete in some vertical slices and structurally absent in others, which is why it can demo well and still fail a founder's actual workflow.
