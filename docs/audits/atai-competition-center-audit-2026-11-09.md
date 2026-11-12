# ATAI — Business Competition Center: Full Product, Architecture & Capability Audit

**Date:** 2026-11-09 · **Scope:** `/project/[projectId]/competition` and every capability it depends on · **Mode:** audit only, no code changed.

**Method and evidence standard.** Every claim below is verified by reading the repository code (file:line citations). Nothing was runtime-tested — no dev server, no live clicks — so end-to-end behavior is **code-verified, not browser-verified**; anything that would need a running deployment to confirm is marked *lead*, not *confirmed*. Facts and recommendations are separated: "Today" lines are observed facts; everything from Report 5 onward is recommendation. No capability was marked missing before searching the whole app for it.

**Headline.** There are TWO competitor surfaces, and they contradict each other:

1. **`/project/[projectId]/competition`** — a deliberately honest, minimal page: it renders the plan's own positioning story and drafts a competitor-landscape *snapshot* strictly from the plan, with "Atai does not collect live market or competitor data" copy everywhere (page.tsx:77-79, competition-snapshot.ts:4-16). This is real, wired, and billed correctly — but it has a prompt-truncation defect that silently cuts the plan context it claims to draw from (confirmed, §R2), and a prompt-template conflict that fights the snapshot's required output shape (confirmed, §R3).
2. **Resources → "Competitive intelligence"** (`components/project-resources/competitors-section.tsx`) — a 100-credit button that claims "Real competitors in your space — their positioning, strengths, weaknesses" (competitors-section.tsx:65-66) and renders company names, pricing, funding status, strengths and weaknesses. It is a **plain LLM call with no web search, no crawling, no sources** (competitors/route.ts:50-95) — the output is model prior knowledge presented as fact. This is the single most damaging integrity finding in the audit.

The platform already owns a real web-search/scrape capability (Firecrawl, `search.web` + `web.scrape`, firecrawl/adapter.ts:35-36) used only by SEO audit today. The roadmap's central move is to re-point competitor research at that existing capability — not to invent new infrastructure.

---

## Report 1 — Current State Audit

### 1.1 Surfaces and routes

| Surface | Route | Files |
|---|---|---|
| Competition page (per project) | `/project/[projectId]/competition` | `app/project/[projectId]/competition/page.tsx` (139 lines, server component) |
| Global Competition entry (no project selected) | `/competition` | `app/competition/page.tsx` — ComingSoon redirect page (lines 3-11) |
| Snapshot draft API | `POST /api/projects/[id]/market/competition-snapshot` | `app/api/projects/[id]/market/competition-snapshot/route.ts` |
| Resources competitor research API | `POST /api/projects/[id]/resources/competitors` | `app/api/projects/[id]/resources/competitors/route.ts` |
| Snapshot panel (client) | — | `components/marketing/competition-snapshot-panel.tsx` |
| Competitor research section (client) | — | `components/project-resources/competitors-section.tsx` |
| Storage services | — | `lib/marketing/competition-snapshot.ts`, `lib/marketing/studio/market-service.ts`, `lib/resources/resources-credits.ts`, `lib/resources/ai-retry.ts` |

Entry points: the grow nav (`components/workspace/atai-nav.ts:79`), the global sidebar nav (atai-nav.ts:101), the workspace operating-room "Grow your business" list (operating-room.tsx:574), and `/competition` is a valid post-checkout return path (`lib/billing/checkout-return.ts:17`).

### 1.2 The Competition page (surface A) — how it actually works

**Auth and ownership.** `requireOwnedProject` (page.tsx:25 → lib/workspace/require-owned-project.ts:5-11): unauthenticated → redirect to `/login?next=…`; project missing or `project.userId !== user.id` → `notFound()`. There is no admin/share path — the page is strictly owner-only.

**What renders (page.tsx:40-135).** All content derives from `project.specification`:
- Market positioning card — only when `spec.marketPositioning` is non-empty and not a generator placeholder (`isPlaceholderValue`, page.tsx:42), rendered through `CofounderMarkdown` (page.tsx:97).
- Value proposition card (page.tsx:105-112).
- "Who you are competing for" — first 5 `spec.targetUsers` (page.tsx:113-122).
- Absent-plan and missing-field empty states are dashed-border copy blocks pointing to the plan editor (page.tsx:86-90, 100-104).

**The snapshot panel.** Rendered only when `isMarketStudioEnabled()` (env kill switch `MARKET_STUDIO_ENABLED=false`; default ON — feature-flags.ts:174-177). `textReady` requires `capabilityAvailability()["ai.text"].configured` (page.tsx:50). The page pre-reads the newest snapshot and the founder's credit balance server-side (page.tsx:52-66), both fail-soft to null.

**Snapshot generation lifecycle (POST route → service → runtime → DB):**

