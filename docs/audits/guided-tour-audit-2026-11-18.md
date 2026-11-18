# ATai Guided Tour & User Education — Phase 1 Application Audit

Date: 2026-11-18
Status: AUDIT ONLY. No application code was modified, added, or committed in this pass.
Method: five read-only discovery passes over the working tree, plus first-hand re-verification of every load-bearing citation below. Findings are labelled **CONFIRMED** (code opened), **SUSPECTED** (inferred, not opened), or **UNVERIFIED** (not reached).

---

## 0. Headline

ATai does not need a tour library and does not need a new onboarding screen. It already has:

- a working, ship-quality single-page tour engine (`components/marketing/market-guide.tsx`) with `data-tour` targeting, scrollIntoView, Escape handling, `prefers-reduced-motion` respect and dismissal persistence;
- a `data-tour` attribute convention already live in production markup (`app/project/[projectId]/market/page.tsx:61,71,74,91`);
- a server-persisted onboarding record on the `users` document (`onboarding.completedAt` / `onboarding.dismissedAt`);
- a per-user preference pattern (`PATCH /api/settings/features`, `/api/user/theme`, `/api/settings/ai-model`, `/api/settings/feedback-privacy`) that tour progress can follow exactly.

**A confirmed blocker, not a gap:** the existing onboarding overlay `FirstMission` and a new tour system are two overlapping products. `FirstMission` is a full-screen `fixed inset-0 z-50` overlay mounted on the dashboard (`components/onboarding/first-mission.tsx:400`, mounted via `components/dashboard/command-center.tsx:100`) that hides itself once `projectCount > 0 || completedAt` (`lib/onboarding/state.ts:151`). Any tour engine must be designed *around* it, not beside it.

Three tours listed in the brief cannot be written truthfully today: a global **Market** tour, a global **Hosting** tour and a global **Competition** tour — those routes are honest `ComingSoonPage` placeholders (verified `app/market/page.tsx:1-10`, `app/hosting/page.tsx:1-11`, `app/competition/page.tsx:3-11`). The capability exists per-project; the global surface does not.

---

## 1. Existing onboarding experience (CONFIRMED)

**Entry path.** No `middleware.ts` exists — all auth gating is per-page client-side. Register/login render `AuthPageAdapter` (`components/auth/auth-panel.tsx:523`), default destination `/dashboard` (`:534`), `router.push` at `:549-551`; `loginWithPassword` / `registerWithPassword` (`lib/auth/client-intent.ts:160,183`) then `refreshSessionAfterAuth` polls `/api/me` (`:142-152`). `app/dashboard/page.tsx:13-17` redirects unauthenticated visitors to `/login?next=%2Fdashboard`. Email verification lands on `/dashboard?mission=1` (`components/auth/verify-email-client.tsx:68`).

**What the onboarding is.** `FirstMission` (`components/onboarding/first-mission.tsx:100-704`) is a bespoke full-screen overlay, not a modal or a route. Its steps ("beats") are declared in `lib/onboarding/state.ts:19-32` / `:54-61`: theme, vision, tour video (conditional), email verify (conditional), context, source, role, win, users, pace, intent, plan. Surface resolution: `resolveFirstMissionSurface` (`lib/onboarding/state.ts:142-156`).

**How completion and skipping are recorded.**

| Event | Written to | Field | Evidence |
|---|---|---|---|
| Skip / dismiss | `users.onboarding` | `dismissedAt: number` (epoch ms) | `app/api/auth/onboarding/route.ts:61-63`, `POST /api/auth/onboarding {dismissed:true}` |
| Activation (a real project created) | `users.onboarding` | `completedAt: number` | `route.ts:64-66`, `lib/onboarding/activate.ts:4-17` |
| Type shape | — | `UserOnboarding` `lib/types/db.ts:13-29`, mounted at `:105` |

`dismissed` and `activated` are mutually exclusive in the route (`route.ts:36`). Write is `usersCol().updateOne({ id: user.id })` (`route.ts:68-76`).

**Important nuance for tour design:** `completedAt` means *activated* (a project exists), not *the user finished the walkthrough*. A tour must not read it as "educated".

**In-progress beat state is client-only.** Draft beats live in `sessionStorage` key `atai:first-mission-draft:{userId}` (`lib/onboarding/state.ts:3`, `first-mission.tsx:231-232`). It does not survive a new tab, and it is not server-persisted — so the existing onboarding cannot resume across devices. This is the exact hole Phase 7 of the brief describes, and there is no prior art to reuse for it.

