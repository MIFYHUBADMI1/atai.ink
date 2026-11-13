# 07 — Phase 0 remaining risks

Nothing below is hidden inside a PASS. Each item is a real limitation, an external dependency, or a
decision left to the founder.

## Per-workstream limitations

### W1 — Payment tenant isolation
- **No cursor / incomplete history.** Dodo's feed is account-wide and filtered *after* paging, so
  attributed payments older than the first raw page are unreachable from a project key. This fails
  closed (no leak) and is disclosed honestly via `pageFull`, but it is not a complete history API.
  A real fix needs provider-side metadata filtering or an Atai-side payment projection built at
  webhook time. **Founder/product decision** if a complete project payment history is required.
- **Attribution depends on the checkout stamp.** Payments created before stamping existed stay
  invisible to project keys by design (fail closed), not leaked. No backfill was performed.
- **Retrieval-by-ID / refunds:** no such operations exist today; if added, they must re-verify the
  stamped attribution before returning a record.

### W2 — Project deletion integrity
- **External teardown impossible today.** Totalum exposes no app delete/deactivate/revoke operation.
  Deletion is **incomplete by design** and labelled as such (`externalResourcesRemoved: false` +
  warning, shown before confirmation and in the co-founder tool). **Manual founder action required:**
  shut down the hosted app, DNS/domain, and any subscriptions bought in their own names.
- **No stored deletion-failure state.** If the cascade transaction aborts, the reason is logged, not
  persisted on the project (§5.3F "record the failed step" satisfied by logs only). The project
  survives with keys intact — safe, but an operator must read logs to diagnose.
- If Totalum later exposes a delete call, flip `externalResourcesRemoved` only on provider
  confirmation, keep retries idempotent, never mark deleted before confirmation.

### W3 — Pricing consistency
- **Display-only fallback drift.** `lib/client/build-costs.ts` keeps `FALLBACK_*` tables for the
  loading/unavailable window; they can drift from an admin override while the cost fetch is pending.
  The server always re-checks the real cost at launch, so this is display-only, not a charge risk.
- **Naming trap.** `TIER_COSTS` in `credits.ts` (25k/50k/75k) is the heavy-mode *ratio baseline*, not
  the charging default; `BUILD_TIERS` (50k/75k/100k) is the default. Two similarly-named tables with
  different roles is how R-01 happened. Worth a rename follow-up.
- **Build-time DB dependency — resolved, not a risk.** An earlier draft claimed the pricing page
  now needs the database at build time. It does not: `/pricing` was already dynamic (it calls
  `getCurrentUser()`), so the billing read happens per request. Confirmed in the production build
  (`/pricing` → `ƒ (Dynamic)`, 190/190 static pages, exit code 0).

### W4 — Co-founder multi-turn memory
- **Character budget, not token-exact.** The 12,000-char ceiling is a conservative proxy for a token
  budget, not a tokenizer count. A future refinement could count tokens.
- **No long-term summarization.** Turns beyond the 12-message / 12k-char window are not replayed.
  §7.1 explicitly scopes this phase to conversational memory, not a business-memory system.

### W5 — Honest product messaging
- **Broader §8.2 sweep not done — this workstream is PARTIAL, not PASS.** This pass remediated the
  confirmed build-progress corpus and added guards. A surface-by-surface copy audit of dashboard,
  market/growth, competition, finances, hosting, resources/lessons, empty states, onboarding and
  pricing copy **remains outstanding**, and §12 makes "user-facing claims have been reviewed" and
  "empty states are truthful" acceptance criteria for W5. The main session has been landing
  honest-messaging work on several of those surfaces separately; that work was left untouched
  (additive scope) and a concurrent sweep would have collided with it.
- **Residual copy risk in the build corpus.** Two lines keep a rhetorical "real users" phrasing
  ("…seen what real users type", "…worth proving with real users once it is live"). Both now frame
  the work as something to prove *later*, not as something already measured, so they pass the
  honesty guards — but a full §8.2 read-through should re-judge them in context.

## Test-infrastructure / environmental items (not Phase 0 regressions)

- **Provisioning e2e (`lib/runtime/provisioning/e2e.test.ts`, 2 tests):** fails with
  "MONGODB_URI is not configured" / 503-vs-403 because the vitest process does not inject
  `MONGODB_URI` (it exists in `.env`/`.env.local`, which Next.js loads but the test runner does not —
  `vitest.config.ts` loads no env file). Environmental and pre-existing. To run these, the test
  process needs `MONGODB_URI` exported.
- **Ads bench / ads kit / market studio (3 files, 4 tests):** `components/marketing/ads-bench.test.tsx`,
  `lib/marketing/studio/ads-kit.test.ts` and `lib/marketing/studio/market-service.test.ts` fail
  against the main session's **in-flight, uncommitted** ads/market-studio work (a `BenchTab`
  signature change and a `brandProfilesCol` export missing from the test's `vi.mock`). These belong
  to that work, **not** Phase 0, and were left untouched to avoid conflicting with it.
- **Competition snapshot (`lib/marketing/competition-snapshot.test.ts`):** was failing for the same
  in-flight reason; the main session's fix landed and it now passes.
- **Referrals (`lib/referrals/referrals.test.ts`, 2 tests):** timed out / mis-counted under full-suite
  load, but **pass on isolated re-run** (14/14). Classified flaky-under-load, not a real regression.

## Operational / process risks

- **A production-build regression was introduced by W3 and has been fixed.** The manual-build
  pricing change (`d36bf44`) called `getTierCost` in `lib/projects/project-actions.ts` without
  importing it, so the file failed to type-check and `next build` failed. The missing import is
  added; the fix is **uncommitted** in the shared worktree. Evidence in report 06.
- **Phase 0 code is committed; one fix is not.** Committed: `d36bf44` (W3), `db2d8f3` (W4),
  `62affd0` (W1), `cf760df` (W5), `32e5c38` (reports). Uncommitted: the one-line import fix in
  `lib/projects/project-actions.ts`. The worktree also holds the main session's in-flight
  ads/market-studio work, so the founder should decide the commit grouping rather than have this
  side chat commit across it. Scratch `.tmp-*` logs and `public/the rise of atai.ink/` founder
  drafts should stay out of any commit.
- **OpenRouter credits (operational context, not Phase 0):** paid capabilities remain blocked until
  purchased credits exist on the account; `:free` model pins work regardless. This affects live
  co-founder/build runs but not the correctness of the Phase 0 changes or their tests.

## Manual actions still required

1. Founder: shut down external hosted app/domain/subscriptions after a project deletion (W2).
2. Founder: decide whether a complete project payment history (cursor/projection) is needed (W1).
3. Founder: decide commit grouping for the one-line build fix (the rest of Phase 0 is committed).
4. Founder: schedule the §8.2 user-facing copy sweep (W5) once the main session's surface work lands.
5. Optional follow-ups: rename the `TIER_COSTS`/`BUILD_TIERS` trap (W3); token-exact history budget
   (W4); export `MONGODB_URI` for the provisioning e2e suite.