# 6. User Experience and Journey Audit

> Evaluated as a first-time, non-technical founder would experience the product. Page-level findings are compressed; severity is user/business impact.

## 6.1 The experience in one paragraph

A visitor sees a confident promise ("start, build, launch, run and grow a business with an AI team"), can type an idea or paste a URL, and after signup gets a plan that looks structured. The plan is reviewable and editable. Building and publishing are real actions with real progress. Then the experience ends: Home is a project dashboard, the workspace is a build console, finances measure Atai credits, growth produces drafts, and the "AI team" forgets the previous message. The front half is a credible product; the back half is a set of surfaces that describe a product that has not been built.

## 6.2 Top UX blockers (ranked)

### UX-1 (P0) — The money story is inconsistent at the first spend
- Pricing advertises "A simple launch is 50,000 credits" (`app/pricing/page.tsx:27,329`).
- The default new-project path forces `pipelineMode: "heavy"` (`lib/projects/continue-start.ts:10`; `lib/projects/create-project.ts:120`) and the automated build calls `getTierCost(tier, "heavy")` (~2×) (`lib/analysis/pipeline.ts:135`; `lib/credits/credits.ts:62-73`), i.e. 100,000 for a simple build.
- The manual `/build` button calls the flat `getBuildCost(tier)` = 50,000 (`app/api/projects/[id]/build/route.ts:77`).
- The Explorer plan ($12 / 50,000 credits) advertises "about one simple launch a month" (`app/pricing/page.tsx:42`), which is mathematically impossible once the default heavy build plus 500-credit publish are charged.
- **Impact:** the founder is asked to trust the platform with money and immediately sees a different price than promised. This is the highest-severity UX finding because it destroys trust at the conversion moment.

### UX-2 (P0) — Email verification is presented but not enforced, while the reward is gated
`components/auth/auth-panel.tsx:342` calls `onAuthenticated(next)` from the verify view without requiring verification. The 500 welcome credits are tied to verification (free plan card). A founder can proceed believing they verified and land with no credits and no explanation. Evidence: `auth-panel.tsx:342`; `lib/billing/config.ts` (`WELCOME_BONUS_CREDITS`).

### UX-3 (P0) — Mobile cannot see credits or top up
The credit meter is wrapped in `hidden lg:block` (`components/dashboard/dashboard-shell.tsx:163-165`), and the top-up link inside the meter is `xl+` only. On a phone — the device most early founders use — the balance and the way to buy more are invisible, right before a 50k/100k gate. Evidence: `dashboard-shell.tsx:163-165`; `components/credit-meter.tsx`.

### UX-4 (P1) — "Soon" badges on working pages
`components/dashboard/dashboard-shell.tsx:275-283` renders a "Soon" chip for **every** Grow item, while the project finances/lessons/resources pages are live (`components/workspace/atai-nav.ts:74-79`). Working capabilities are advertised as unavailable. The global `/market`, `/ads`, `/competition`, `/hosting` pages are `ComingSoonPage`, so the reverse also happens: live nav links lead to dead ends.

### UX-5 (P1) — The workspace shell fragments at the core handoff
The project home uses `DashboardShell`, but Collaborate, Edit, Source, Environment and Hosting render the public `AppHeader` (`app/project/[projectId]/collaborate/page.tsx:4,37`; same pattern in siblings). The auto-suggested next step from the workspace ("go to Collaborate") drops the user out of their nav, credit meter and workspace context. Evidence verified.

### UX-6 (P1) — Onboarding is skippable forever, and the durable checklist is dead code
- `components/onboarding/first-mission.tsx` is a dismissible full-screen overlay; dismissal is permanent (`lib/onboarding/state.ts`).
- `components/onboarding-checklist.tsx` implements a persistent 4-step vision→plan→build→live checklist but **has no importers** (verified by grep).
- The primary landing CTA goes to `/new/idea`, where the FirstMission overlay does not mount (it mounts on `/dashboard`).
- **Impact:** the founder most in need of guidance (skipped onboarding, then failed) has no way back to a structured next step.