1. `withAiProtection("studio")` wraps the route (route.ts:20): `requireUser` → per-user quota (studio: 6/min, 60/hr — ai-quota.ts:10) → 256 KB body bound → AI lease + deadline (`lib/api/ai-protection.ts:43-71`).
2. Ownership is checked **twice**: `checkProjectOwnership` (route.ts:27-28) and again inside the service (`project.userId !== input.userId` → UNAUTHORIZED, market-service.ts:231-234).
3. Guards: feature flag (route.ts:30-32), `ai.text` configured (route.ts:34-36), plan must exist (route.ts:42-44; competition-snapshot.ts:56-58).
4. Context assembly: `buildLaunchKitContext` (competition-snapshot.ts:60-69 → launch-kit-content.ts:166-196) packs app name, description, idea, ≤5 target users, owner goals, live URL (only when deployment succeeded), and the **combined marketing plan** (`readCombinedMarketingPlan`, plan-sections.ts:87-99) into a **1,200-character budget** (CONTEXT_BUDGET, launch-kit-content.ts:161).
5. Generation: `generateMarketContent({ kind: "brief", kit: "competition", kitSlot: "snapshot", tone: "professional", length: "medium" })` (competition-snapshot.ts:71-81). The brief is `SNAPSHOT_ASK` (750 chars, competition-snapshot.ts:30-38) + "Context you must draw from…" + the context above.
6. Runtime call: the studio resolves a runtime identity — the project's own active API key covering `ai.text` if one exists, else a non-secret workspace identity (market-service.ts:89-139) — then `routeRuntimeRequest` → OpenRouter `chat/completions` with model resolved through the project's runtime model policy (adapter.ts:132-141, model-policy.ts:38-64). max_tokens for `medium` = 900 (market-content.ts:313-319).
7. Billing: inside the runtime router's central metering — usage normalized, credits charged, recorded on `runtime_usage` (router.ts:275-322); the studio reads back the charged amount (market-service.ts:163-178) and stamps `creditsCharged` on the asset. Because metering is central, these charges appear on the Business finances page automatically (market-service.ts:53-56).
8. Persistence: one `content_items` document — `kind: "marketing_asset"`, `template: "market_studio"`, `status: "draft"`, `kit: "competition"`, `kitSlot: "snapshot"`, `origin: "ai_generated_marketing_content"` (market-service.ts:366-389; kit fields typed at lib/types/db.ts:782-786). Every new draft is a **new document** — history is preserved.
9. Display: `getCompetitionSnapshot` returns only the **newest** snapshot (`sort createdAt: -1, limit 1`, competition-snapshot.ts:95-106); older drafts remain visible in the Studio library (`searchContentItems` has no kind restriction, library.ts:78-129 — and "brief" is a filterable library kind, library.ts:27-38).
10. Failure paths: empty model text → `AI_UNAVAILABLE` (market-service.ts:431-432); persist failure → `DATABASE_UNAVAILABLE` (market-service.ts:724-734); the panel shows an `role="alert"` message (panel 136-140). **No credits are pre-charged on this path** — metering charges only for a completed runtime call, and a failed route renders nothing. *Lead:* a runtime call that succeeds but then fails persistence would still have charged credits for an asset that was never shown.

**Confirmed defect A1 — the snapshot's plan context is silently truncated twice (§R2).**
- `buildLaunchKitContext`'s own comment says the per-slot ask + context must stay under the service's 2,000-char brief limit, with the context budget at 1,200 chars (launch-kit-content.ts:155-161). The launch-kit slot asks are 1-2 sentences (~150-250 chars). The competition ask is **750 chars** (competition-snapshot.ts:30-38) — the budget invariant is broken by whoever reused the builder: 750 + 68 (header) + up to ~1,300 of context ≈ **2,020-2,400 chars**.
- `generateMarketContent` then applies `clean(input.brief, 2000)` (market-service.ts:227) and `buildMarketMessages` applies `clean(..., 2000)` **again** (market-content.ts:237) — a hard, silent tail cut that removes the end of the marketing plan and the Live-URL line.
- Independently, `snippet()` collapses **all whitespace to single spaces** (launch-kit-content.ts:138-142), flattening the plan's `## Heading` structure into one line.
- Net effect, confirmed by arithmetic: a plan at the section's own quality bar (≥500 words, plan-sections.ts:876-887) is ~3,000+ chars; the snapshot sees at most ~900-1,050 chars of it — roughly the first 150-175 words — while the prompt instructs "draw from the context; do not invent facts that are not here" (competition-snapshot.ts:75).

**Confirmed defect A2 — two competing output templates in one prompt (§R3).** The snapshot is generated as studio kind `brief`, whose kind instruction is "Write a concise marketing strategy brief with these labelled sections: Summary, Audience, Customer problem, Value proposition, Objective, Messaging, Channels, Content ideas, Next steps, Assumptions" (market-content.ts:216-217) — injected into the system message **and repeated at the end of the user prompt** (market-content.ts:248-265), while the founder-facing ask demands four different headings (Competitor types / How this product is positioned / Where the plan is unproven / What to watch). The model receives two contradictory deliverable shapes.

