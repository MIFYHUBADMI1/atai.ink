# Atai — Existing Business Initialization: Pre-Implementation Audit (Phase 1)

Date: 2026-11-18
Scope: Part A + Part B of the "Bring Your Existing Business to Atai" directive.
Status: **audit only — no application code was modified while producing this report.**
Method: five read-only passes over the working tree (creation flow, website analysis, GitHub, AI orchestration + billing, onboarding + tour surface). Every load-bearing citation below was re-opened and confirmed by the author of this report, not inherited from a subagent summary.

Reading note: this tree is shared with a concurrent session (~70 modified files, plus untracked `lib/tour/`, `components/tour/`, `app/tours/`, `app/api/settings/tours/`, `lib/dashboard/`). Where a file is dirty, that is stated, because it changes what is safe to touch.

---

## 1. Existing capabilities (what is really there)

### 1.1 The canonical business entity — PROVEN
**A "business" in Atai is a `projects` collection document** (`MirrorProject`). There is no separate `businesses` collection, no `workspaces` collection, no membership document. The UI already calls projects "businesses": `app/projects/page.tsx:30` (title "Your businesses"), `app/projects/workspace.tsx:203,557` ("Total businesses").

- Type: `lib/types/project.ts:205-250` — `id, userId, workspaceId?, mode, name, state, sourceUrl?, idea?, understanding?, specification?, events, deployment…, planAnalysis?, githubReadme/FileTree/ZipUrl`.
- `mode: ProjectMode = "website" | "scratch" | "github"` — `lib/types/project.ts:64`, assigned at `lib/projects/create-project.ts:134`.
- Ownership is **single-owner only**: `project.userId === user.id`, enforced by `requireOwnedProject` (`lib/workspace/require-owned-project.ts:5-11`, 404 otherwise). `workspaceId` is attribution (ADR-7) with **no membership enforcement behind it**.
- Creation source today is recorded in two places, neither of which is on the project: `mode` (technical origin) and `users.onboarding.source` (funnel label, free-text — `lib/types/db.ts:14`, `lib/onboarding/state.ts:5-16`; written by `app/api/auth/onboarding/route.ts:42-45`). **No field anywhere means "this business already existed."**

### 1.2 One creation endpoint, four entry points — PROVEN
`POST /api/projects` (`app/api/projects/route.ts:42`) → `createUserProject` (`lib/projects/create-project.ts:102`), used by:
- `components/create-project-form.tsx:90` (`/new/website`)
- `components/create-github-repo-form.tsx:113` (`/new/github`)
- `components/founder-idea-form.tsx:104`
- the composer funnel: `components/landing/composer.tsx:732` → `app/start/page.tsx:60` → `lib/projects/continue-start.ts:56`

What that service already gives us for free (all existing, all preserved if we reuse it):
- auth (`requireUser`, `route.ts:44`)
- rate limit `project_create` 10/hr (`create-project.ts:115-119`)
- plan/entitlement gate returning 402 (`:123-132`, `lib/billing/entitlements/require.ts:27`)
- **idempotency**: `idempotencyKey` → `findCreateIdempotency`/`saveCreateIdempotency` (`:104-113`, `:220-224`) plus a separate `findRecentDuplicate` guard keyed on `sourceUrl`/`idea` (`:72`, `:207-208`)
- URL normalization + validation (`:201-206`, `normalizeUrl` at `lib/integrations/firecrawl/service.ts:90`)
- `skipAnalysis` flag (`CreateProjectInput:26`) which suppresses `void startProjectPipeline(project.id)` (`:193,229,249`)

The four `/new` surfaces are thin: `/new` is a hub (`app/new/page.tsx:54`, composer + three source cards `:16-45`), `/new/idea|website|github` each render `CreateWorkspaceShell` + one form, and `components/new-project/create-shell.tsx:5` is **presentation only** (no state, no submit). Client funnel mode is `StartMode = "idea"|"website"|"url"|"github"` (`lib/start/detect-input.ts:1`), mapped to server `mode` at `lib/projects/continue-start.ts:44-51`.