**Restart.** There is no restart control. The only re-entry is the URL param `?mission=1` (`forceMission`, `first-mission.tsx:145`, `state.ts:153`), surfaced by one CTA in `components/dashboard/activation-empty.tsx:15`. **SUSPECTED** no "replay tour" exists in `/settings` — none was found by any pass.

---

## 2. Navigation topology (CONFIRMED)

There is no single navigation source of truth. Four independent nav systems are live:

| Shell | File | Declaration | Mobile |
|---|---|---|---|
| Marketing header | `components/site-header.tsx:33-42` | `defaultLinks: NavLink[]` | inline drawer state `:180-231` |
| App header | `components/app-header.tsx:36-48` | hardcoded `<Link>`s | `DropdownMenu` `:65-112` |
| Workspace sidebar | `components/workspace/atai-sidebar.tsx:117-152` + `atai-nav.ts:85-128` | config array, `kind:"soon"` badges `atai-sidebar.tsx:60-64` | fixed drawer `:141-143` |
| Dashboard shell | `components/dashboard/dashboard-shell.tsx:40-52` | `NAV` / `DISCOVER_NAV` | drawer `:147-176`, collapse state in `localStorage["atai.sidebar"]` `:80-96` |

**Route groups:** none. `find app -name layout.tsx` yields only `app/layout.tsx`, `app/admin/layout.tsx`, `app/admin/blog/layout.tsx`, `app/developers/layout.tsx`. There is **no `(authenticated)` group**, so an authenticated-tour mount has to go at root (`app/layout.tsx:208-216`) or repeat per shell.

**Help entry points today:** `/docs` labelled "Help & support" (`atai-nav.ts:124`), dashboard "Help" → `/docs` (`dashboard-shell.tsx:209-215`, hidden on mobile), plus a floating feedback launcher mounted globally (`components/feedback/atai-feedback-launcher.tsx`, mounted `app/layout.tsx:214`). The brief's "persistent Take a Tour entry point" has a natural home next to these; nothing competes with it.

**Route resolvers already exist:** `lib/navigation/routes.ts:11-38` (`WorkspaceTarget` / `ProjectTarget` → real hrefs, throws on unknown at `:5-8`). Cross-route tour steps should resolve through this rather than stringing paths, and it gives free protection against inventing routes.

---

## 3. Reusable infrastructure (CONFIRMED)

**Providers**, root layout `app/layout.tsx:186-222`, order at `:208-216`: `ThemeProvider` → `AuthProvider` → `CreditGateProvider` → children, then `<AtaiFeedbackLauncher/>` and sonner `<Toaster/>` (`:213`). `ThemeProvider` is bespoke, not next-themes (`components/theme-provider.tsx:93`, localStorage `atai:theme` `:105`, DB preference wins `:136-144`).

**State.** One client zustand store: `lib/store/client-store.ts:139` `useClientStore` with slices `SessionSlice:78`, `ProjectsSlice:96`, `CreditCostsSlice:109`, `ThemeSlice:117`, `LifecycleSlice:128`. SWR is used for live/polling reads. API client `lib/client/api.ts`: `jsonFetcher:106`, `postJson:112`, `putJson:123`, `patchJson:134`, `deleteJson:224`, `postNdjson:152`; envelope unwrap `:93-104`; `ApiError {code,status,meta}` `:87-91`.

**UI primitives present** (`ls components/ui/`): alert-dialog, avatar, badge, button, card, checkbox, dialog, dropdown-menu, input, label, scroll-area, separator, skeleton, sonner, tabs, textarea. Backing lib is `@base-ui/react@1.5.0` (`package.json`), e.g. `components/ui/dialog.tsx:4`.
**Absent, and needed by a tooltip-based tour:** popover, tooltip, sheet, and any overlay/scrim primitive. Dialog convention: scrim `fixed inset-0 isolate z-50 bg-black/10 …backdrop-blur-xs` (`dialog.tsx:34`), content `z-50` (`:53`). Headers sit at `z-20/z-30`, drawers at `z-40/z-50` — **a tour spotlight must exceed z-50 and will collide with `FirstMission`, which already claims z-50** (`first-mission.tsx:400`).

