# ATai Guided Tour & User Education System — Phase 12 Implementation Report

Date: 2026-11-18
Scope: the 12-phase "Product-Wide Interactive Guided Tour & User Education System" directive.
Predecessor: Phase 1 audit at `docs/audits/guided-tour-audit-2026-11-18.md`.

Read-the-fine-print rule applied throughout: **nothing below is claimed as working merely
because a tour definition or a tooltip exists.** Where a capability was verified only by
pure-function tests and static markup scans — and not by a browser — that is said in the
sentence where it matters, not buried in a limitations footnote.

---

## 1. Initial application audit findings

Phase 1 was delivered before any code, as the directive requires. Headline findings that
shaped every later decision (full detail in the audit document):

- **No re-entry path for guidance.** The only way back into onboarding content was the URL
  param `/dashboard?mission=1`. `users.onboarding.completedAt` means *project activation*,
  not "was educated", so it could not be reused as a comprehension signal.
- **`FirstMission` already owned the dashboard overlay** (`fixed inset-0 z-50`) and the same
  "what is Atai" message. Two guidance products pointing at one screen was the main overlap
  risk; disposition was an open owner decision, so the shipped behaviour is *coexistence by
  deference* (see §3, last bullet).
- **Prior art worth generalising, not duplicating:** `components/marketing/market-guide.tsx`
  already did `data-tour` targeting, `scrollIntoView`, missing-target skip, Escape close,
  reduced-motion handling and dismissal persistence for one page. The net-new work was
  cross-route continuation, real action verification, a registry, server persistence and a
  responsive overlay layer. Because `data-tour` was already taken by that component, the tour
  engine anchors on a distinct attribute: **`data-atai-tour`**.
- **Global `/market`, `/hosting`, `/competition` are honest `ComingSoonPage` placeholders.**
  Tours 5/6/8 of the brief could therefore only be written per-business, not portfolio-wide.
- **Gated surfaces.** `/tasks` and `/studio` are in no navigation, and the founder toggles
  `seoAudit` / `growthTasks` / `campaigns` / `lessons` default **OFF**. Any tour list computed
  client-side would have promised pages the founder cannot reach, so availability is resolved
  server-side from `lib/marketing/feature-flags.ts` — the same resolvers the pages themselves use.
- **Many tour-worthy controls are billed or destructive** (build/deploy/launch, SEO crawl,
  competition research, ad placement quotes, runtime key delete, model-policy PATCH). This
  became a structural rule, not a copy rule (see §6).
- **Nothing resumable was persisted.** Beat drafts lived in `sessionStorage` only.

## 2. Pages and features inspected

- The route catalogue the tours use was enumerated from `lib/tour/routes.ts` — **48 route ids** —
  and each one was checked for a real `app/**/page.tsx`. That check is now a test, not a memory
  (§10), and it passes.
- Feature surfaces read before writing copy: dashboard and command centre, business list and
  workspace, plan report, co-founder chat, build/progress, editor, hosting/deployments/domain,
  runtime (overview/usage/health/keys), database, env, market & grow (launch kit, studio link
  card, SEO), ads (strategy/bench/requests), campaigns, competition, intelligence, portfolio and
  per-business finances, settings (features, billing/credits), lessons, resources, explore, docs,
  support.
- Dead code was identified before being annotated: `components/workspace/atai-sidebar.tsx` and
  `ataiNav()` are unreferenced. The live shell is `components/dashboard/dashboard-shell.tsx`.
  Initial annotations landed on the dead sidebar and were reverted; all discoverability work is
  on the live shell.
- The concurrent-session state of the tree was re-read before editing; the files other agents had
  in flight (`lib/domain/`, `lib/existing-business/`, `requiresBuilt` gating, `resend/config.ts`,
  `.env.example`) were not touched.

## 3. Tour architecture implemented

Code: `lib/tour/**`, `components/tour/**`, `app/tours/page.tsx`, `app/api/settings/tours/route.ts`
(~2.4k lines including tests; no new runtime dependency).