**Confirmed defect A3 — snapshot body renders raw markdown.** The plan cards on the same page use `CofounderMarkdown` (page.tsx:97, 109), but the snapshot body is rendered as plain text with `whitespace-pre-wrap` (panel:150). The ask demands "each under its own short heading" (competition-snapshot.ts:31-34) — model output headed `## …` will show literal `##` marks.

### 1.3 The Resources competitor section (surface B) — how it actually works

**Page wiring.** `app/project/[projectId]/resources/page.tsx:38-44` reads `project.resourcesCache.competitors` (an untyped field written via `@ts-expect-error`) and passes it as `cachedCompetitors` into `ResourcesClient` → `CompetitorsSection`.

**Research lifecycle (POST /resources/competitors):**
1. `withAiProtection("resources")` (route.ts:20) — same protection wrapper; quota 6/min, 30/hr (ai-quota.ts:8).
2. Ownership + spec guards (route.ts:30-36).
3. **Flat charge of 100 credits before generation** (`chargeCompetitors` → `consumeCredits`, ledger-transaction with `metadata: { feature: "resources", operation: "competitors" }` and project attribution — resources-credits.ts:24-48; cost table credit-costs.ts:14-19). An idempotency key exists only if the client sends `requestId` — **the UI never sends one** (competitors-section.tsx:33-35 posts with no body), so every attempt gets a fresh `cryptoId()` key (resources-credits.ts:37).
4. Generation: `generateWithRetry` → the **shared analysis model** (`MODEL` = `OPENROUTER_MODEL` || `OPENROUTER_FREE_MODEL` || `openrouter/auto`, lib/analysis/model.ts:17-21) with up to 2 retries and exponential backoff (ai-retry.ts:11-40). The system prompt says "Include only real, existing competitors. Be accurate and factual" (route.ts:50-53); the user prompt asks for "the top 5-7 competitors … Include direct competitors first" and a JSON schema with name, url, tagline, founded, pricing, businessModel, strengths, weaknesses, targetCustomer, competitiveEdge, fundingStatus (route.ts:55-82). **There is no tool, no search, no scrape, no retrieval anywhere in this path.**
5. Parsing: regex extraction of the first `[` to the last `]` and `JSON.parse` (route.ts:91-95). No schema validation of the array or its elements.
6. Persistence: `store.updateProject(id, { resourcesCache: { …prev, competitors: { data, generatedAt } } })` (route.ts:124-131) — **overwrite-in-place; there is no history**.
7. Failure paths: any generation/parse failure → refund (idempotent via `resources_${intentKey}_refund`, resources-credits.ts:63-90), fall back to the cached copy with a note, else 503 "credits have been refunded" (route.ts:96-122).

**Display.** Numbered expandable cards: name, external link, funding chip, tagline, price string; expanded: who they serve, "Their competitive edge", strengths (green), weaknesses (red), business model (competitors-section.tsx:107-208). The `founded` field the prompt requests is **never rendered**. `key={c.name}` (line 110) collides on duplicate names. Refresh always costs another 100 credits (line 84-86) and replaces everything — individual competitors cannot be added, removed, corrected, or kept.

### 1.4 What does NOT exist (verified absent)

- A competitor **entity** — no collection, no schema, no CRUD. Competitors exist only as untyped JSON inside `resourcesCache` (surface B) or as prose inside a snapshot body (surface A).
- Any use of the Firecrawl `search.web` / `web.scrape` runtime capabilities for competitors (they exist: firecrawl/adapter.ts:35-36, availability.ts:55-56; today only the SEO auditor consumes Firecrawl evidence — lib/marketing/seo/auditor.ts:7,24).
- Any co-founder tool for competition — `lib/cofounder/tools/` covers growth, tasks, studio, campaigns, seo, analytics, applications, plans, projects, navigation, workspace; grep for `competit*` there returns nothing.
- Any comparison, SWOT, pricing-intelligence, review/customer-feedback, positioning-map, or monitoring feature anywhere in the app (searched components/, lib/, app/).
- Any scheduler/cron for competitor or market work (campaigns are plan-only by design; there is no job substrate on the platform).
- Any source URL, source date, or confidence field on any competitor output.
- Any test for either surface (`grep competition --include="*.test.ts*"` returns nothing; adjacent modules market-service / launch-kit-content / library have tests, the competition snapshot service and both routes do not).

### 1.5 Database, indexes, retention

- Snapshot storage: `content_items` collection. Existing indexes cover `{ projectId, updatedAt: -1 }`, `{ projectId, status, updatedAt }` etc. (lib/db/collections.ts:589-595) — **no index matches the snapshot query** `{ projectId, kind, kit, kitSlot }` sorted by `createdAt` (competition-snapshot.ts:97-104); it rides the projectId prefix and filters/sorts in memory. Fine at current volume, a scale finding later.
- Resources storage: `resourcesCache` lives **on the project document** — it dies with the project. Snapshots live in `content_items`, which `deleteProject` does **not** cascade: deletion removes the project, build runs and attachments only (mongo-store.ts:536-568), leaving orphaned snapshot documents keyed by a dead projectId (they become unreachable through the UI but persist in the collection).
- No TTL/retention policy on either; snapshot count per project is unbounded (each draft = new doc).