**Accessibility.** `prefers-reduced-motion` is a real convention here: 6 CSS blocks in `app/globals.css:530,605,1767,2412,2450,2585`, `motion-reduce:*` utilities widely used, and JS `matchMedia` guards in six components including `first-mission.tsx:309` and `market-guide.tsx:131`.
**No focus-trap utility exists anywhere** (grep `focus-trap|focusTrap|useFocus` = 0 hits); base-ui dialogs/menus trap internally. A hand-rolled spotlight must build its own trap — this is the single largest a11y cost in Phase 2.
`aria-label` is used on 332 lines and is the dominant naming for icon-only buttons; `sr-only` 37 uses.

**Analytics.** `@vercel/analytics` `track()` is the only event bus (`package.json:22`), centralised in `lib/analytics/start-funnel.ts` — `beginStartFlow:118`, `trackStartMethodSelected:125`, `trackStartSubmitted:145`, `trackWorkspaceCreated:166`, `trackWorkspaceCreateFailed:187`, `trackPlanReady:200`, `trackPlanApproved:236`; `emit()`→`track()` `:106-113`. No PostHog client events, no product-events Mongo collection. Admin funnels currently read `users.onboarding` directly (`app/admin/page.tsx:440-587`). Tour events would extend this pattern, not invent one.

**Dependencies.** No tour/coachmark library is installed (no driver.js, shepherd.js, intro.js, onborda, react-joyride). `@floating-ui/*` exists only transitively under `@base-ui/react` (`pnpm-lock.yaml:414-426`) — available for positioning, but not a declared direct dependency.

---

## 4. Prior art: the engine that already exists (CONFIRMED)

`components/marketing/market-guide.tsx` is a real, running product tour on `/project/[id]/market`:

- `TourStep` type `:21-26`, `TOUR_STEPS` config `:28-53`;
- targeting by `[data-tour="…"]` query + `scrollIntoView({block:"center"})` + skip-missing-step `:120-141`;
- outline spotlight injected via `<style>` `.market-guide-spotlight` `:180`;
- Escape to exit `:143-150`; fixed bottom tooltip card `:253-293` with `role="status" aria-live="polite"`;
- dismissal persisted in localStorage `atai:market-guide-dismissed` `:99-108,154-162`;
- honours `prefers-reduced-motion` `:131`.

What it does **not** do, and what Phase 2 therefore still needs: cross-route navigation and continuation, action verification (waiting for a real workflow result), server-persisted per-step progress, spotlight that blocks the rest of the page, a tour registry, and a Tour Center. This is a partial engine on one page — not a duplicate system to replace.

---

## 5. Feature inventory — what can actually be toured

Legend: **REAL** = working functionality on the user's own data · **GATED** = real but hidden unless a founder toggle / env flag is on · **SOON** = honest `ComingSoonPage` placeholder · **REDIR** = redirect only · **STATIC** = static editorial content, not the user's data.

### 5.1 Global surfaces