### UX-7 (P1) — Typed intent can be lost before signup
`components/landing/composer.tsx` saves the pending start in `sessionStorage`; the server endpoint requires an authenticated user (`app/api/start/pending/route.ts:25`). A new tab, mobile OAuth round-trip or in-app browser loses the typed idea and resets the funnel. Evidence verified.

### UX-8 (P1) — Micro-spends have no visible price
The pricing FAQ promises the cost is shown before any work (`app/pricing/page.tsx`), but only build and publish costs are surfaced. Chat messages (2), plan analysis (10), autocomplete (8), scrape/crawl and resource artifacts deduct credits with no pre-spend preview. Evidence: `lib/billing/runtime-config.ts` cost constants; no confirmation UI found.

### UX-9 (P1) — No single "first outcome" path
Hero CTA → `/new/idea`; logged-in CTA → `/dashboard`; pricing CTA → `/pricing`; post-auth default → `/dashboard` (`components/auth/auth-page-adapter.tsx`). Three destinations, three post-auth experiences, and Home is a command center rather than a business overview. Evidence verified.

### UX-10 (P1) — The plan review is the least scannable screen for the most consequential click
`app/project/[projectId]/plan/page.tsx` is ~1,333 lines with a dense `sm:grid-cols-2 xl:grid-cols-4` layout. Approving it authorizes the largest credit spend in the product.

## 6.3 Page-by-page status

| Route / surface | Purpose | Status |
|---|---|---|
| `/` | Promise + composer | Real; CTA split (UX-9) |
| `/pricing` | Plans and credit math | Real; contradictions (UX-1) |
| `/new`, `/new/idea`, `/new/website`, `/new/github` | Start a business | Real; cost not previewed |
| `/start` | Handoff | Real; reload-based retry |
| `/login`, `/register` | Auth | Real; verify not enforced (UX-2) |
| `/forgot-password`, `/verify-email` | Recovery | Thin shells; resend affordance unverified |
| `/dashboard` | Home | Real; command center, not business overview |
| `/projects` | All businesses | Real |
| `/project/[id]` | Workspace | Real; build console |
| `/project/[id]/collaborate` | Plan co-founder | Real; public header (UX-5) |
| `/project/[id]/plan` | Plan review/edit | Real; dense (UX-10) |
| `/project/[id]/progress` | Team progress | Real; workstream projection |
| `/project/[id]/edit`, `/source`, `/env`, `/hosting` | Build ops | Real; public header (UX-5) |
| `/project/[id]/intelligence` | App intelligence | Real infra metrics; analytics UI missing; stale copy |
| `/project/[id]/finances` | Project money | Real read-only runtime accounting |
| `/project/[id]/market` | Grow hub | Real when flag on |
| `/project/[id]/ads` | Ads drafts | Real, badged "Soon" (UX-4) |
| `/project/[id]/competition` | Competition | Advisory only, badged "Soon" |
| `/project/[id]/campaigns` | Campaign plans | Real, orphaned from nav |
| `/project/[id]/tasks` | Growth tasks | Real, orphaned from nav |
| `/project/[id]/lessons`, `/resources` | Learning | Real |
| `/project/[id]/database` | Raw app DB | Real CRUD, no CRM semantics |
| `/market`, `/ads`, `/competition`, `/hosting` | Global | **ComingSoonPage** |
| `/finances` | Portfolio money | Real; label overstates scope |
| `/settings/billing` | Plans/credits | Real; `return null` while loading (`app/settings/billing/page.tsx:66`) |
| `/settings/features` | Founder feature switches | Real |
| `/admin/**` | Operations | Real; 19 modules |

## 6.4 Component and state gaps

- **Loading:** billing renders nothing while loading (verified `page.tsx:66`). Several client data surfaces use empty containers rather than skeletons.
- **Empty:** project list has a good empty state; intelligence/growth have honest `not_instrumented` cards; admin has an error state.
- **Error:** `/start` resets to reload + "open form"; no partial-progress explanation.
- **Success:** state vocabulary is broad (`created` … `deployed`), but "ready"/"built"/"live" are easy to conflate; only `deployed` implies public.
- **Mobile:** credit meter invisible below `lg`; project search hidden below `md`; the mobile drawer repeats the same "Soon"/dead-end nav defects.
- **Accessibility:** the mobile drawer sets `aria-modal` correctly; focus-visible rings are used widely. No full accessibility audit was performed.