| Layer | Files | Responsibility |
| --- | --- | --- |
| Vocabulary | `lib/tour/types.ts`, `routes.ts`, `targets.ts` | Route ids → real paths; target ids → label + shell + **risk** + project scope. |
| Catalogue | `lib/tour/tours/*.ts`, `registry.ts` | 26 typed tour definitions; availability filtering; category grouping. |
| Integrity | `lib/tour/validate.ts`, `progress.ts` | Rejects definitions that would lie to a founder; one shared record sanitiser. |
| Server truth | `lib/tour/server.ts`, `app/api/settings/tours/route.ts` | Context and progress computed from real flags and ownership. |
| Runtime | `lib/tour/engine/{store,resolve,verify,geometry,persist,use-tour-runtime}.ts` | Position, step filtering, verdicts, spotlight/tooltip geometry, mirroring, navigation. |
| Overlay | `components/tour/tour-{root,runtime,card,spotlight}.tsx` | Lazy mount, portal, spotlight ring, explanation card, paused affordance. |
| Discovery | `tour-center.tsx`, `page-tour-launcher*.tsx`, `entry-points.ts`, `app/tours/page.tsx`, shell nav | Tour Center, per-page launchers, empty-state links. |

Decisions that carry the safety rules:

- **Navigation without `usePathname`.** `useSearchParams` in a statically prerendered route needs
  Suspense and has broken builds before; the engine polls `window.location` (400 ms + `popstate`)
  instead, so a tour survives route changes without adding a data dependency to any page.
- **Laziness is structural.** `app/layout.tsx` mounts `TourRoot`, which renders nothing until a
  launcher calls `requestTour` / `preloadTourEngine`; only then does the `next/dynamic` chunk with
  the store, engine and overlay load. The shell pulls in only two small tour modules — the 46-line
  `PageTourLauncher` gate and the ~40-line `entry-points.ts` route table it reads — and `entry-points`
  derives its patterns from `TOUR_ROUTES` rather than repeating URLs. A test keeps that gate from
  drifting from `PAGE_TOURS`, so the laziness cannot quietly rot into eager loading.
- **The founder's own actions are never intercepted.** The scrim is `pointer-events-none`
  everywhere; the spotlight ring is drawn with a box-shadow hole rather than a blocking overlay,
  so the control a step describes is the control the founder presses.
- **Coexistence with `FirstMission`.** While `[data-onboarding-mission]` is in the DOM, the tour
  layer keeps both its overlay and its launchers out of the way (a `MutationObserver`, disconnected
  on unmount). The existing first-run experience is not replaced and not competed with.

## 4. Tours created

10 cross-page tours as the brief asked, plus 16 single-page tours (26 total, 157 steps).
Availability columns are what the server resolves per founder, not what the file says.

| Tour | Category | Min | Steps | Needs | Hidden unless |
| --- | --- | --- | --- | --- | --- |
| `welcome` | Getting started | 6 | 16 | — | always available |
| `learning` | Getting started | 4 | 7 | — | `lessons` toggle on |
| `create-business` | Building a business | 12 | 16 | — | always available |
| `workspace` | Managing a business | 9 | 13 | 1 business | project |
| `cofounder` | Managing a business | 8 | 10 | 1 business | project |
| `hosting` | Managing a business | 7 | 13 | 1 business | project |
| `market` | Growing a business | 9 | 12 | 1 business | `marketStudio` |
| `finances` | Understanding finances | 7 | 10 | — | always available |
| `competition` | Advanced features | 6 | 7 | 1 business | `marketStudio` |
| `intelligence` | Advanced features | 6 | 8 | 1 business | project |
| `page-projects`, `page-create`, `page-dashboard`, `page-collaborate`, `page-plan`, `page-market`, `page-ads`, `page-hosting`, `page-finances`, `page-intelligence`, `page-runtime`, `page-competition`, `page-features`, `page-billing`, `page-explore`, `page-docs` | (per page, listed under "One page at a time") | 2–3 | 2–3 each | varies | page's own gates |