| Route | State | What it is | Prereq | Mutates / costs |
|---|---|---|---|---|
| `/dashboard` | REAL | AI co-founder command centre: journey progress, attention items, active project (`components/dashboard/command-center.tsx:24,66-67`) | session | no |
| `/projects` | REAL | Portfolio list with per-project financial roll-up; missing finance data is labelled `hasFinancialData:false` (`app/projects/page.tsx:29-32,79-86`) | session | delete (`workspace.tsx:287,443`), status poll `:486` |
| `/new` | REAL | Start-point chooser: composer locked to idea mode + 3 source cards (`app/new/page.tsx:54,92-99`); GitHub card is tagged "Experimental" (`:43`) | none | nothing until submit |
| `/new/idea`, `/new/website`, `/new/github` | REAL | The three creation forms; sidebar "steps" are static copy (`app/new/idea/page.tsx:17-38`, `app/new/website/page.tsx:33`, `app/new/github/page.tsx:51`) | GitHub connection only for private repos (`github/page.tsx:31-33`) | no |
| `/start` | REAL | Converts a pending start into a real project then `router.replace` → `/project/[id]/collaborate` (`app/start/page.tsx:52-81`); behind `AuthGate` (`:28`) | pending start, else redirects `/new` (`:54`) | **creates a project** (`:60`), records activation (`:71-76`) |
| `/workspace` | REDIR | → `/dashboard` (`app/workspace/page.tsx:8`) | — | — |
| `/finances` | REAL | Whole-portfolio earnings/spend from `getPlatformFinances(user.id)` (`app/finances/page.tsx:26`); read-only | session | no |
| `/ads` | REAL+GATED | Honest per-project index into ad benches; page states "Atai never runs, places, or publishes ads" (`app/ads/page.tsx:10-13,41-44`); gated `isMarketStudioEnabled()` (`:18-26`) | ≥1 project | no |
| `/market` | SOON | `app/market/page.tsx:3-10` | — | — |
| `/competition` | SOON | `app/competition/page.tsx:3-11`, points to per-project | — | — |
| `/hosting` | SOON | `app/hosting/page.tsx:3-11` | — | — |
| `/lessons` | GATED | Free business lesson library; **default OFF** unless founder opt-in (`app/lessons/page.tsx:43-70`, `lib/marketing/feature-flags.ts:250-264`) | — | no |
| `/resources` | REAL/STATIC | Published resource hub (`app/resources/page.tsx:66-68`), signed-out browsable | — | no |
| `/explore` | REAL | Community gallery; like / follow / **fork creates a copy** then redirects (`app/explore/page.tsx:71,85,99-108`) | login to mutate | yes: fork |
| `/notifications` | REAL | Inbox over feature-requests + ad requests; read/dismiss is **localStorage only** (`lib/dashboard/notifications-store.ts:49-79`) | session | local only |
| `/referrals` | REAL | Refer-and-earn (`components/referral-dashboard.tsx:54`); copy link, set/generate code mutate (`:146,179,187`) | session | yes |
| `/contributions` | REAL | User's own bug-report history + credit rewards (`app/contributions/page.tsx:41-45`) | session | no |
| `/feature-requests` | REAL | Public board, submit dialog, voting (`components/feature-requests/board.tsx:48,63-72,188`) | login to post | yes |
| `/account` | REDIR | → `/settings/profile` (`app/account/page.tsx:4`) | — | — |
| `/billing/top-up` | REDIR | → `/settings/billing`; legacy Mobile Money top-ups removed (`app/billing/top-up/page.tsx:3-9`) | — | — |
| `/developers` | STATIC | Runtime-API landing page (`app/developers/page.tsx:41-120`) | — | — |
| `/developers/keys`, `/developers/usage` | REAL | Need `?project=` or show "Select a project" (`components/developers/keys-client.tsx:6-21`, `usage-client.tsx:7-27`) | project | key CRUD |
| `/developers/playground` | REAL | Live API console; discovery GET + real POST execution (`playground-client.tsx:292,472,610`) | key | **executes real, potentially billed calls** |
| `/developers/calcom` | REAL, ADMIN-ONLY | Non-admins redirected (`page.tsx:13-15`); cancels/creates real bookings (`calcom-console-client.tsx:66-79`) | admin | yes — never tour for users |

### 5.2 Per-business workspace

Prerequisite chain (CONFIRMED): idea → co-founder plan (**credits**) → `plan_ready` → build (**credits**) → `totalumProjectId` unlocks source / database / env / edit → deploy → live URL.