## 6.5 Terminology and information architecture

Four words are used for the same object: **business**, **project**, **workspace**, **product/app**. Nav says "Businesses"; routes say `/project`; the page says "Workspace" and "Your business"; generated output is "your product". A non-technical founder cannot tell whether these are distinct objects.

Two navigation systems coexist:
- `components/dashboard/dashboard-shell.tsx` (project and dashboard surfaces).
- `components/workspace/atai-sidebar.tsx` + `ataiNav()` (legacy; **no importers**).

`workspaceProjectNav`, `workspaceIntelligenceNav` and `workspaceGrowNav` are the live definitions, but the global `ataiNav` is still used elsewhere. The same capability can be a link in one system and "Soon" in the other.

## 6.6 UI promise versus backend reality

| UI says | Backend does | Evidence |
|---|---|---|
| "A simple launch is 50,000 credits" | Charges ~100,000 on the default path; 50,000 on the manual path | `app/pricing/page.tsx:27` vs `pipeline.ts:135` / `build/route.ts:77` |
| "About one simple launch a month" (Explorer, 50k credits) | Launch costs ~100,500 incl. publish | `app/pricing/page.tsx:42`; deployment cost constants |
| "Free to start — 500 credits" | 500 < minimum build; verification not enforced | `WELCOME_BONUS_CREDITS`; `auth-panel.tsx:342` |
| "You are shown the cost before any work" | Only build/publish are previewed | cost constants; no micro-spend UI |
| Grow items badged "Soon" | Finances, lessons, resources are live | `dashboard-shell.tsx:275-283` |
| "Business finances — your whole business in numbers" | Runtime credits + attributed payments only; no expenses/P&L | `platform-finances-view.tsx:56` |
| "Application Intelligence" | Says events are not collected; ingestion exists but is not shown | `intelligence/overview.ts:334-337` vs analytics adapter |
| "Atai team / squads" | One model with role prompts; template narration | `build-messages.ts`; `team-progress.tsx:365` |
| "Atai plans first — nothing builds until you approve" | **True** — pipeline halts at plan; build requires `/launch` | `pipeline.ts`; `launch/route.ts:50` |

## 6.7 Journey classifications (brief Part 12 scenarios)

| Scenario | Classification | Why |
|---|---|---|
| 1. First-time entrepreneur, idea → validated plan → publish → operate | **Partially successful → blocked at operate** | Idea → plan → build → publish works; validation is ungrounded; no operating tools. |
| 2. Existing business owner brings a business in | **Blocked** | No way to record customers, revenue, expenses or performance; GitHub/website import is shallow. |
| 3. Founder builds an application | **Partially successful** | Generation, edit, version, deploy exist; production quality unverified, auth/storage/payouts incomplete. |
| 4. Founder seeking customers | **Requires manual intervention** | Drafts and an SEO audit only; no publishing, ads, leads, CRM or outcome tracking. |
| 5. Founder facing financial problems | **Blocked** | No P&L, expense records or cash flow; only runtime spend and attributed payments. |
| 6. Founder with an underperforming app | **Blocked** | Ingestion exists but no founder UI, no funnels, no error capture; cannot answer "why". |
| 7. Founder working with an AI team | **Partially successful** | Conversation + approvals work; no memory, shared context, specialists, delegation or business actions. |

## 6.8 Highest-leverage UX fixes (in order)

1. Make the pricing story one number across pricing, pipeline, build route and plan cards.
2. Enforce verification or move the welcome credits off it.
3. Show the credit meter and top-up below `lg`.
4. Remove the unconditional "Soon" badge and drive it from real flag/availability state.
5. Use one shell for all project routes (Collaborate/Edit/Source/Env/Hosting).
6. Re-mount the onboarding checklist or route the primary CTA through it.
7. Point global market/ads/competition/hosting at their working project-scoped versions (or remove the links).
8. Persist anonymous starter intent server-side or survive the OAuth round-trip.
9. Price micro-spends before they happen.
10. Choose one noun ("business") and one nav system.