Teaching intent, not button-pointing, drove the content. Examples of the framing that ended up in
copy: a wrong plan section becomes wrong ads and a wrong application (`page-plan`); visitor and
conversion numbers are *not collected*, and the market page says so instead of showing zeros
(`market` / `page-market`); a placement request is a quote you accept and pay for, and Atai does
not run ads itself (`market` → `ads-requests`); the plan you write before your first customer is
"a hypothesis with your name on it" (`page-plan`).

## 5. Routes covered

- 48 route ids in `TOUR_ROUTES`, split `global` / `portfolio` / `project` scopes. Project-scoped
  ids carry `{project}` and `resolveTourRoute` encodes the id, so a stale or hostile business id
  cannot produce a path outside `/project/…` (tested: `"../../admin"` → `/project/..%2F..%2Fadmin`).
- Every id used by a tour step (`route:` for navigation, `verify: { type: "route" }` for proof) is
  checked against a real `app/**/page.tsx` file by `lib/tour/routes.test.ts`.
- Route matching ignores hashes, tolerates a trailing slash, and — the part that matters for tabs —
  a destination with a query is only satisfied when those query parameters are actually present.
  `?tab=library` cannot be "completed" by landing on `/studio`.
- Cross-page navigation is real navigation (`router.push`), and the engine waits for the location
  to match before declaring a step done; if the expected page never appears inside the wait budget
  the card says so and offers Continue/Skip rather than spinning.

## 6. Interactive actions supported

Step kinds in the shipped catalogue: **138 `info`, 10 `click`, 5 `navigate`, 4 `input`,
1 `action`** (157 steps). Verification types declared: 2 `route`, 5 `element`, 18 `manual`.

- The engine **never advances because something was clicked somewhere**. It advances on an
  observation: the location really arrived at the expected page, or the promised element really
  exists in the DOM, or the founder confirmed they did it.
- Interactive steps with no declared proof default to `manual` — the founder presses "I've done
  this". They are never auto-assumed. Of the 15 interactive steps, 14 are founder-confirmed and 1
  is route-verified.
- **Spend safety is structural, not advisory.** Every target declares a `risk`
  (`none` / `credits` / `money` / `settings-write` / …); `validate.ts` refuses a definition that
  asks the founder to *operate* a control that is not `none`; and the tour never clicks, types,
  submits, deploys, publishes or deletes anything — it can only navigate to a page. The result is
  that no tour step can spend a credit, place an ad, publish a build or destroy data. 28 steps
  flag `costsCredits`, and each of those now says in its own copy that credits are used (four of
  them previously hid that behind a flag; the copy was fixed rather than the flag deleted).
- Waiting is bounded: 6 s default, 0.5–20 s clamp, and an element that never appears produces an
  honest "this part is not on the page right now — it may belong to another stage, a feature that
  is switched off, or a business you have not made yet" with a way forward. No indefinite loading
  state exists in the engine.

## 7. Persistence implementation

- **Server:** one field, `users.tourProgress: { [tourId]: { step, status, updatedAt, paused?, skipped? } }`.
  No new collection, and no second preference system: availability is *read* from the existing
  `featurePreferences` on the same document, and there is no tour-specific toggle to drift out of sync.
- **API:** `GET /api/settings/tours` returns `{ progress, context }` for the signed-in founder only
  (`requireUser`). `POST` writes one tour's record; `tourId` is validated against the registry before
  it is ever used as an object key, the schema is `.strict()`, `step` is clamped to that tour's own
  length, and the write is a read-modify-write of the whole map — the key never reaches the query
  language, so a crafted `__proto__` / `constructor` / dotted path cannot address another field.
  Unknown tour ids and malformed bodies return 422 **with no write** (all asserted in tests).
- **Sanitising on both sides:** `lib/tour/progress.ts` drops anything unusable instead of coercing it
  into a plausible zero (non-numeric step, unknown status, >200 tours, >200 skipped ids, oversized keys).
  A garbage stored map is ignored, not fatal.
- **Refresh mid-tour:** `components/tour/tour-runtime.tsx` mirrors progress to
  `localStorage["atai:tour-progress:<userId>"]` synchronously on every change, then sends a debounced
  (700 ms) POST. On hydrate the server record and the local mirror are merged newest-entry-per-tour,
  so a refresh resumes at the last observed stop even if the request never landed, and the mirror is
  keyed by user id so a shared browser does not leak one founder's position to another.