### 1.3 Website reading — PROVEN, and it is substantial
Firecrawl is the only scraping backend (`lib/integrations/firecrawl/client.ts`: `scrapeUrl:199`, `mapUrl:206`, `crawlSiteUrl:222`, `searchWeb:161`, `searchMultiSource:114`; server-only import at `:1`; env `FIRECRAWL_API_KEY:7`). There is no cheerio/jsdom/DOMParser path and no arbitrary-site fetcher.

`crawlWebsite` (`lib/integrations/firecrawl/service.ts:287`) does map → score → scrape ≤7 pages, 20k chars/page (`:15,:194`), returns `WebsiteEvidence`, and **is already cached per URL** in `firecrawl_cache` (`lib/db/collections.ts:165-166`, unique index `:714`) with a 7-day TTL (`service.ts:19,61-88`). `crawlWebsiteDeep` at `:372`. A second, SSRF-guarded single-page path exists: `crawlUrlToEvidence` (`lib/marketing/seo/crawl.ts:32`).

Interpretation of evidence is also already built: `analyzeWebsite` (`lib/analysis/understanding.ts:116`) produces `ProjectUnderstanding` (pages, navigation, entities, design system) and it is persisted per project (`lib/analysis/pipeline.ts:307-347`, also as an `ai_artifacts` `kind:"understanding"` doc). Deterministic SEO checks exist in `auditWebsiteEvidence` (`lib/marketing/seo/auditor.ts:149`): HTTPS, title, meta description, headings, links, duplicates. Screenshots exist (`lib/screenshots/capture-app-preview.ts:16` → `project.understanding.screenshots`).

### 1.4 AI orchestration — PROVEN
Two substrates: platform-side OpenRouter via `@ai-sdk/openai-compatible` (`lib/analysis/model.ts:5,17-24`, `openRouterChatModel:29`) and the metered runtime router (`lib/runtime/router/router.ts:126`, capability table `runtime/contracts/router.ts:106`).

The established pattern for a long structured artifact is **one-shot `generateText` + `extractJson` + zod gate, wrapped in charge-then-refund** (`lib/analysis/understanding.ts:158-181`; `lib/marketing/seo/recommendations.ts:215`; `lib/analysis/plan-analysis-service.ts:92-104`). There is no `generateObject` in the repo. Streaming chat is `streamRawCompletion` (`lib/analysis/raw-chat.ts:166`). Tool-using turns are `runAgentTurn` (`lib/cofounder/agent.ts:77`, 6 steps, 240s timeout).

Co-founder context is **one function we can extend**: `buildActiveProjectBrief` (`lib/cofounder/context.ts:100-138`), consumed by `buildAgentContextBlock` (`lib/cofounder/prompts.ts:45-109`). Conversations live in `cofounderConversations` (`lib/db/collections.ts:266`, capped `MAX_MESSAGES=200`, `lib/cofounder/conversation.ts:20`). Untrusted content fencing is a shared helper — `wrapUntrustedContent` → `<untrusted_${type}>` (`lib/planning/utils/security.ts:59-67`) — plus hard honesty devices already in prompts: "Do not invent facts about the business; where the plan lacks information, that itself is a finding (a 'gap')" (`lib/analysis/cofounder.ts:731`), and a filter that *drops* model items claiming unmeasured metrics (`lib/marketing/seo/recommendations.ts:132-144`).

### 1.5 Async processing — PROVEN
The house pattern for a multi-second AI + scrape pipeline is **fire-and-forget server pipeline + status state machine + client polling**: `void startProjectPipeline` (`create-project.ts:193`), claim slot (`lib/projects/pipeline-recovery.ts:248`), states `created/analyzing/analysis_complete/pending_plan/plan_ready/analysis_failed/plan_failed` (`:245,255`), auto-retry (`:220-227`), stall recovery on reload (`recoverStalledPipeline:333`), client polls `/api/projects/[id]/status` every 3s (`app/project/[projectId]/collaborate/collaborate-client.tsx:3440`). SEO audit runs inline in its POST route. Cron exists only for billing sweeps (`vercel.json:3-11`).