---

## Report 2 — Capability Gap Analysis

Status vocabulary: **Implemented** (code-verified end-to-end), **Partial**, **Missing**, **Broken-defect** (exists but defective). "Evidence" cites the enforcing code; absence findings cite the searched-but-empty evidence.

| # | Capability | Status | Evidence | Current behavior | Gap | Business impact | Recommendation | Priority | Dependencies |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Page renders plan's competitive story | Implemented | page.tsx:40-135 | Positioning / value prop / target users from spec, with empty states | — | Anchor for the whole feature; keep | Preserve | — | — |
| 2 | Plan-derived competitor-landscape draft | Implemented with defects | competition-snapshot.ts:30-82; market-service.ts:225-401 | One-click AI draft from plan context, persisted per draft, newest shown | Context truncated to ~1,050 plan chars (§R2); brief-kind template conflict (§R3); raw markdown body (§R3/A3) | Draft quality degrades exactly as plans get better; headings leak | Dedicated prompt path + bigger context budget + markdown rendering | **Critical** | None (pure prompt/read changes) |
| 3 | Snapshot history | Partial | competition-snapshot.ts:95-106; library.ts:78-129 | Every draft persists; page shows newest only; library lists all | No in-page history view; no labels distinguishing drafts | Founder can't see how the landscape story evolved | In-page draft history list | Medium | None |
| 4 | Automatic competitor discovery | Missing | Firecrawl adapter exists unused for this (adapter.ts:35-36); no discovery code in lib/marketing or routes | Nothing | No search, no classification (direct/indirect/substitute/emerging), no relevance scoring, no approval flow | Core promise of a "Competitive Intelligence Center" absent | Phase 2: discovery via `search.web` + `web.scrape` with evidence storage | **High** (after Phase 0) | Existing runtime identity, metering, Firecrawl key |
| 5 | Manual competitor add/edit/remove | Missing | competitors-section.tsx:26-45 (all-or-nothing regenerate only) | Only full-list regeneration at 100 credits | No entity to manage; no dedupe; no categorization | Founder knowledge (they know their market) can't enter the system | Phase 2 entity + CRUD | **High** | New collection or kit-slot storage |
| 6 | Competitor profiles grounded in sources | Missing | route.ts:50-95 (no tools); no source fields rendered | Name/URL/pricing/funding/strengths from pure LLM prior | No source URLs, no fetch dates, no verification; hallucination presented as fact | **Trust-breaking**: fabricated pricing/funding can drive real decisions | Evidence-backed profiles with source + date per claim | **Critical** (see §R1) | Firecrawl; new storage |
| 7 | Feature/product comparison | Missing | grep across app: only SEO auditor references comparisons | Nothing | No side-by-side matrices, no value-prop deltas | The "what do they do better" question unanswered | Phase 3 comparison built on evidence store | High | Capability 6 |
| 8 | Pricing intelligence | Missing | Nothing; snapshot prompt even forbids prices (competition-snapshot.ts:36-37) | Hallucinated pricing strings in surface B only | No grounded pricing observations | Pricing decisions made on invented numbers | Fold into Phase 2/3 evidence (scrape pricing pages) | High | Capability 6 |
| 9 | Market opportunities | Partial | SNAPSHOT_ASK section 3-4 (competition-snapshot.ts:34-37) | "Where the plan is unproven" + "What to watch" questions, plan-derived only | Not opportunity-shaped; no gap analysis against real competitors | Founder gets questions, not prioritized openings | Phase 3: gap → opportunity extraction into actionable items | Medium | Capabilities 6-7 |
| 10 | SWOT / strategic analysis | Missing | Nothing (surface B has per-competitor strengths/weaknesses strings only, ungrounded) | Nothing real | No business or competitor SWOT, no positioning map, no Five Forces | Strategic layer absent | Phase 3, only on top of evidence | Medium | Capability 6 |
| 11 | Customer intelligence (reviews/complaints) | Missing | Nothing; prompts forbid reviews in A (competition-snapshot.ts:36-37) | Nothing | No review-source ingestion, no complaint themes | "Why customers choose them / where they disappoint" unanswered | Defer honestly; needs review-source capability decision | Low (Phase 4+) | New external source decision |
| 12 | Competitive strategy → tasks/plans | Missing | Cofounder tools have no competition inputs (lib/cofounder/tools/) | Nothing links competition output to `propose_growth_task`/campaigns | Insights dead-end on the page | Intelligence never becomes action | Phase 3: hand-off into growth tasks | Medium | Capabilities 9; existing tasks tools |
| 13 | Monitoring / change detection | Missing | No scheduler exists platform-wide (campaigns are plan-only by design) | Nothing; "Refresh" is the only re-research | No snapshots-over-time, no diffs, no notifications | "Is the environment changing?" unanswerable | Phase 4 — **defer honestly** until a job substrate exists | Low now | Platform scheduler (does not exist) |
| 14 | Re-research without losing history | Partial (A) / Missing (B) | A: new doc per draft (market-service.ts:366-389); B: overwrite-in-place (route.ts:124-131) | A keeps drafts; B erases previous list | B has no history; A has no comparison between drafts | B users lose prior "research" they paid 100 credits for | Entity + observation history in Phase 2 | Medium | Capability 5 |
| 15 | Credit accounting | Implemented, with edges | A: central metering (router.ts:275-322); B: flat 100 + refund (resources-credits.ts) | Both charge and attribute to project | B: no client idempotency key (UI sends none, §R5); B: charge survives a failed cache write (§R5) | Rare double-charge / charged-with-no-result cases | Phase 0 fixes | Medium | None |
| 16 | Business isolation | Implemented | require-owned-project.ts:5-11; route.ts:27-28, 38-41; market-service.ts:231-234 | Page + both APIs enforce owner-only; library reads project-scoped (library.ts:131-137) | — | None found | Keep; re-verify on any new route | — | — |
| 17 | Rate limiting / abuse protection | Implemented | ai-quota.ts:8-10; ai-protection.ts:43-71; enforce-limits.ts:25-58 | 6/min & 30-60/hr per user per surface; project RPM/RPD caps for runtime | — | — | Keep | — | — |
| 18 | Nav truthfulness | Broken-defect (cosmetic) | atai-nav.ts:79,101 + atai-sidebar.tsx:60-64 | Live, functional page labelled "Soon" in both navs | Founder believes the feature doesn't exist yet | Discovery of a shipped feature is suppressed | Remove the "soon" kind | **Quick win** | None |