| Route | State | Notes and the controls a tour must treat as dangerous |
|---|---|---|
| `/project/[id]` | REAL | Journey stepper + live status (`operating-room.tsx:85-88`); next-action button **POSTs /build, /deploy or /retry and spends credits** (`:162-176,475-483`); auto-redirects to `/collaborate` when plan ready (`:97-114`) |
| `/collaborate` | REAL | The product core (`collaborate-client.tsx`, 4443 lines). Viewable publicly, chat needs auth (`page.tsx:28-31`). Streaming chat **POST /plan-chat spends credits** (`:1675`); "Submit & build" **POST /launch** (`:2657,2706`); auto-complete has an explicit credit-confirm dialog (`:4388`); section editor PATCH (`:882-933`); out-of-credits pauses the run (`:3180`) |
| `/plan` | REAL, read-only | Server-rendered report from `project.*` (`page.tsx:145-190,274-341`); "No plan yet" empty state (`:173-176`); links only |
| `/progress` | REAL | Derived team-progress view; `runMutation` POST /build\|/deploy\|/retry mutates (`team-progress.tsx:73-91`); "Send to co-founder" only drafts text (`:213,244,348`) |
| `/edit` | REAL, highest risk | Preview/Activity/Versions/Logs + Edit/Publish/Settings/Secrets (`page.tsx:272-284`). POST /agent paid build (`:237`), **POST /deploy spends credits** (`:786`), server restart (`:265`), custom domain add/remove (`:923,963`), secrets create/delete (`:1158-1274`), **version rollback** (`:1636`) |
| `/hosting` | REAL | `PublishMenu` deploy **charges credits and publishes** (`components/publish-menu.tsx:49-50`); custom-domain deploy (`:68,79`), DELETE domain (`:95`); empty until `totalumProjectId` (`page.tsx:36-44`) |
| `/studio` | GATED | `isStudioWorkspaceEnabled` else coming-soon (`page.tsx:53-63`). Home is real data; the 8 `SHORTCUTS` all point at `?tab=create` (`:28-37`); generation POSTs `/market/studio`, **paid provider + credits** (`market-studio.tsx:431,354`); states "Nothing here is published or sent anywhere" (`:107`) |
| `/tasks` | GATED | `isGrowthTasksEnabledForUser` else coming-soon with `/settings/features` CTA (`page.tsx:26-37`). Add task POST (`:185`), status transitions (`:275-289`); page load documented free (`:39`). **Not in any nav** (see §7) |
| `/market` | REAL+GATED | `MarketGuide` in-page tour over `data-tour` anchors (`page.tsx:61-114`); LaunchKit "Generate" **charges credits** (`launch-kit-panel.tsx:64-92`); SEO "Run audit" **charges credits** (`seo-audit-panel.tsx:85`); AI docs badged "AI draft · not executed" (`growth-overview-view.tsx:161`) |
| `/market/seo` | REAL+GATED | Paid crawl POST `/seo-audit` (`seo-workspace.tsx:145,297-299`); **empty state until a successful deployment** ("Deploy your website first") |
| `/ads` | REAL+GATED | Save strategy PUT (`ads-strategy-panel.tsx:138`), generate recommendations **credits** (`:164,169`), create campaign-plan draft POST (`:199`), bench drafts POST `/market/ads-kit` **credits incl. image provider** (`ads-bench.tsx:242-273,337-347`), promote wizard submit request (`promote-wizard.tsx:218`, stated free `ads/page.tsx:394`), Requests tab **"Pay N credits"** = money (`ad-request-panel.tsx:137`); analytics results are recorded by hand by Atai staff and labelled by source (`ads-analytics-view.tsx:176,284`) |
| `/campaigns` | GATED | `isCampaignsEnabledForUser` (`page.tsx:25`). Add/edit POST/PATCH (`campaigns-panel.tsx:251,620,751`), Pause/Resume/Complete/Cancel PATCH (`:517`); budget is explicitly "a planning number… never spend, never charged as credits" (`:722`); nothing executes (`page.tsx:17-18`) |
| `/competition` | REAL+CONDITIONAL | Requires MARKET_STUDIO + a plan + Firecrawl + a text model, else a `blockedReason` message (`page.tsx:54-56,91`; `competition-dashboard.tsx:316-324`). "Run live research" is **billed with credits shown** (`:279-289,871`); "Automatic monitoring is not available yet" (`:1142`) |
| `/finances` | REAL, read-only | `runtime_usage` metering + attributed Dodo payments (`lib/finances/project-finances.ts:14-23`); "Earnings feed not configured" state (`project-finances-view.tsx:113-121`); MRR/ARR/valuation are labelled estimates with a basis string (`project-finances.ts:598`) |
| `/intelligence` | REAL | Pure render, "no fetches, nothing invented" (`components/intelligence/overview-view.tsx:13-15`); the only control is `AnalyticsConsentToggle` PATCH, default OFF (`analytics-consent-toggle.tsx:6,27`); badges distinguish measured-zero from "Needs instrumentation" (`:25-29`) |
| `/lessons` | GATED | Same shared curriculum, not project-specific (`page.tsx:158-176`); "Write my lesson pack" **credits**, disabled without idea/plan (`lessons-pack-panel.tsx:90,138-141`) |
| `/resources` | REAL | Rule-derived from spec/state (`page.tsx:33-38`); three **credit-charging** POSTs: market research (`market-intel-section.tsx:37,159`), competitor suggestions (`competitors-section.tsx:58,98`), playbook (`marketing-playbook-section.tsx:49,148`), each gated on balance |
| `/database` | REAL | `InfrastructureManager` Activate/Upgrade POST **deducts credits** (`page.tsx:91,235`) |
| `/database/[tableName]` | REAL | Not found unless built (`:23`); full CRUD incl. delete-with-confirm (`:218,318,668`) |
| `/env` | REAL | Gated "Project not built yet" (`:17-44`); create/update POST (`:63`), **DELETE** (`:81`); values encrypted and never returned (`:65`) |
| `/runtime/*` | REAL | Layout does its own owner check + `/login` redirect (`runtime/layout.tsx:18-21`). Keys: create / rotate / revoke / **delete permanently** (`keys-client.tsx:65,127,101,112`); Models and Limits **PATCH change routing for live apps** (`models-client.tsx:44-58`, `limits-client.tsx:35`); Health "Retry development/production" is a side-effecting infra job (`health-client.tsx:43,78-83`); request bodies are not stored (`requests-client.tsx:9`) |
| `/source` | REAL | Real files streamed from the zip (`source-viewer.tsx:553-641`); replace is an in-memory buffer, **no save endpoint found — UNVERIFIED** |
| `/readme`, `/tree`, `/repo-code` | STATIC | Raw `project.githubReadme` (`readme/page.tsx:43`), `<pre>` tree + naive counts (`tree/page.tsx:17-19`), external zipball link (`repo-code/page.tsx:57,71`); `notFound()` without the field (`:15`) |
| `/promote` | REDIR | → `/ads?tab=promote` (`promote/page.tsx:15`) — skip in tours |