### 1.6 Billing primitives — PROVEN
`checkRateLimit` (`lib/auth/rate-limit.ts:11`), `withAiProtection` (`lib/api/ai-protection.ts:10,43-58`), ledger with durable idempotency keys (`consumeCredits`/`grantCredits`, `collaborationIdempotencyKey` `lib/analysis/collaborate-credits.ts:18-26`, `chargeAnalysisCredits:114`, `refundCollaboration:73`), `scopedIntentKey` (`lib/billing/operation-identity.ts:70-84`), reserve→release for builds (`lib/billing/credit-service.ts:678,705`). Existing prices in the same family: `scrape 5 / heavyScrape 100 / deepCrawl 500 / heavyDeepCrawl 1000` (`lib/billing/runtime-config.ts:67-74`), `planAnalysisCost 10`, `collaborate.chatMessageCost 2` (`:29-33`), SEO audit 15 credits (`lib/marketing/seo/credits.ts:24-30`) with refund-on-failure wired (`seo-audit/route.ts:159-165`).

### 1.7 Onboarding / workspace — PROVEN
`resolveFirstMissionSurface` (`lib/onboarding/state.ts:142-156`) hides the from-scratch overlay when `projectCount > 0 || completedAt`. `completedAt` means *a project was activated*, set by `recordOnboardingActivation` (`lib/onboarding/activate.ts:4-17`) from the creation forms — it does **not** mean "was educated". Mission beats are sessionStorage-only (`FIRST_MISSION_DRAFT_KEY = atai:first-mission-draft:<userId>`, `state.ts:3`; `flowVersion: 2`, `state.ts:51` — the one existing flow-version precedent). Post-create destination is always `/project/<id>/collaborate` (`create-project-form.tsx:109,114`), where the first-run experience is a **static** intro card rendered when `messages.length === 0` (`collaborate-client.tsx:1988-2016`, "I know your idea. Let's make it stronger." `:1996`). Per-user gating for built businesses is new and untracked: `lib/dashboard/built-states.ts:11-20`, `lib/dashboard/business-access.ts:13-16`, `components/workspace/business-locked.tsx:13,59`.

### 1.8 Tour system (the concurrent session's code — read only)
`TourDefinition` / `TourStep` at `lib/tour/types.ts:80-97,45-70`; registration via `TOUR_ROUTES` (`lib/tour/routes.ts:20-72`), `TOUR_TARGETS` (`lib/tour/targets.ts:30-124`), `MAIN_TOURS`/`PAGE_TOURS` (`lib/tour/registry.ts:8-27`); DOM binding is `data-atai-tour="<id>"` (`targets.ts:18`). Copy lives in `lib/tour/tours/*.ts` (~157 steps; the `/new` flow is `createBusinessTour`, `lib/tour/tours/getting-started.ts:162-224`, anchored on `new-composer` (`components/landing/composer.tsx:852`) and `new-method-${id}` (`app/new/page.tsx:130`)). Progress is per-user `users.tourProgress` (`lib/tour/server.ts:44-48`) + localStorage mirror.

**There is no tour content versioning.** No `version`/`schemaVersion` on `TourDefinition`; only `TourProgress.updatedAt` (`types.ts:104`) and a render-time `revision` counter (`lib/tour/engine/store.ts:54`). Drift is instead caught mechanically by `lib/tour/validate.ts:26-33` (unknown target/route id fails) and `lib/tour/targets.test.ts` (a referenced anchor disappearing from markup fails the suite). Consequence for this feature: **the tour reflects a UI change only if the copy is edited; the tests only punish you for deleting an anchor someone already points at.** See §9, decision D4.

---

## 2. Reuse map — what the new journey can use as-is