- **Cancel ≠ complete ≠ forget.** Exiting stores the position as `in-progress`; the Tour Center offers
  *Resume at stop n* and *Start over*; a completed tour can be re-run ("Run it again"). Skipped steps
  are recorded per step id and de-duplicated, and they survive exit and completion as data — see §13.12
  for what the engine does and does not do with that record.
- A tour that is paused mid-session persists `paused: true`, and the paused state is reachable again
  in-session (see §9).

## 8. Responsive implementation

`lib/tour/engine/geometry.ts` holds the layout as pure functions, because "test actual small-screen
dimensions" is not something a desktop layout with a reduced width can prove.

- **Breakpoints:** `<640px` mobile, `<1024px` tablet, else desktop (`layoutMode`).
- **Phones get a bottom sheet, always** (`placeTooltip` returns `side: "overlay"`). Anchoring a card
  to a small target on a 360px screen overlaps the very control being described, so the card detaches
  from the target and sits at the bottom with `EDGE` gutters.
- **Tall elements clamp** to a viewport-sized window with the element scrolled inside it, floor 160px;
  a spotlight that covers the whole screen tells the founder nothing.
- **Sticky chrome is respected:** `STICKY_TOP = 64` keeps the ring from hiding the app header, and
  `needsScroll` drives the scroll-before-highlight decision.
- **Zero-size boxes are rejected** (a hidden tab panel must not produce a ring in the top-left corner),
  and off-screen targets are scrolled into view before measurement.
- **Tablet/desktop placement** picks the side with more room and clamps horizontally inside `EDGE`.
- Verified at 360×640, 375×667, 393×852, 768×1024, 1024×768, 1440×900 — 30 tests in
  `lib/tour/engine/geometry.test.ts`. The card itself uses the same responsive signature as the rest of
  the product (`inset-x-3 … sm:left-auto sm:right-3 sm:w-[380px]`), so a phone never sees a clipped card.
- **What this does not prove:** the numbers above are geometry, computed and asserted without a browser.
  The overlay's actual painted result at those sizes was not screenshotted (§13).

## 9. Accessibility improvements

- Each stop moves focus to the card heading (`role="heading" aria-level={2}`, `tabIndex={-1}`), so the
  step is read out and the card is reachable by keyboard alone.
- A separate `sr-only aria-live="polite"` region announces "Step n of m: title" without stealing focus
  back from a control the founder is mid-way through using.
- The card is a labelled landmark (`<section aria-label="Guided tour">`); every overlay is
  `aria-hidden="true"` and `pointer-events-none`, so the dim never traps a pointer or a screen reader.
- Keyboard: `Esc` exits, `←`/`→` step. Typing in an input, textarea, select or contenteditable element
  suppresses the shortcuts. **While paused or finished, the arrow keys are deliberately inert** — moving
  a founder through steps they cannot see is not an accessibility feature — while `Esc` still gets out.
- Controls that carry no text have labels (`aria-label="Exit the tour"`, `aria-label="Pause the tour"`);
  `Prev` is `disabled` on the first stop rather than silently wrapping.
- Motion respects `prefers-reduced-motion` (`motion-reduce:transition-none` on ring and progress bar).
- Colours come from the existing theme tokens (`bg-card`, `text-muted-foreground`, `border-border`), so
  dark/light contrast is the product's, not a one-off.
- **Cancellation at every stage**, which the brief makes non-negotiable, is what surfaced two real traps
  during this pass: (1) `TourCard` renders nothing while paused and the runtime returned early, so a
  founder who pressed the advertised Pause had no in-session way back — now `TourPausedPill` (Resume /
  End here) renders while `status === "paused"`; (2) the keyboard still stepped a paused tour invisibly,
  and on the last stop `→` would silently finish it — now gated as above.