### 5.3 Settings, help and support

`/settings` index is a read-only hub (`app/settings/page.tsx:25-161`). profile PATCH name + avatar + GitHub/Google connect (`:81,104,208,243`); security is the heaviest mutation page — change email (`:137`), change password (`:109`), revoke sessions (`:152-157`), delete account (`:177`); ai engine picker (`components/settings/ai-model-picker.tsx:44`); billing cancel + credit-pack checkout (`:248,342-348`); **features = the 4 founder toggles** (`app/settings/features/page.tsx:54-99` → `PATCH /api/settings/features`); appearance 5 themes (`:101`); feedback privacy 5 checkboxes (`:68`). Docs pages render static markdown from `docs/*.md` with FAQPage JSON-LD (`app/docs/troubleshooting/page.tsx:19-33`, onboarding `:24`, runtime-api `:20`). `/docs` already has a card grid + step list (`components/docs-content.tsx:150-165,215-222`). `/pricing` has an FAQ accordion (`:131,605-608`). Support = floating `AtaiFeedbackLauncher` gated by `/api/feedback/config` (`:101`).

**Existing help precedent to reuse:** `market-guide` (interactive), `OnboardingGuideVideo` embedded in `/docs/onboarding` (`page.tsx:9,200`), `components/admin/onboarding-video-card.tsx` for admin control of that video, and `activation-empty.tsx` for empty-state guidance. The brief's Phase 6 empty-state and Phase 8 contextual-help asks both have prior art.

---

## 6. Who is allowed to see which tour (CONFIRMED)

Flag precedence in `lib/marketing/feature-flags.ts` is: **env kill-switch → founder preference → env hard-on → rollout percent** (sha256 of userId); helper `preferenceFor:65-68`, `clampPercent:58`.

| Capability | Env var | Founder pref (`featurePreferences`, `lib/types/db.ts:62-71`) | Rollout default | Net default |
|---|---|---|---|---|
| Growth overview | `GROWTH_OVERVIEW_ENABLED` (`:34`) | none | 100 | **ON** |
| Market studio | `MARKET_STUDIO_ENABLED` (`:185`) | none | — | **ON** |
| Studio workspace | `STUDIO_ENABLED` (`:155`) | none | — | **OFF** |
| SEO audit | `SEO_AUDIT_ENABLED` (`:73`) | `seoAudit` | 0 | **OFF** |
| Growth tasks | `GROWTH_TASKS_ENABLED` (`:78`) | `growthTasks` | 0 | **OFF** |
| Campaigns | `CAMPAIGNS_ENABLED` (`:83`) | `campaigns` | 0 | **OFF** |
| Lessons | `LESSONS_ENABLED` (`:88`) | `lessons` | 0 | **OFF** |
| Personal lesson packs | `LESSONS_AI_ENABLED` (`:95`) | requires lessons on | — | **OFF** |