| Directive need | Existing capability | Verdict |
|---|---|---|
| Canonical business record | `MirrorProject` + `createUserProject` | Reuse whole. Do not add an entity. |
| Idempotent init, no dup business on refresh | `idempotencyKey` + `findRecentDuplicate` (`create-project.ts:104-113,207`) | Already satisfies §10 STEP 4 / §16 recovery. |
| Auth, ownership, rate limit, plan gate | same service + `requireOwnedProject` | Reuse. |
| "Does your business have a website?" URL input + validation | `normalizeUrl` + `assertPublicHttpUrl` + `crawlUrlToEvidence` | Reuse; add the SSRF guard to the crawl path (see §3.2). |
| Website → business intelligence | `crawlWebsite`/`crawlWebsiteDeep` → `analyzeWebsite` | Reuse the **read** half; do **not** reuse `startProjectPipeline` (it generates a plan/app). |
| SEO fundamentals, CTAs, nav, contact, socials | `auditWebsiteEvidence` (`seo/auditor.ts:149`) + `ProjectUnderstanding` | Reuse; both are already deterministic + evidence-backed. |
| Read-only GitHub | existing OAuth (`lib/auth/github.ts:29`, `app/api/auth/github/callback/route.ts`), `listUserRepos` (`client.ts:62`), `getRepo/getRepoTree/getReadme` (`client.ts:84,90,121`) | Reusable with two fixes (§3.3). |
| Assessment generation | one-shot `generateText` + `extractJson` + zod + refund | Reuse the exact SEO/competition shape. |
| Storing the assessment | `ContentItemDoc` with `kit`/`kitSlot` (`lib/types/db.ts:818-820`) — the competition-report pattern, validated-then-persisted, project-authorized (`lib/marketing/competition-snapshot.ts:76-150,180-200`) | Reuse; avoids a new collection. See D2. |
| Co-founder awareness | `buildActiveProjectBrief` + `buildAgentContextBlock` + a READ tool in `lib/cofounder/tool-registry.ts:58-113` | Reuse. No new agent. |
| Processing states + recovery | project state machine + `/status` polling | Reuse; don't invent a job system. |
| Credits | existing keys + `scopedIntentKey` refund | Reuse; pricing is a decision (D3). |
| UI | `CreateWorkspaceShell`, existing cards/buttons/inputs, `DashboardShell` | Reuse; zero new primitives, no new dependency. |

---

## 3. Required extensions to existing code (and why)

### 3.1 A lifecycle marker on the project — smallest possible
Add optional fields to `MirrorProject`; **do not widen `ProjectMode`** (it is branched on in `create-project.ts:134`, `continue-start.ts:44-51`, `workspace.tsx:67-75` `modeLabel`, `command-center.tsx:46`, `lib/cofounder/context.ts:35` — a fourth value is a cross-cutting regression risk for no gain). Recommended shape (additive, backward compatible, no migration):

```
startingPoint?: "from_scratch" | "existing_business"
intake?: { source: "website" | "github" | "description" | …, objectives: string[],
           websiteUrl?, repoOwner?, repoName?, description?, targetCustomers?,
           additionalContext?, status?, assessedAt? }
```
An existing-business project should be created with `mode: "scratch"` + `skipAnalysis: true`: it is the only combination that (a) keeps the later "build me a website/app" path intact, and (b) cannot trigger mirroring — `mode: "website"` implies mimicry (`lib/start/detect-input.ts:8,49`).

### 3.2 SSRF: the crawl path used by intake must be guarded
`assertPublicHttpUrl` (`lib/runtime/router/adapters/shared/ssrf.ts:97`) is thorough — scheme, embedded credentials, blocked hosts, `.local/.internal/.localhost`, RFC1918/loopback/CGNAT, IPv6 ULA, v4-mapped, decimal/hex/octal encodings. **But it is only applied on `seo/crawl.ts:37` and `firecrawl/mapper.ts:5,22`.** `crawlWebsite` / `runWebsiteAnalysis` (`create-project.ts:201-206` → `pipeline.ts:251,293`) run on `normalizeUrl` alone, with **no host policy**. Also self-documented at `ssrf.ts:8-9`: *DNS-rebinding protection is out of scope*, and no `redirect: "manual"` exists for website fetches — redirect hops are delegated to Firecrawl's network. Fix for intake: call `assertPublicHttpUrl` before any intake crawl. Remaining exposure (rebinding, per-hop redirects) is a **pre-existing platform property, not something this feature introduces** — worth its own decision, not a silent scope expansion.

