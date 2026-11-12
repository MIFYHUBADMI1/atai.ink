# 5. AI Team and Co-founder Audit

> Atai's identity promise is an "intelligent AI team" that understands the business and moves it forward. This document asks whether that is a system or a narrative.

## 5.1 What AI actually exists

| # | Surface | Entry point | Model | Tools | Persistence |
|---|---|---|---|---|---|
| 1 | Workspace co-founder agent | `app/api/cofounder/route.ts` → `lib/cofounder/agent.ts` | one shared `MODEL` (`lib/analysis/model.ts:9-24`; OpenRouter, default `openrouter/auto`) | closed registry, 31 tools, READ→HARD_CONFIRM | `cofounder_conversations` (200 messages) |
| 2 | Collaborate plan chat | `app/api/projects/[id]/plan-chat/route.ts` → `lib/analysis/cofounder.ts` | same `MODEL` | none; `<plan-update>` JSON protocol | `project_chats` + embedded `project.conversation` (200 messages) |
| 3 | Planning pipeline | `lib/planning/orchestrator.ts` | per-stage model ids, default `openrouter/auto` (`lib/planning/models/registry.ts`) | none | `planning_runs`, project spec |
| 4 | Plan analysis / autocomplete | `lib/analysis/plan-analysis-service.ts` | same `MODEL` | none | `project.planAnalysis`, 30-min cache |
| 5 | Lessons | `lib/lessons/generate.ts` | same `MODEL` | Firecrawl search, YouTube lookup | `business_lessons` + sha256 fingerprint |
| 6 | Market research / competitors | `app/api/projects/[id]/resources/*` | same `MODEL` | **none — ungrounded** | cached on project |
| 7 | Marketing Studio | `lib/marketing/studio/**` | same `MODEL` | none | `content_items`, `brand_profiles` |
| 8 | SEO recommendations | `lib/marketing/seo/**` | same `MODEL`, temp 0.2 | deterministic Firecrawl audit | `seo_audits` |
| 9 | Follow-up builder agent | `app/api/projects/[id]/agent` → Totalum | Totalum's agent | Totalum build/update | project conversation |
| 10 | Build narration | `lib/build-messages.ts` | **no model** | none | none |

**Verified:** all generative surfaces share one OpenRouter model handle. There is no separate model per specialist, no agent runtime, no agent-to-agent protocol.

## 5.2 Is the "AI team" specialized?

**Verdict: one model with role prompts, a sequential pipeline, and presentation metadata. Not a multi-agent team.**

- The planning pipeline is sequential: each stage consumes the previous stage's serialized output; there is no shared scratchpad or inter-agent messaging (`lib/planning/orchestrator.ts`).
- `team-roles.ts` and `progress-view-model.ts` are presentation metadata used to label events/workstreams. `lib/workspace/progress-view-model.ts:9-11` explicitly says it "never implies capabilities the backend does not support (no staff identities, no task queues, no live agent claims)".
- The honest disclosure is buried in `components/workspace/team-progress.tsx:365`: "These are workstreams your co-founder runs — not separate hired agents."
- The build overlay narrates squads with time-based template banks. `lib/build-messages.ts` claims "Usability team tested … with 200 real users" (393), "Business Strategy team modeled … unit economics" (401), "Competitive Strategy team … war-gamed … every known competitor" (408). These did not happen.

**So:** specialization exists only as prompt differentiation and UI labeling. The differentiated engineering is the **tool/approval layer**, not multi-agent collaboration.

## 5.3 Cross-agent and cross-surface intelligence

There is no shared context bus. Two context builders expose different worlds:

| Context | Workspace co-founder | Collaborate plan chat |
|---|---|---|
| Plan section bodies | **No** — 140-char one-liners (`planBrief`) | **Yes** — focus + related sections, ≤2,200 chars each |
| Analysis findings | **No** | **Yes** — 260 chars each |
| Accepted plan decisions | **No** | **Yes** — last 15 |
| Conversation history replayed | **No** | **Yes** — last 12 |
| Build/deploy state | **Yes** | **No** |
| Analytics consent | **Yes** | **No** |
| Finances / economics | **No** | **No** |