Do-not-forget note from Part 6 verification: nothing here duplicates Market & Grow (marketing execution), Ads, Application Intelligence (own-app analytics), or Finances — today Competition overlaps with *Resources* (surface B is effectively a competitor product living in the wrong section), which is the one boundary violation to resolve.

---

## Report 3 — Product Experience Assessment

**The Competition page itself (surface A) reads like a professional, honest v1.** Strengths verified in code: honest expectation-setting in the header (page.tsx:76-79), empty states that always state the path forward (page.tsx:86-104), the "AI draft · not verified" badge and "verify before you rely on it" warning (panel:146-157), a confirm-before-regenerate flow that preserves the old draft (panel:91-108), disabled buttons with explanations (panel:120-125), live credit balance (panel:67-71), error alert with role semantics (panel:136-140), responsive type/spacing throughout (page.tsx:70), and accessible section labelling (`aria-labelledby`, page.tsx:82, 62). Verdict: it does *not* feel like an AI-generated dashboard; it feels like a deliberately small honest surface.

**But the experience has real gaps a business owner will hit:**

1. **The page can't answer a single question about an actual competitor.** No names, no links, nothing to click. The owner arrives at "Competition" wanting competitors and leaves with their own plan restated plus four contemplative questions. The nav promises "Competition"; the page delivers "your plan, mirrored". This is the core product gap, not a polish gap.
2. **The draft quality is undermined by the defects in Report 1.** With the plan clipped to ~150-175 words and two conflicting templates in the prompt, the "landscape draft" is produced from a fraction of the story the founder wrote. Founders with detailed plans will notice the draft ignoring their later sections.
3. **Raw `##` headings in the snapshot body** (panel:150) look broken next to the properly rendered markdown plan cards above it — a visible inconsistency on the same page.
4. **No way back to prior drafts** from the page (only the Studio library, unlabelled as competition history), and no model/date display on the card (the view drops `model`, panel type at panel:7-13).
5. **Nav labels the page "Soon"** in both the grow nav and the global sidebar (atai-nav.ts:79,101) — the founder is told a shipped feature is coming.
6. **The Resources section is the anti-pattern.** "Real competitors in your space" / "we'll research the real players" (competitors-section.tsx:65-66, 102) with a funding chip and per-competitor "competitive edge" reads like established fact. Every rendered claim is ungrounded model output. It also violates the section boundary: competitor intelligence lives under Resources, not Competition. When a founder cross-checks one URL or one funding claim and finds it wrong, trust in the whole platform takes the hit — and the Competition page's careful honesty copy makes the contrast worse.

**Mobile / accessibility:** both surfaces use responsive Tailwind patterns (sm:/lg: breakpoints), buttons are real `<button>`s, expanded cards are toggle buttons with text alternatives; no horizontal-scroll traps or clipped containers were found in the markup. Not browser-verified — *lead*.

**Verdict:** surface A is a good foundation mislabeled in nav and undercut by three prompt/render defects; surface B must be either grounded (Phase 2) or re-homed/relabeled, because today it is the opposite of the platform's stated honesty doctrine.

---

## Report 4 — AI and Research Architecture