### 3.3 GitHub: two genuine defects sit in the reuse path
1. `lib/projects/create-project.ts:139-193` performs **no token check and no `getRepo` verification** before running analysis (compare `app/api/projects/[id]/github/route.ts:56,74`), so `runGitHubAnalysis` silently calls GitHub unauthenticated (`lib/analysis/github-pipeline.ts:52-53`) and only fails later with a "connect in Settings" message (`:80`).
2. Extend mode builds a **credential-free zipball URL** (`github-pipeline.ts:274`) and hands it to users and to the AI prompt (`plan/page.tsx:726`, `:321`) — private repos cannot work through it, and owner/repo are interpolated unencoded there while `client.ts:85,98,112` does encode.

Working today: `getReadme` + `getRepoTree` **with** the user's `repo`-scoped token (`github-pipeline.ts:70,113`) — that is a real read-only path for private repos. Not available at all: languages, `package.json`/dependencies (`getFileContent` exists at `client.ts:104` and is called by nothing), branches, commits, issues/PRs. 404 is swallowed as "missing README" (`client.ts:137`) and 403 rate-limit is indistinguishable from permission-denied (no 429 branch). Token is stored **plaintext** in `users.githubAccessToken` (`lib/types/db.ts:93`), never refreshed, and **there is no disconnect/revoke route or UI** (`app/settings/profile/page.tsx:202-213` is connect-only) — while `components/docs-content.tsx:974` claims otherwise.

### 3.4 Co-founder context must learn about intake
`buildActiveProjectBrief` currently injects `idea`, `planHealthPercent`, `planBrief`, `hasBuiltApp`, `deployedUrl`, `analyticsConsentEnabled` (`context.ts:100-138`) — it does **not** read `project.understanding` or `ai_artifacts`. Extending this one function (bounded digest) + one READ tool is the whole integration; no second context service exists or is needed.

### 3.5 Files that are dirty right now (collision surface)
`app/new/page.tsx|idea|website|github`, `components/new-project/create-shell.tsx`, `components/landing/composer.tsx`, `lib/types/db.ts`, `lib/onboarding/*`, `components/onboarding/first-mission.tsx`, and ~60 page/component files are modified by the concurrent session; `lib/tour/**`, `components/tour/**`, `app/tours/**`, `lib/dashboard/**` are untracked-new there. **Verified clean and safe to build in:** `lib/cofounder/*`, `lib/analysis/*`, `lib/projects/*`, `lib/integrations/firecrawl/*`, `lib/marketing/*`, `lib/billing/*`, `lib/runtime/*`, `lib/types/project.ts`, `lib/types/ai-artifacts.ts`, `lib/planning/*`. Note `app/new/page.tsx`'s current diff also swaps `AuthGate`→`DashboardShell` and removes a fetch to `/api/auth/github/status`, **a route that does not exist** (`app/api/auth/github/` has only `route.ts` and `callback/`) — i.e. that file is mid-edit on exactly the screen this feature must extend. See D4.

---

## 4. Genuine gaps (net-new, everything else is reuse)