Consequence for Phase 4: Tours 6 (Marketing/Advertising), 8 (Competition), 10 (Learning) and any `/tasks` or `/campaigns` step must be **computed server-side per user** before being listed in a Tour Center — the brief's "Only list tours that actually exist and are available to that user" is directly enforceable with these existing functions. Administered defaults live in one `site_settings` doc, `id:"site-settings"` (`lib/site-settings.ts:26,36`; collection registered `lib/db/collections.ts:346-347`), edited at `app/admin/page.tsx:19` via `app/api/admin/site-settings/route.ts` (GET `:12`, PATCH `:27`, `requireAdmin`).

---

## 7. Missing capabilities that block specific tour steps

These are findings, not fix proposals.

1. **No global Market / Hosting / Competition pages.** Tours 5, 6 and 8 as written in the brief would have to start from `/project/[id]/…`. Either the tours are scoped per-project (honest, zero new product work) or the global pages get built first (product work outside this program's scope). **CONFIRMED** §5.1.
2. **`/tasks` is unreachable from navigation.** `atai-nav.ts:43-56` project nav has no Tasks entry, `studio` and `tasks` appear in no nav (workspace pass), and the page is founder-OFF by default. A tour step can only reach it by direct URL — which violates "every registered target must correspond to an actual interface element" in spirit. **CONFIRMED flag gating; SUSPECTED the nav omission is intentional while the feature is opt-in.**
3. **`components/workspace/project-actions.tsx` is dead code** — a gated toolbar (`isBuilt`/`plan_ready`) with no importer found. Do not target it. **CONFIRMED by search; UNVERIFIED that nothing loads it dynamically.**
4. **No tooltip, popover, sheet or scrim primitive** (§3). The tour UI is net-new primitive work, not a wrapper.
5. **No focus trap utility** (§3) — required for Phase 10 keyboard/screen-reader acceptance.
6. **No server-persisted resumable progress for education state.** `users.onboarding` has exactly two timestamps; there is no step/position/paused/skipped shape, and beat drafts are `sessionStorage`-only (§1). Phase 7 needs a new persisted shape.
7. **No product-event collection** for tour analytics (§3); only `@vercel/analytics` `track()`. Measuring "completion" server-side needs either a new event or reuse of a `users` field.
8. **Social-account connections: not found.** Tour 6 asks to explain "Social account connections". No connection surface was located by any pass. **UNVERIFIED → must be confirmed before writing that step; if absent, the step must be dropped rather than described.**
9. **`/explore` fork, `/developers/playground` live calls, `/runtime/health` retry jobs, `/database` infrastructure purchase** are all real, billed, side-effecting controls with no dedicated "sandbox" mode. Phase 5's "action verification" therefore needs an explicit **never-auto-click registry** — steps against these must be Information/Navigation only.

---

## 8. Conflicts and risks against existing functionality

| # | Risk | Evidence | Severity |
|---|---|---|---|
| R1 | **Two overlapping guidance products.** A root-mounted tour overlay will render on `/dashboard` at the same time as `FirstMission`, which already owns `fixed inset-0 z-50` and the same "what is Atai" content | `first-mission.tsx:400`, `command-center.tsx:100`, `state.ts:151` | **BLOCKER-level decision** — must be resolved before Phase 2, not during |
| R2 | **z-index ceiling.** Every existing scrim/panel tops out at `z-50` (dialogs `dialog.tsx:34,53`; drawers `dashboard-shell.tsx:148,157`, `atai-sidebar.tsx:141`). A spotlight above all of them will also cover dropdowns and sonner toasts (`app/layout.tsx:213`) | as cited | Medium — needs an explicit layering rule |
| R3 | **`AuthGate` returns no children for up to 8s** while `isLoading`, so a tour step that navigates into a gated route can time out waiting for its target | `components/auth/auth-gate.tsx:13-32`, `:19` | Medium — the brief's "never leave the user stuck" rule lands exactly here |
| R4 | **`patchJson` and `deleteJson` omit `credentials:"include"`** while `jsonFetcher`/`postJson`/`putJson` set it (`lib/client/api.ts:107,115,126` vs `:135-139`, `:225-228`). Same-origin makes it work today; a tour that persists progress via PATCH inherits this inconsistency | CONFIRMED, read directly | Low as a tour risk; **a real latent bug in shared infrastructure — reported, not fixed** (it is outside this program's scope and touches auth behaviour) |
| R5 | **Four nav systems** (§2): one "businesses-navigation" style selector will resolve differently per shell, so targets must be registered per shell, not globally | as cited | Medium |
| R6 | **Dirty worktree overlap.** 16 tracked files are modified by concurrent sessions right now, including `app/new/page.tsx`, `app/new/idea/page.tsx`, `app/new/website/page.tsx`, `app/new/github/page.tsx`, `app/projects/page.tsx`, `components/new-project/create-shell.tsx`, `components/billing/plan-card.tsx` and `docs/ONBOARDING_GUIDE.md` — i.e. the exact creation-flow files Tour 2 must attach `data-tour` attributes to | `git status` at time of audit | **High process risk** — any Phase 2 edit there must be additive and re-read immediately before writing |
| R7 | **`completedAt` semantics.** It is set by project *activation*, not by education; treating it as "onboarded" would suppress tours for paying users who never watched one | `app/api/auth/onboarding/route.ts:64-66`, `lib/onboarding/activate.ts:4-17` | Medium — affects who sees the Tour Center |
| R8 | **Fabrication risk in tour copy.** Several pages carry deliberate non-claims (ads never published `app/ads/page.tsx:10-13`; campaigns never spend `campaigns-panel.tsx:722`; intelligence "nothing invented" `overview-view.tsx:13-15`; competition monitoring "not available yet" `:1142`). Tour text that promises more than the code does would break this codebase's central honesty rule | as cited | **High** — the auditing culture treats this as a defect, not polish |
| R9 | No ESLint in usable state and only `npx next build` catches prerender/RSC errors (~16 min), so "the tour compiles" cannot be asserted cheaply | project memory + `package.json` scripts | Medium (verification planning, not code) |

---

## 9. Decisions needed before Phase 2

Not open questions about feasibility — choices only the owner can make.

1. **R1 disposition:** does the guided tour *replace* `FirstMission`, extend it (same overlay, real targets), or coexist with a rule for which one shows? This determines whether Phase 2 is additive or refactor work.
2. **Tours for gated features:** show Market/Campaigns/Tasks/Lessons tours only when the founder toggle is ON (recommended: they are simply not listed otherwise), or list them with an "enable this feature" step that writes `featurePreferences`? The second option means a tour mutates account settings and needs its own consent copy.
3. **Global vs per-project for Tours 5, 6, 8** given §7.1.
4. **Progress persistence location:** a field on `users` (follows the existing `onboarding`/`featurePreferences` pattern, one extra write per step) vs a new `tour_progress` collection (cleaner per-tour rows, but a new collection the brief warns against). Existing convention favours `users`.
5. **Tour 2 and real money:** the walkthrough crosses a step that creates a project and then steps that spend credits to plan and build. Confirm the tour stops *before* the credit-charging action every time and never advances on "we assume you'd click this".
6. **Whether `/developers/calcom`, `/admin/*` and live-spending controls are excluded entirely** from all user tours (recommended).

---

## 10. Suggested phasing, based on what actually exists

- **Phase 2 (engine)** should generalise `market-guide.tsx` into the shared engine rather than start fresh: it already satisfies targeting, scroll-into-view, missing-target skip, Escape, reduced-motion and dismissal persistence. Net-new pieces are exactly: cross-route continuation, action verification, registry, server persistence, and the blocking spotlight + focus trap.
- **Phase 2 targeting** should extend the live `data-tour` convention (`app/project/[projectId]/market/page.tsx:61-91`), and Phase 2 should route navigation through `lib/navigation/routes.ts:11-38` so a tour cannot invent a path.
- **Phase 7 persistence** should mirror `PATCH /api/settings/features` (`route.ts:17-24` Zod `.strict()` + `requireUser` + `{id:user.id}` write) — that is the established, ownership-safe shape.
- **Phase 9 admin control** should not build a tour builder: admin is bespoke per domain (§5.3 and pass 4) and there is no generic content editor to reuse. Code-defined typed tour definitions are the honest fit for the first release, which the brief explicitly permits.
- **Phase 10 verification** will depend on the `npx next build` gate for anything touching prerendered pages, and browser checks cannot run against localhost from the available tooling in this environment — plan to verify compiled output plus targeted tests, and say so rather than claim UI verification.

---

## 11. What this pass did NOT do

No files were created under `app/`, `components/` or `lib/`. No package was installed. No test, build or type-check was run. No git commit, push or deploy. The only file written is this report. Nothing in §5–§7 has been verified in a browser; all statements are static-code findings with the citations given, and every UNVERIFIED/SUSPECTED label above still needs opening before it is treated as fact.