**What intelligence is collected today:** none from the outside world. Surface A derives everything from `project.specification` (positioning, value prop, target users, combined marketing plan — plan-sections.ts:67-99) plus owner goals (`readOwnerGoals`, growth-overview). Surface B derives everything from the model's prior knowledge.

**Providers and paths:**
- Surface A: runtime router → OpenRouter `chat/completions`, model from the project's runtime model policy (default chain: project defaultModel → platform default → fallbacks, model-policy.ts:38-64), max_tokens 900, temperature 0.75 (market-service.ts:416-430). Identity: project API key if it covers `ai.text`, else workspace identity (market-service.ts:89-139) — usage attributed to the project either way.
- Surface B: legacy AI-SDK `generateText` with the shared analysis `MODEL` (ai-retry.ts:22-29; model.ts:17-21) — **outside** the runtime router, so no runtime_usage record, no project RPM/RPD enforcement, different retry semantics (2 retries, no per-request lease deadline beyond withAiProtection).
- Unused-but-available: Firecrawl `search.web` + `web.scrape` (adapter.ts:35-36; requires `FIRECRAWL_API_KEY`, availability.ts:55-56), with SSRF guards in the shared adapter layer (`lib/runtime/router/adapters/shared/ssrf.ts`) — the exact building blocks Part 4 of the brief asks about, already present.

**Grounding, sources, dates, confidence:**
- Source URLs recorded: no (surface B emits a `url` string per competitor, but nothing fetched it). Sources dated: no — only `generatedAt` timestamps. Facts vs interpretation separated: partially, by prompt instruction only in surface A ("Every statement that is an inference … must be plainly worded as an inference", competition-snapshot.ts:36-38; and the system-wide "Never invent numbers, prices, statistics, rankings, reviews…", market-content.ts:249-251). Confidence levels: none anywhere, invented or otherwise — at least none are *fabricated*.
- Outdated-information awareness: none; no timestamps on claims, no staleness model.
- Hallucination controls: surface A is structurally honest (context-only, forbidden-facts list, inference labeling) — undercut only by the truncation/template defects. Surface B's control is a single sentence "Be accurate and factual" — which does not bind a model asked to produce funding rounds and price ranges for specific companies.

**History and updates:** surface A appends (new content doc per draft, market-service.ts:366-389); surface B overwrites (route.ts:124-131). Neither can update a *claim* while keeping the old one.

**Cost control:** surface A is metered per-call through the central billing path (router.ts:275-322) with a bounded 900-token output — cheap and variable. Surface B is a flat 100 credits for a 3,000-token generation — expensive relative to what it produces, with the idempotency/refund edges noted in §R5. AI protection (quota, lease, deadline, body bound) is applied on both.

**Assessment:** the architecture needed for honest competitive intelligence already exists inside Atai — runtime capability routing, project-key identity, central metering, Firecrawl search/scrape, per-user AI protection, credit ledger. What is missing is *wiring competitor research through it* and *storage for evidence-backed competitor entities*. No new provider is required.

---

## Report 5 — Recommended Competition Center Vision

**Definition.** The Competition Center is the business's external competitive-intelligence owner: it knows who the founder competes with, maintains evidence-backed profiles of each competitor, compares the founder's offer against the field, extracts opportunities, and hands them to Market & Grow as tasks. It does **not** execute marketing (Market & Grow), run ads (Ads), measure the founder's own app (Application Intelligence), or record money (Finances). It informs all four without replacing any.

**Information architecture (five sections, one page — not twelve tabs):**

1. **Overview** (exists — keep). The plan's competitive story: positioning, value proposition, who you're competing for. The honest anchor: everything else is measured *against* this.
2. **Competitors** (new core). A managed list of competitor entities: name, domain, category (direct / indirect / substitute / emerging, founder-overridable), status (suggested / approved / archived). Each profile carries evidence-backed observations — description, products, target audience, pricing, positioning — each observation with source URL + fetch date + which surface it came from. Discovery proposes; the founder approves, edits, removes. Manual add (name or URL) is first-class, because the founder always knows more than the crawler.
3. **Compare** (new, Phase 3). Side-by-side: founder's plan-side (from the spec) vs each competitor's evidence-side — features, pricing, audience, positioning. Every cell traceable to evidence or explicitly "unknown". This is where "what do they do better / where do they disappoint" gets answered from sources, not vibes.
4. **Opportunities & strategy** (new, Phase 3). Gap analysis across the evidence → opportunity items (underserved segments, missing features, pricing openings, differentiation angles), each convertible into a growth task via the existing `propose_growth_task` tool path. SWOT per competitor only after evidence exists to support it; a positioning map (2-axis, founder-adjustable) is cheap and useful here.
5. **History & monitoring** (Phase 4, deferred honestly). Drafts and research runs listed with dates; re-runs produce new observations instead of overwrites. Change detection and notifications wait for a platform job substrate — until one exists the UI must say "monitoring is not available yet", consistent with how campaigns handle the same absence.