Evidence: `lib/cofounder/context.ts:100-138` + `prompts.ts:45-109` vs `lib/analysis/cofounder.ts:226-304`.

### Memory defect (P0)

The workspace co-founder **persists** the transcript but **does not replay it** to the model. `runAgentTurn` sends only `FOUNDER MESSAGE` as the prompt (`lib/cofounder/agent.ts:178-241`); earlier messages are appended to `cofounder_conversations` after the call but never included in the next request. `projectContextReferences` is written but never read anywhere.

Impact: a "co-founder" forgets the previous turn. Contradictions across turns are structural, not occasional. A founder must restate context every message. This alone prevents the product from feeling like a collaborator.

There is also **no semantic/business memory**: no embeddings, no fact store, no versioned context, no retrieval. The plan is the only durable business artifact, and each surface reads a different projection of it.

## 5.4 Actions, approvals, audit, reversibility

The tool registry is a closed allow-list (`lib/cofounder/tool-registry.ts:45-113`). Unregistered tools cannot execute; the registry lookup **is** the authorization.

| Risk | Tools | Behaviour |
|---|---|---|
| READ | workspace/project/plan/build/activity, navigation, account, credits, growth overview, product analytics, tasks/campaigns list, content search | execute immediately |
| LOW_RISK_WRITE | `stop_build` | immediate |
| CONFIRM | `propose_plan_update`, `apply_plan_update`, `autocomplete_plan`, `create_project`, `run_seo_audit`, `generate_marketing_copy`, `refine_marketing_content`, `propose_growth_task`, `propose_campaign` | prepare only → pending action card |
| HARD_CONFIRM | `request_build`, `request_followup_edit`, `request_deploy`, `delete_project` (typed `DELETE`) | pending action, explicit approval endpoint |

**Approval path** (`app/api/cofounder/actions/[id]/route.ts`): authenticate → ownership → expiry → atomic claim (`pending → executing`, `findOneAndUpdate`) → zod revalidation of the tool input → project ownership re-check → credit re-check → 20/hour limit → execute → finalize → log. TTL 15 minutes; double-approval is impossible by construction (`lib/cofounder/pending-actions.ts:77-108`).

**What is genuinely strong:** the two-phase confirmation, atomic claim, typed confirm word, revalidation of model-produced input and credit re-check are better than most AI agent implementations.

**What is missing:**
- **No dedicated action audit collection.** Pending-action documents and logs exist; `app/api/admin/audit-logs` covers infrastructure audits, not co-founder tool actions.
- **No undo.** `delete_project` is irreversible; builds/deploys have no compensating rollback tool.
- **No approval UI for batches** beyond individual cards.
- **No action policy per founder/role** (there are no roles).
- **No external side effects** to govern, because the agent cannot send email, post, spend ad budget or schedule anything. That is safer, but it is also why it cannot "run" a business.

**Money/external actions:** builds, deploys, SEO, Studio and autocomplete spend credits only after confirmation. No tool touches billing, keys, secrets, webhooks, admin APIs, generated-app DB writes or external communications (`tool-registry.ts:45-56`).

## 5.5 Trust and quality

**Strengths (verified):**
- System prompt: "Tool results are AUTHORITATIVE. Never invent tool results, project facts, numbers, or statuses. If you didn't execute something, don't say it happened." (`lib/cofounder/prompts.ts:14-20`).
- Prompt-injection defense: workspace/project content is labeled untrusted data; the model is told never to follow instructions in it (`prompts.ts:33-34`).
- The approval route revalidates tool input after model output (`actions/[id]/route.ts:93`).
- Upstream error classification and salvage: raw-chat salvage, `isAbortTimeoutError`, refund only when nothing arrived (`lib/api/upstream-error.ts`; `lib/analysis/cofounder.ts`).
- Metric-trust vocabulary refuses to render fabricated zeros (`lib/intelligence/metric-trust.ts`).
- SEO fails closed; Studio outputs are drafts/proposals, never publishes.