1. **Intake route + service**: `POST` handler that accepts website?/repo?/description+objectives, validates, creates the canonical project with the §3.1 marker, and kicks a bounded analysis job. Nothing equivalent exists.
2. **An "intelligence, not build" analysis mode**: the scrape→interpret machinery exists but every existing caller ends in plan/app generation. We need a path that stops at evidence + understanding. ~1 small function over existing pieces.
3. **The assessment itself** (schema, prompt, zod validation, persistence, renderer). No existing report has the §13 section set; closest template is the competition snapshot.
4. **Repository tech-stack assessment**: reading `package.json`/manifests via the already-written-but-unused `getFileContent`, plus distinguishing "not found" from "no permission". Small, real extension of `lib/analysis/github-pipeline.ts` — and the only piece that needs care not to re-enter generation.
5. **Objectives taxonomy** (the nine suggested objectives) and their mapping to *existing* Atai routes for "recommended next actions". Nothing today stores objectives (`UserOnboarding.businessGoal`/`intent` are user-level free text, `lib/types/db.ts:13-29`).
6. **Tour/education coverage for the new surface** (per the standing rule that shipped changes get reflected in the tour), which requires the D4 answer.

Explicitly **not** gaps — do not build these: another business entity, another creation form system, another AI agent, another GitHub auth, another job queue, another settings screen, another onboarding overlay.

---

## 5. Architecture and data flow (proposed, all on existing rails)

```
/new (hub, +1 source card)
  └─ /new/existing  (CreateWorkspaceShell + progressive form; 4 steps, client state)
        │
        ├─ STEP 1 website (optional)   → normalizeUrl + assertPublicHttpUrl
        ├─ STEP 2 repo (optional)      → existing OAuth; GET /api/github/repos picker
        │                                → getRepo verification (token attached)
        ├─ STEP 3 description/objectives (name prefilled from evidence when present)
        └─ STEP 4 review → POST /api/projects  { mode:"scratch", skipAnalysis:true,
                        startingPoint:"existing_business", intake…, idempotencyKey }
                                   │
                    createUserProject  (auth, rate limit, entitlement, dedupe — unchanged)
                                   │
                    void runExistingBusinessIntake(projectId)      [new, fire-and-forget]
                       ├─ crawlWebsite/crawlUrlToEvidence → analyzeWebsite → project.understanding
                       ├─ getRepo/getRepoTree/getReadme/getFileContent → repo evidence   (optional)
                       ├─ each source records its own outcome; one failing never voids the other
                       └─ generateText + extractJson + zod → assessment doc (kit:"assessment")
                                   │
                    project.state: analyzing → analysis_complete / *_failed  (existing machine)
                    client polls /api/projects/[id]/status (existing) → /project/<id>/collaborate
                                   │
                    buildActiveProjectBrief + new READ tool → AI Co-founder has the context
                    next-action links → only routes that exist (Market/Grow/Ads/Competition/
                    Finances/plan/editor), computed against lib/marketing/feature-flags.ts
```
No new collection (assessment as `kit:"assessment"` content items), no new dependency, no schema migration, no change to any existing journey's code path.

---

## 6. Risk assessment

**Regression risks**
- R1 — touching `mode`/`ProjectMode` or `continue-start.ts` would affect all four existing journeys. Mitigation: additive optional fields only (§3.1). *(Low, by design.)*
- R2 — `lib/types/db.ts`, `app/new/*` and ~60 files are mid-edit by another session; edits there can be swept into their commits or conflict with theirs. This is the **highest-probability way this feature breaks something unrelated.** *(High until D4.)*
- R3 — reusing `crawlWebsite` inherits its Firecrawl credit costs and the 7-day cache; a user re-submitting the same URL is free, but a re-crawl is a real charge. Refund must follow the SEO `intentKey` pattern or §16 "no double-charge on retry" fails.
- R4 — `project.understanding` is written by the generation pipeline too (`pipeline.ts:307-347`); an intake project that later starts a build could see one overwrite the other. Needs an explicit ownership rule for that field.