**What happens to the two current surfaces.** The plan-derived snapshot draft becomes the *starting point* of section 2 (pre-discovery seed content, clearly labelled "drafted from your plan"). The Resources competitor section is **re-homed into the Competition Center** and either upgraded to the evidence-backed pipeline or reduced to the same plan-derived honesty as surface A — its current "Real competitors" presentation cannot ship as-is (§R1).

**Data architecture (recommendation).** A dedicated `competitors` collection (projectId-scoped, indexed `{ projectId, status, updatedAt }`, unique on normalized domain per project) with an embedded observations array (or a sibling `competitor_observations` collection when monitoring lands). Rationale over reusing `content_items` kit slots: per-competitor identity, dedupe, evidence provenance, and per-observation history are structural, not prose. Snapshots stay in `content_items` as drafts. Discovery runs through the existing runtime identity/metering pattern (market-service.ts:89-139 is the template) so billing lands in finances automatically.

**Reuse checklist (all existing, no new providers):** Firecrawl search/scrape adapter; runtime router + metering; project-key identity resolution; `withAiProtection` + ai-quota; credit ledger + `RESOURCES_CREDIT_COSTS` pattern; library/storage patterns; `CofounderMarkdown` for all rendered AI text; cofounder tool conventions for the strategy hand-off.

---

## Report 6 — Prioritized Implementation Roadmap