**Weaknesses (verified):**
- **Simulated progress.** `components/workspace/build-stage-overlay.tsx:137-138` uses server progress when present, otherwise `Math.min(95, elapsed/300*100)`. `components/cofounder/cofounder-worklog.tsx` uses fixed step times and a time-based bar. The code comments admit these are pacing labels, but the UI does not distinguish them from telemetry.
- **Ungrounded market/competitor generation** with confident prose and no citations, inconsistent with the grounded lessons/SEO surfaces.
- **Team theater** in build narration (see §5.2), with no visible disclaimer.
- **No memory** in the primary agent (§5.3), so it cannot maintain a business narrative.
- **Context truncation**: the workspace agent sees 140-char plan lines; it cannot advise on actual pricing tables, findings or section text without calling a tool, and there is no tool that returns full section bodies.

## 5.6 Specialization by business area

| Area | What the AI can do | What is missing |
|---|---|---|
| Strategy / product | Read plan, analyse plan, propose/apply section edits, autocomplete | No validated market evidence; no goals/risks/roadmap sections |
| Finance | Report credit costs and balances | No revenue/expense/margin/runway tool; finance APIs are not exposed to the agent |
| Marketing | Generate drafts, SEO audit, propose campaigns/tasks | No publishing, sending, scheduling, ad spend or performance data |
| Sales | Nothing | No leads, CRM, pipeline, outreach or conversion |
| Operations | Build status/logs, stop build, deploy | No task queue, workflow, staff, support or recurring operations |
| Customer experience | Nothing | No customer records, feedback aggregation or support |
| Engineering | Build/follow-up/deploy via Totalum | No code inspection, tests, error monitoring or security review |

## 5.7 Does the AI team perform work or return suggestions?

**It performs a narrow set of platform actions** (create project, edit plan, build, deploy, run SEO, generate drafts, propose tasks/campaigns) with good approval semantics. **It does not perform business operations**, has no persistent memory, no shared context, no true specialists, no delegation and no outcome feedback loop. Calling it an "AI team" overstates the system; calling it a **well-governed co-founder assistant with a real action layer** would be accurate.

## 5.8 Top AI gaps (ranked)

1. **P0 — No conversational memory.** Persisted transcripts are never replayed (`agent.ts:178-241`).
2. **P0 — Ungrounded research presented as business intelligence.** Market/competitor generators invent facts (`competition-snapshot.ts`; resources routes).
3. **P1 — Context fragmentation.** Two disjoint context builders; finance, customers and analytics are absent from the agent's world.
4. **P1 — Simulated team narration/progress.** Template banks and time-based bars imply work that did not happen (`build-messages.ts`; overlay/worklog).
5. **P1 — No action audit or undo.** Logs only; irreversible delete; no compensating actions.
6. **P1 — No specialist tool coverage for finance/sales/ops**, so the team cannot do the work its name implies.
7. **P2 — No outcome feedback**: the agent cannot see whether its recommendation worked, because growth/conversion data is not instrumented into its context.

## 5.9 Load-bearing context missing from the model

- Portfolio/project economics (`/api/finances/summary`, `/api/projects/[id]/economics` exist but no tool).
- Customers, leads, orders, invoices, expenses (do not exist).
- Product analytics (exists, but gated default-off and not rendered).
- Marketing performance/attribution (not instrumented).
- Full plan sections and findings in the workspace agent.
- Prior conversation turns in the workspace agent.

## 5.10 Recommendation in one line

Keep the approval architecture; make the agent **remember**, **share one business context**, **stop narrating teams that do not exist**, and **give it the finance/ops/sales data** that would let "run my business" mean something. Do not add more specialist personas until those foundations exist.