- There is **no focus trap**. That is a decision, not an omission: a trap would block the real controls
  the founder is being taught to use. The card is reachable and dismissible by keyboard; the interface
  underneath stays fully operable.

## 10. Tests created

8 new files, **129 tests**, all in `lib/tour/**` (they run in the repo's existing `node` vitest
environment — no jsdom, no new dependency, no DOM mocking of the app).

| File | Tests | What it refuses to let rot |
| --- | --- | --- |
| `lib/tour/targets.test.ts` | 4 | Every registered target exists as `data-atai-tour` in shipped markup, and every anchor in markup is registered. Scans `app/` + `components/` files directly; a guard assertion (`>30` ids found) stops it passing vacuously. |
| `lib/tour/routes.test.ts` | 9 | Every route id resolves to a real `page.tsx`; scope ↔ `{project}` agreement; path traversal is encoded away; longest-prefix matching; a stale business id yields no route; the lazy `entry-points` gate equals the `PAGE_TOURS` set. |
| `lib/tour/validate.test.ts` | 18 | The whole catalogue passes the integrity rules, **and** each individual rule fires on a synthetic bad step (unregistered target, credit-spending instruction, unregistered route, project route without `requiresProject`, …). |
| `lib/tour/engine/store.test.ts` | 24 | Start/resume/clamp, exit ≠ complete, skip de-dup and honour, pause/resume, immutability, revision bumps, engine laziness. |
| `lib/tour/engine/verify.test.ts` | 14 | Verdicts: route matching incl. query params, element presence, manual confirmation, waited-out → `blocked`. |
| `lib/tour/engine/geometry.test.ts` | 30 | The responsive rules in §8 at six device sizes. |
| `lib/tour/progress.test.ts` | 13 | The sanitiser drops junk instead of coercing it; newest-entry merge; negative step lifts back onto the first stop. |
| `lib/tour/tours-route.test.ts` | 17 | The API writes only under the caller's own id, rejects unknown tour ids and extra fields with 422 **and no write**, clamps the step, preserves other tours, ignores a garbage stored map, 401s without a session. |

## 11. Existing tests executed

- Full suite: **276 files, 3297 passed, 2 todo (3299), 0 failed**, 488s (`npx vitest run`, job
  `b0fi97byt`, started 2026-11-17 00:15 local). Nothing pre-existing was skipped or excluded, and no
  pre-existing test was edited to accommodate the tour work.