**Security risks**
- S1 — SSRF: intake must use `assertPublicHttpUrl`; residual DNS-rebinding + per-hop-redirect exposure is pre-existing and provider-delegated (`ssrf.ts:8-9`). Not introduced by this feature; flagged, not silently fixed.
- S2 — **prompt injection is currently unsolved on the GitHub path**: README + file tree are concatenated raw into the spec prompt (`github-pipeline.ts:226-233,318-336`) with no `<untrusted_*>` fence, and README is re-rendered to users via `MarkdownBlock` (`plan/page.tsx:713`). Directive §12/§17 forbids executing or trusting repo content; we must fence and sanitize in whatever we add, and should treat this existing hole as a separate reported finding rather than an in-scope drive-by.
- S3 — credentials: `GitHubApiError` embeds up to 200 chars of raw GitHub response into messages returned to the browser (`client.ts:35` → `app/api/github/repos/route.ts:37`, `github/route.ts:125`) and into project events (`github-pipeline.ts:172`). Token is plaintext at rest (`db.ts:93`). Any new repo code must not widen this; report it as an existing finding.
- S4 — no rate limit on `/api/github/repos`, `/api/projects/[id]/github`, or `POST /api/projects` (`checkRateLimit` is used elsewhere, e.g. `tasks/route.ts:113`). Intake inherits the *service-level* `project_create` limit but its crawl/repo-preflight calls need their own.
- S5 — `build-from` repo connection imposes **no ownership/permission requirement** (only `push` checks `permissions.push`, `github/route.ts:75`): any repo the token can merely *see* is attachable. Directive §10 explicitly warns against assuming access from public visibility — our picker must verify `getRepo` and record the outcome, not just accept a label.

**Data / billing / launch**
- D-layer: no migration needed (raw driver + optional fields), but `startingPoint` will be absent on ~all existing projects, so **every read must treat "absent" as `from_scratch`**.
- Billing: an intake that silently spends 5→1000 scrape credits depending on crawl mode would be a support problem; the review step must show cost before "Analyze and Bring My Business to Atai" (directive §16).
- Honest-claim risk: the biggest failure mode here is shipping copy that says "we analyzed your stack / traffic / competitors" when only a README tree and 7 pages were read. Directive §11/§12/§13 forbid it, and Atai already has the mechanism (`claimsUnmeasuredMetric`, `seo/recommendations.ts:132-144`) to enforce it.

---

## 7. Implementation plan (the directive's checkpoints, sized)

| # | Task | Touches | Est. |
|---|---|---|---|
| 1 | Additive schema: `startingPoint`, `intake`, objectives enum in `lib/types/project.ts`; "absent = from_scratch" helper | `lib/types/project.ts` (clean) | S |
| 2 | `lib/existing-business/intake.ts`: validation (normalize + `assertPublicHttpUrl`), evidence fetch, per-source outcome capture, idempotent status writes on the existing state machine | new file in a clean area | M |
| 3 | Assessment generator: prompt + zod schema (the 9 §13 sections), one-shot `generateText`, charge/refund via existing keys, persist as `kit:"assessment"` content item | new + reuse `competition-snapshot.ts` shape | M |
| 4 | Repo read-only preflight + tech-stack evidence via `getRepo/getRepoTree/getReadme/getFileContent`, fenced as untrusted, honest 403/404/429 separation | `lib/analysis/github-pipeline.ts` (clean) or a sibling module | M |
| 5 | Wire `POST /api/projects` to accept the additive intake payload (no behavior change for existing callers) + intake route | `app/api/projects/route.ts`, `create-project.ts` (both clean) | S |
| 6 | `/new/existing` progressive form + hub card + review/consent screen; prefill from evidence; existing design system only | `app/new/page.tsx` **(dirty)**, `app/new/existing/page.tsx` (new), `components/new-project/*` **(dirty)** | M |
| 7 | Workspace + onboarding adaptation: skip idea-first-mission for `existing_business`, conditional collaborate intro copy (`collaborate-client.tsx:1988-2016` **(dirty)**), next-action links from real routes | dirty files — sequence after the tour session lands | S/M |
| 8 | Co-founder context digest + READ tool; objectives → section mapping | `lib/cofounder/*` (clean) | S |
| 9 | Tests per §18 (initialization, website validation incl. SSRF matrix, repo permission matrix, no-fabrication assertions, dedupe/idempotency, billing refund) | `lib/existing-business/*.test.ts` | M |
| 10 | Tour coverage (D4-dependent) | `lib/tour/**` (owned by the other session) | S |