**Phase 0 — Reliability and truth fixes (small, no schema changes).**
- *Objective:* make the existing page trustworthy.
- *Improve:* competition snapshot prompt path — stop routing through the studio `brief` kind (own system+user messages, no KIND_INSTRUCTION conflict); raise/remove the 2,000-char truncation for this path or shorten the ask so ask+context fits, and stop double-`clean`; raise the competition context budget above 1,200 chars (its 500-word plan bar makes the current budget structurally impossible); preserve plan headings (don't whitespace-collapse); render the snapshot body through `CofounderMarkdown`.
- *Fix:* remove the "Soon" badge from Competition in both navs (atai-nav.ts:79,101); refund-or-retry when `store.updateProject` fails after charging in surface B; send a `requestId` (scopedIntentKey) from the CompetitorsSection so the charge is idempotent; harden surface B parsing (validate array + element shapes; render-safe fallbacks; stable keys not `c.name`).
- *Database:* add `{ projectId, kind, kit, kitSlot, createdAt }` index on `content_items`.
- *Testing:* unit tests for the new prompt assembly (pure functions, mirror market-content.test.ts) + the fixed brief-length arithmetic.
- *Acceptance:* a 600-word marketing plan appears in the snapshot context un-truncated (assertable in a unit test on the assembled prompt); no literal `##` in the rendered card; navs show no "Soon"; regenerate click-spam produces one charge.

**Phase 1 — Make the honest draft genuinely useful.**
- *Objective:* maximize value while still plan-derived (no external data yet).
- *New:* in-page draft history (list past snapshots with dates, open each); show model + generated-at on the card; seed the draft with any competitor mentions already in the plan/spec (currently none extracted); a "compare yourself" one-pager derived from plan + targetUsers (founder-side only, honestly labelled).
- *Frontend:* all changes inside the existing page/panel; *Backend:* none beyond read endpoints for history.
- *Acceptance:* founder can see and reopen every past draft from the page; card shows model and date.

**Phase 2 — Grounded competitor entities (the core build).**
- *Objective:* real, evidence-backed competitor profiles via existing Firecrawl capability.
- *New functionality:* discovery (search.web for the founder's category + target users → candidate list with relevance rationale), scrape-based profile enrichment (web.scrape per approved domain → structured observations), founder approval/edits/removal, manual add, dedupe by domain.
- *Backend:* `competitors` collection + observations with source URL/date; runtime-router execution with project identity (reuse market-service pattern) so search/scrape are metered and finance-visible; new capability cost entries (extend a costs table like credit-costs.ts); `withAiProtection` on all new routes; SSRF guard verified for founder-supplied URLs (shared/ssrf.ts).
- *Frontend:* Competitors section per Report 5 (list, profile detail, approval queue, add-form).
- *Security:* owner-only checks on every route; no cross-project reads; rate limits via ai-quota.
- *Testing:* route tests with mocked runtime; dedupe unit tests; prompt tests for observation extraction (facts vs inference).
- *Acceptance:* an approved competitor shows ≥1 observation each carrying source URL + fetch date; two founders' projects never see each other's competitors; every search/scrape appears in runtime_usage.
- *Dependencies:* `FIRECRAWL_API_KEY` configured on the deployment (capabilityAvailability gating, same as ai.text today).

**Phase 3 — Compare, opportunities, strategy hand-off.**
- *Objective:* turn evidence into decisions and actions.
- *New:* founder-vs-competitor comparison views (evidence-or-unknown cells); opportunity extraction (gaps → items) with priority; one-click "add as growth task" through existing tools; per-competitor SWOT only where evidence supports each cell; simple positioning map.
- *Acceptance:* every generated opportunity cites competitor evidence IDs; a proposed task appears in the existing growth-tasks list; no SWOT cell renders without a supporting observation.

**Phase 4 — Monitoring (deferred honestly until a scheduler exists).**
- *Objective:* change detection over approved competitors. *Depends on:* a platform job substrate, which does not exist today (campaigns ship plan-only for the same reason). Until then the UI states monitoring is unavailable — no fake "watch" toggles.

**Preserve throughout:** the honesty doctrine and copy voice of surface A; the double ownership checks; central metering; `content_items`-stored drafts (never migrate retroactively — old plans/assets keep reading as they do today, per the combined-plan precedent).

---

## Report 7 — Critical Risks and Technical Debt

**R1 — Ungrounded "real competitors" presented as fact (integrity, highest).** Surface B's entire output is model prior knowledge rendered as researched fact: names, URLs, pricing, funding status (route.ts:50-82; competitors-section.tsx:65-66, 134-143). Directly contradicts the platform's own honesty doctrine two pages away (page.tsx:77-79). A founder making a pricing or positioning decision from invented funding data is a real commercial harm; it is also the kind of claim that fails the moment anyone checks it. *Confirmed by code. Severity: high. Fix owner: Phase 0 relabel at minimum, Phase 2 grounding properly.*

**R2 — Snapshot context truncation (quality).** Ask(750) + header(68) + context(≤~1,300) > 2,000-char `clean()` cap, applied twice (market-service.ts:227; market-content.ts:237), on top of the 1,200-char CONTEXT_BUDGET designed for ~200-char slot asks (launch-kit-content.ts:155-161) and whitespace flattening that destroys plan headings (launch-kit-content.ts:138-142). The prompt's "do not invent facts that are not here" then operates on a fragment. *Confirmed by arithmetic against source. Severity: medium-high.*

**R3 — Conflicting prompt templates (quality).** Strategy-brief KIND_INSTRUCTION (market-content.ts:216-217, injected twice) vs the four-section snapshot ask (competition-snapshot.ts:30-38). Unpredictable output shape. *Confirmed. Severity: medium.*

**R4 — Raw markdown in snapshot body (rendering).** panel:150 vs CofounderMarkdown elsewhere on the same page. *Confirmed. Severity: low-medium (cosmetic but founder-visible).*

**R5 — Billing edges on surface B (billing).** (a) UI never sends `requestId` → no idempotent charge key (competitors-section.tsx:33-35; resources-credits.ts:37). (b) If generation succeeds but `store.updateProject` throws, the charge stands with no result and no refund — the update sits outside the try/catch that refunds (route.ts:124-131 vs 96-122). (c) A lost response after success charges silently (cache written, user sees error, retry costs another 100). *Confirmed by code. Severity: medium (low frequency, real money).*

**R6 — Fragile parsing/rendering on surface B (reliability).** First-`[`-to-last-`]` regex + `JSON.parse` with no shape validation (route.ts:91-95); `key={c.name}` collisions (competitors-section.tsx:110); prompt-requested `founded` never rendered; a non-array JSON object reaching the client can break the section render. *Confirmed by code; runtime manifestation is a lead. Severity: low-medium.*

**R7 — Missing kit index (performance).** Snapshot query `{ projectId, kind, kit, kitSlot }` + createdAt sort has no matching index (collections.ts:589-595 vs competition-snapshot.ts:97-104). Fine now; debt at scale. *Confirmed. Severity: low.*

**R8 — Orphaned snapshots after project deletion (retention).** `deleteProject` cascades build runs + attachments only (mongo-store.ts:536-568); `content_items` survive as unreachable orphans. *Confirmed. Severity: low-medium (data hygiene/privacy).*

**R9 — Nav mislabels a live feature "Soon" (UX truth).** atai-nav.ts:79,101 + sidebar badge (atai-sidebar.tsx:60-64). *Confirmed. Severity: low.*

**R10 — Two AI stacks for the same job (tech debt).** Surface B bypasses the runtime router entirely (ai-retry.ts → analysis MODEL), losing runtime_usage attribution, project-level enforcement, and model-policy control that surface A gets. Consolidation happens naturally in Phase 2. *Confirmed. Severity: low-medium.*

**R11 — No tests on either surface (tech debt).** Zero `*.test.*` matches for competition/competitors; the pure functions (prompt assembly, cost table) are trivially testable once Phase 0 touches them. *Confirmed. Severity: medium for a feature about to grow.*

**Security posture (verified, no finding):** both routes require a session and double-check ownership; library reads are project-scoped (library.ts:131-137); rate limits, body bounds, leases and deadlines apply via withAiProtection; no user-controlled HTML insertion points found (AI text renders as text or through CofounderMarkdown's pipeline); Firecrawl SSRF guards exist for future crawl work. Re-verify SSRF specifically when Phase 2 accepts founder-supplied competitor URLs.

---

*End of audit. Implementation waits for approval.*