- That run predates the final four edits of this session (paused affordance, keyboard gate, the
  `studio-library` target, the `market` tour's library-step route). Those edits are covered by the
  post-edit re-runs below: `npx vitest run lib/tour` → 8 files / **129 passed** (10:23), and a
  whole-program type check.
- The repo's ESLint configuration remains unusable (documented in earlier audits); it was not used as
  a gate.

## 12. Test results

| Gate | Command | Result |
| --- | --- | --- |
| Tour unit/integration tests | `npx vitest run lib/tour` | **PASS** — 8 files, 129 tests |
| Full suite | `npx vitest run` | **PASS** — 276 files, 3297 tests, 2 todo |
| Whole-program types | `npx tsc --noEmit` | **FAIL (exit 2) — 0 errors in tour code.** All reported errors are in `lib/domain/**` and `lib/existing-business/**`, untracked files belonging to another session's in-flight work. |
| Production build | `npx next build` | **NOT VERIFIED.** Turbopack "Compiled successfully in 11.4min" (which includes my routes), then the build aborted at its own type-check gate on those same unrelated files. Prerender never ran, so **`/tours` prerender/RSC safety is unconfirmed**. |

A correction worth stating plainly: an earlier line in this session reported "`tsc` exited 0". That
reading came from `… | tail`, whose exit code is `tail`'s, not `tsc`'s. The real exit code is 2, from
a run that measured `${PIPESTATUS[0]}`. Nothing in this report rests on the bad reading.

### Per-tour evidence: which steps were checked against actual application functionality

The automated checks are honest about what they are: **the target column was validated against the
product's shipped files** (a real element carrying `data-atai-tour`, or the test fails), and **the route
column was validated against a real `page.tsx`**. What was *not* done for any tour is a browser
click-through: this repo has no DOM test layer (vitest runs `node`, jsdom is not installed), so no test
asserts that the overlay painted correctly or that a real founder's click satisfied a step.

| Tour | Steps | Targets asserted present in shipped markup | Routes asserted to resolve to a real page |
| --- | --- | --- | --- |
| `welcome` | 16 | dashboard-overview, dashboard-journey, nav-businesses, projects-list, project-overview, cofounder-chat, app-publish, market-overview, ads-overview, portfolio-finances, resources-hub, nav-help, nav-tours | dashboard, projects, project, projectCollaborate, projectHosting, projectMarket, projectAds, portfolioFinances, resources, docs |
| `create-business` | 16 | new-composer, new-method-idea, new-method-website, new-method-github, project-overview, plan-report, cofounder-input, team-progress, project-next-action, app-editor, app-publish, market-overview | newBusiness, project, projectPlan, projectCollaborate, projectProgress, projectEdit, projectHosting, projectMarket |
| `workspace` | 13 | project-overview, project-journey, project-next-action, plan-report, cofounder-chat, team-progress, app-editor, app-publish, market-overview, competition-dashboard, finances-overview, intelligence-overview | projectPlan, projectCollaborate, projectProgress, projectEdit, projectHosting, projectMarket, projectCompetition, projectFinances, projectIntelligence |
| `cofounder` | 10 | cofounder-chat, cofounder-input, plan-report, team-progress, app-editor, tasks-board, project-next-action | projectPlan, projectProgress, projectEdit, projectTasks, project, projectCollaborate |
| `hosting` | 13 | app-publish, project-journey, app-domain, app-deployments, app-editor, runtime-overview, runtime-usage, runtime-health, runtime-keys, database-manager, env-manager, project-overview | projectHosting, projectEdit, projectRuntime, projectRuntimeUsage, projectRuntimeHealth, projectDatabase, projectEnv, project |
| `market` | 12 | market-overview, market-launch-kit, market-studio, studio-library, market-seo, ads-overview, ads-bench, ads-requests, campaigns-board, cofounder-input, finances-overview | projectTasksStudioTab, projectMarketSeo, projectAds, projectAdsBench, projectAdsRequests, projectCampaigns, projectCollaborate, projectFinances |
| `finances` | 10 | portfolio-finances, finances-overview, settings-credits, settings-billing-checkout, runtime-usage, cofounder-input | portfolioFinances, projectFinances, settingsBilling, projectRuntimeUsage, projectCollaborate |
| `competition` | 7 | competition-dashboard, cofounder-input | projectCompetition, projectCollaborate |
| `intelligence` | 8 | intelligence-overview, intelligence-consent, runtime-health, cofounder-input | projectIntelligence, projectRuntimeHealth, projectCollaborate |
| `learning` | 7 | lessons-library, resources-hub, resources-research, docs-hub, tour-center-list | lessons, projectLessons, projectResources, docs, tourCenter |
| `page-projects` | 3 | projects-list, projects-new | — (single page) |
| `page-create` | 3 | new-composer, new-method-idea | — |
| `page-dashboard` | 3 | dashboard-overview, dashboard-journey, dashboard-actions | — |
| `page-collaborate` | 3 | cofounder-chat, cofounder-input, project-next-action | project |
| `page-plan` | 3 | plan-report, cofounder-input | — |
| `page-market` | 3 | market-overview, market-launch-kit, market-studio | — |
| `page-ads` | 3 | ads-overview, ads-bench, ads-requests | — |
| `page-hosting` | 3 | app-publish, app-domain | — |
| `page-finances` | 3 | finances-overview, runtime-usage | — |
| `page-intelligence` | 3 | intelligence-overview, intelligence-consent, cofounder-input | — |
| `page-runtime` | 3 | runtime-overview, runtime-usage, runtime-keys | — |
| `page-competition` | 3 | competition-dashboard, cofounder-input | — |
| `page-features` | 2 | settings-features | — |
| `page-billing` | 3 | settings-credits, settings-billing-checkout | — |
| `page-explore` | 2 | explore-gallery, explore-fork | — |
| `page-docs` | 2 | docs-hub, support-report | — |

Two authoring errors that these checks caught, and how they were fixed rather than papered over:

- `market` → `library` pointed at `market-studio`, an anchor that exists only on the market page, while
  the previous step had navigated the founder to `/studio`. It would have shown "not on the page right
  now" every time. Fixed by annotating the real Content library section
  (`components/marketing/studio-library.tsx` → new `studio-library` target) and routing the step to
  `?tab=library`, so the tab's query is part of the proof.
- Four steps flagged `costsCredits` while their copy never mentioned credits. Copy rewritten to name the
  credit cost, because the flag is not the disclosure.

## 13. Known limitations

1. **No browser or DOM test layer.** vitest runs in `node` and jsdom is not installed, so overlay
   painting, focus movement, `MutationObserver` target detection and real click-through verification
   are covered by pure functions plus static markup scans — not by a browser. §8/§9 claims are geometry
   and code, not observed pixels. This is the single biggest gap in the delivery.
2. **`/tours` prerender is unverified** because `next build` aborts at its type-check gate on unrelated
   untracked code (§12). Compilation of the route succeeded; execution/prerender did not run.
3. **Location arrival is polled, not evented** (400 ms interval + `popstate`), chosen to avoid the
   `useSearchParams`/Suspense build hazard. A tour can therefore lag up to ~400 ms behind a real
   navigation, and a programmatic redirect that finishes between polls is detected one poll late.
4. **Progress is last-writer-wins per tour.** The POST is a read-modify-write, not a transaction: two
   devices finishing the same tour concurrently can drop one record. No cross-device conflict is
   detected or reported.
5. **The `localStorage` mirror is best-effort** (`atai:tour-progress:<userId>`): private mode, quota or
   a disabled storage API degrades to server-only, and write failures are swallowed by design.
6. **14 of 15 interactive steps rest on the founder's own confirmation**, not on an observation. The
   engine is honest about that (it asks), but it means "completed" for those steps means "you said you
   did it", not "we saw it".
7. **Definitions are code, typed and validated** — no admin authoring surface. Phase 9 explicitly
   permits this for a first release; it also means adding a page costs three coordinated edits
   (route id, target id + anchor, step), which is why the three consistency tests exist.
8. **No measurement of the tours themselves.** Progress is persisted per founder, but nothing aggregates
   completion rates or drop-off steps, so "this tour teaches successfully" is currently unproven.
9. **`FirstMission` coexistence is deference, not resolution.** While the mission overlay is open the
   tour hides its overlay and launchers; nobody has decided whether the two should merge, and the
   `MutationObserver` on `document.body` is the price of that deferral.
10. **Gated features are counted, not itemised.** The Tour Center says "N tours are hidden on your
    account" and links to `/settings/features`, but does not name them or explain each gate.
11. English-only copy; no per-tour localisation.
12. **Skips are remembered as data, not as behaviour.** `progress[tourId].skipped` is written, de-duped,
    sanitised and preserved across exit and completion, but `resolveTour` filters steps only by feature
    and business availability — it does not read that set. So a step skipped last week is offered again
    on the next run. The record exists to make this a small change; it is not yet that change.

## 14. Missing features that prevented certain tours

These tours were not written because the product does not do the thing, not because the copy was hard:

- **Portfolio-wide "manage your hosting / grow your market / research your competition" tours.** The
  global `/market`, `/hosting`, `/competition` routes are honest `ComingSoonPage` placeholders; only the
  per-business pages are real. Those tours are written against `/project/{id}/…`.
- **"See how your marketing performed."** Atai does not collect visitor, conversion or campaign
  performance data. The market and ads tours teach what *is* measured (deployment state, runtime calls,
  checkout calls, credits spent, plan completeness) and state that analytics are absent, rather than
  pointing at a fake dashboard.
- **"Let Atai publish / post / run your ads for you."** Nothing posts, sends, publishes or places ads on
  a founder's behalf; drafts land in the library and paid placement is a quote the founder accepts. The
  ads tour teaches the gate instead of pretending to walk through it.
- **"Run an SEO crawl from the tour."** It needs a live deployment and spends credits, so the step is
  navigation + explanation only, and the crawl itself is left to the founder.
- **Tours for the founder-gated capabilities** (`lessons`, `growthTasks`, `campaigns`, `seoAudit`) exist
  but stay hidden until the founder switches the feature on — most accounts will not see the tasks step
  of `cofounder`, the lessons steps of `learning`, or the campaigns step of `market`.
- **A "connect your own private repository end-to-end" tour.** The GitHub intake path is real, but the
  claims about private-repo handling were overstated in the earlier initialization audit, so the
  `create-business` tour describes the flow without promising behaviour the backend does not guarantee.
- **Scheduled / automatic guidance nudges** (e.g. "your deployment failed, here is the tour for this").
  The platform has no job substrate for deferred execution yet, so contextual help ships as the on-page
  launcher strip only, and no tour claims to be proactive.

## 15. Recommended next improvements

1. **Close the browser gap.** Install jsdom, add one `TourLayer` render test (spotlight found / missing /
   paused / finished) and run a real 360×640 pass with `@testing-library/react` or a scripted browser
   session. Until then, §8 and §9 stay "verified by geometry and code".
2. **Re-run `npx next build` once `lib/domain/**` and `lib/existing-business/**` type-check**, to get the
   prerender gate for `/tours` and the modified shells.
3. **Convert `manual` verdicts into observations** wherever a real signal exists — a saved plan section,
   a created draft, a deployment record — so completion means something beyond self-report. Do the same
   for limitation 12: let `resolveTour` honour `progress[tourId].skipped` on a resume, while "Start over"
   keeps offering every step.
4. **Aggregate tour outcomes** (completion rate, first drop-off step, hidden-tour counts) into the
   existing admin analytics surface, read-only. Without it the program cannot say whether it teaches.
5. **Settle the `FirstMission` decision with the owner.** If it merges into the tour engine, delete the
   observer and the param entry point; if it stays, give it its own tour slot so the dashboard has one
   voice.
6. **Replace the location poll** with router transition hooks once they are safe under static
   prerendering, removing the ~400 ms detection lag.
7. **Name the hidden tours** in the Tour Center with the specific switch each one needs, instead of a
   count plus a link.
8. **Make concurrent progress writes conflict-safe** (per-tour `$set` with a validated key, or an
   `updatedAt` guard) before multi-device use is advertised.
9. **Surface the entry point in `/docs`** and add a one-line explanation of what a tour does, so
   discoverability does not rest entirely on the nav chip.
10. **Only then consider admin-authored tours.** The typed, validated catalogue currently enforces the
    safety rules (§6) structurally; any authoring surface must re-implement those validations server-side
    or it should not ship.

---

### Non-negotiable rules — where each one now lives

| Rule | Enforcement |
| --- | --- |
| Audit before implementation | Phase 1 document shipped before any engine code. |
| No fake buttons / simulated functionality | Every target id must exist as `data-atai-tour` in shipped markup (`targets.test.ts`, both directions). |
| No invented unavailable features | Availability resolved server-side from `lib/marketing/feature-flags.ts`; ComingSoon pages have no tours (§14). |
| No automatic credit/money spend | `risk` per target + `validate.ts` rejection + interactive steps default to `manual`; the engine can only navigate. |
| No automatic publish/deploy/delete | Same three-layer rule; no step performs an action. |
| Cancellation at every stage | Exit in the card, `Esc`, skip per step, and now Resume/End-here while paused (§9). |
| Cross-page navigation | `step.route` + verified arrival + safe project-id encoding. |
| Responsive | `layoutMode` + bottom-sheet phones + 30 geometry tests at six device sizes. |
| Preserve existing functionality and tests | 276 files / 3297 pre-existing tests still green; no pre-existing test edited; changes additive, with in-flight files of other sessions untouched. |
| No unnecessary dependencies | Zero new packages. |
| Small testable phases | Engine, catalogue, anchors, discovery, persistence, UI, verification, report — each with its own test. |