---

## 8. What is NOT verified (stated plainly)

- **No live end-to-end proof that a private GitHub repo can be assessed today.** The token path is read-only-proven in code (`github-pipeline.ts:70,113`); nobody demonstrated a successful private-repo run, and `create-project.ts:139-193` never checks the token before starting that run. Verification needs a connected account in CI/dev, not a code read.
- Whether `MarketAssetKind`/`kit` unions (`lib/types/db.ts:709,818-820`) can be extended without touching a file the concurrent session is editing — `db.ts` is currently modified (tour additions only, per diff).
- Firecrawl runtime-adapter pricing settlement inside `pricing-service.ts` (not fully read) — affects what a deep crawl actually debits.
- Whether any existing non-`/seo-audit` route accepts an arbitrary URL for analysis (only own-deployment confirmed).
- DNS-rebinding and per-hop-redirect behaviour: cannot be proven from source; the guard explicitly excludes it (`ssrf.ts:8-9`), and it is provider-side.
- This report has **not** been through `npx next build` or vitest — nothing was changed, so nothing was verified that way. Treat §7 estimates as design intent, not as tested work.

---

## 9. Decisions needed before implementation (with recommendations)

**D1 — What does the GitHub step claim in Phase 1?**
The honest options: (a) *connect + read-only assessment of README, file tree, and manifest-declared stack, verified against `getRepo` with the user's existing token* — buildable on proven capability; (b) also claim languages/commit history/maturity — **requires new API surface we have not validated**; (c) defer the repo step to a "connected sources" section and ship website+description only — matches the directive's own rule "if the existing GitHub integration cannot support private repository access securely, do not pretend it can".
**Recommend (a)**, and additionally: fix or delete the credential-free zipball claim (`github-pipeline.ts:274`) as its own finding, since it misleads users today.

**D2 — Where does the assessment live?**
Recommend: a `kit: "assessment"` content item (existing collection, existing authorization model, validated-then-persisted precedent in `competition-snapshot.ts`), referenced from `project.intake`. Alternative if you prefer project-local reads: an `initialAssessment` sub-document on the project — one less indirection, bigger project docs. Either way: **no new collection.**

**D3 — What does initialization cost?**
Existing knobs already cover the parts (`scrape 5/100`, `deepCrawl 500/1000`, `planAnalysisCost 10`, SEO 15). Recommend: intake = existing scrape cost for the chosen crawl mode + one analysis-grade charge, with the price shown on the review step and refund-on-failure via `scopedIntentKey`. Recommend **not** inventing a new "existing business" price. Your call whether the first intake for a new account is free as an acquisition move — that is pricing, not engineering.

**D4 — Who owns `/new` and the tour copy right now?** (blocking)
The concurrent session is actively editing `app/new/page.tsx`, `create-shell.tsx`, `composer.tsx`, `first-mission.tsx`, `collaborate-client.tsx`, `lib/types/db.ts` — six of the exact files tasks 6–8 must touch, and the tour registry is theirs. Options: (a) I work only in clean files now (schema, intake service, assessment generator, repo preflight, co-founder context) and land the `/new` + collaborate UI edits after their tour work is committed; (b) I edit the dirty files immediately and accept entanglement, committing pathspec-only; (c) you tell me those edits are already settled.
**Recommend (a)** — it also satisfies "the tree must stay clean for the other agent".

**D5 — Tour versioning for shipped changes** (your standing rule)
There is no version/changelog concept in `lib/tour` (§1.8) — coverage is enforced only by anchor tests. Adding a `version` field to `TourDefinition` is a change to *their* schema. Recommend: for this feature I add/extend tour steps + anchors alongside the UI, and file the missing-versioning gap for the tour session to implement, rather than editing their types. Confirm, or I'll do exactly that and note it in the final report.
