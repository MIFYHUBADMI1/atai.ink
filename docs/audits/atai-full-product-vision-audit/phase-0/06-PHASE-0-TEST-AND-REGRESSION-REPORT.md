# 06 — Phase 0 test and regression report

**Scope:** the §10 verification gates for the five Phase 0 workstreams, run against the working
tree on 2026-11-12/13 (11-12 21:50 → 11-13 00:05 local).

**Tree state at verification:** `main` at `0856c14`, plus the main session's in-flight,
uncommitted ads/market-studio work, plus one uncommitted Phase 0 fix (see *Regressions found*).

**One regression was found during this verification and fixed.** Everything else that failed is
classified below as environmental or as belonging to the main session's concurrent work — not to
Phase 0.

---

## 1. Commands executed

| # | Command | Purpose | Result |
|---|---|---|---|
| 1 | `npx vitest run lib/runtime/router/adapters/dodo/payments.test.ts lib/credits/build-pricing.test.ts lib/cofounder/conversation.test.ts lib/cofounder/agent-history.test.ts lib/build-messages.test.ts lib/store/mongo-store.deletion.test.ts` | §10.1, §10.4, §10.6, §10.7 — the Phase 0 workstream suites | **94 passed / 94**, exit 0, 27.26s |
| 2 | `npx tsc --noEmit -p tsconfig.json` (before the fix) | §10.9 TypeScript | **exit 1** — `error TS2304: Cannot find name 'getTierCost'` |
| 3 | `npx tsc --noEmit -p tsconfig.json` (after the fix) | §10.9 TypeScript | **exit 0**, no diagnostics |
| 4 | `npx vitest run` | §10.2 regression sweep | exit 1 — **6 failed / 2709 passed / 2 todo (2717)**, 433.25s |
| 5 | `npx vitest run lib/marketing/` | isolating the full-suite failures | exit 1 — 3 failed files / 4 failed tests (classification) |
| 6 | `npx next build` | §10.10 production build | **exit 0** — compiled 5.3min, type check 6.2min, 190/190 static pages in 2.4min |

Reproduce with the repository's own scripts (`npm test` = `vitest run`, `npm run build` =
`next build`); no test command was invented.

## 2. Targeted Phase 0 suites (command 1)

| Suite | Workstream | Tests | Result |
|---|---|---|---|
| `lib/runtime/router/adapters/dodo/payments.test.ts` | W1 payment isolation | 32 | pass |
| `lib/credits/build-pricing.test.ts` | W3 pricing authority | 22 | pass |
| `lib/build-messages.test.ts` | W5 honest messaging | 19 | pass |
| `lib/cofounder/conversation.test.ts` | W4 co-founder memory | 8 | pass |
| `lib/cofounder/agent-history.test.ts` | W4 co-founder memory | 8 | pass |
| `lib/store/mongo-store.deletion.test.ts` | W2 deletion integrity | 5 | pass |
| **Total** | | **94** | **all pass** |

Counts match the per-workstream figures quoted in reports 01–05, so the reports and the code agree.

## 3. TypeScript (commands 2–3)

`npx tsc --noEmit -p tsconfig.json` failed with exactly one diagnostic before the fix and passes
cleanly after it:

```
lib/projects/project-actions.ts(131,31): error TS2304: Cannot find name 'getTierCost'.
TSC_EXIT=1
```

After the fix: no diagnostics, `TSC_EXIT=0`.

## 4. Full suite (command 4)

```
 Test Files  4 failed | 226 passed (230)
      Tests  6 failed | 2709 passed | 2 todo (2717)
   Duration  433.25s
REAL_VITEST_EXIT=1
```

**Every failure is outside Phase 0.** Full classification:

| Failing file | Tests | Cause | Owner |
|---|---|---|---|
| `lib/runtime/provisioning/e2e.test.ts` | 2 | `MONGODB_URI is not configured`; second test asserts 403 but the unconfigured runtime returns 503 | **Local environment** — see §7 |
| `components/marketing/ads-bench.test.tsx` | 1 | `expected '<section aria-labelledby="ads-bench-h…' to contain 'Draft 1 piece'` | Main session's in-flight ads-bench work |
| `lib/marketing/studio/ads-kit.test.ts` | 2 | `expected [ 'first-post', …(8) ] to deeply equal [ 'facebook-copy', …(4) ]`; `expected … to have a length of 5 but got 9` | Main session's in-flight ads-kit work (slot set changed) |
| `lib/marketing/studio/market-service.test.ts` | 1 | `No "brandProfilesCol" export is defined on the "@/lib/db/collections" mock` | Main session's in-flight market-service work (test mock missing an export) |

**Zero Phase 0 suites fail.** No Phase 0 file appears in the failure list.

An earlier full run in the same session (21:52) reported 5 failed files / 8 failed tests; the
difference is `lib/marketing/studio/ads-kit-content.test.ts`, which the main session fixed while
this verification was running. The failure count moved because the tree moved, not because a
Phase 0 test regressed.

## 5. Production build (command 6)

```
▲ Next.js 16.3.3 (Turbopack)
✓ Compiled successfully in 5.3min
  Running TypeScript ...
  Finished TypeScript in 6.2min ...
✓ Generating static pages using 3 workers (190/190) in 2.4min
BUILD_EXIT=0
```

The build now succeeds end to end, including static generation of all 190 pages.

Two build facts were verified rather than assumed:

- **`/pricing` does not need the database at build time.** It is emitted as `ƒ (Dynamic) —
  server-rendered on demand`, because the page already called `getCurrentUser()` before the W3
  change (`git show d36bf44~1:app/pricing/page.tsx` confirms it). The billing-authority read
  happens per request. This corrects the build-time-DB claim in the earlier drafts of reports 03
  and 07.
- **The build is not green by default in this repository.** The first two attempts in this
  session failed — see §6.

## 6. Regression found and resolved

**A Phase 0 change broke the production build, and the reports claimed it was verified.**

- **Introduced by:** `d36bf44` — "fix(pricing): charge initial builds from the same tier
  authority as the pipeline".
- **Defect:** the change made `lib/projects/project-actions.ts:131` call
  `getTierCost(tier, pipelineMode)`, but the file's existing import on line 6 was
  `import { classifyComplexity } from "@/lib/credits/credits"` — `getTierCost` was never added.
  The pricing logic itself was correct; only the import was missing.
- **Consequence:** `error TS2304: Cannot find name 'getTierCost'`. `next build` failed at the
  TypeCheck stage, so **the repository did not build** from that commit until it was fixed. A
  pre-existing log from the earlier pass shows the identical failure
  (`.tmp-p0-final-build.log`, 11-12 21:21, `BUILD_EXIT=1`).
- **Fix:** added `getTierCost` to the existing import on line 6. One line, no behaviour change:

  ```diff
  -import { classifyComplexity } from "@/lib/credits/credits"
  +import { classifyComplexity, getTierCost } from "@/lib/credits/credits"
  ```

- **Verified:** `tsc --noEmit` exit 0, and `next build` exit 0 with 190/190 pages generated.
- **State:** the fix is **uncommitted** in the shared worktree, alongside the main session's
  in-flight ads/market-studio work.

**Why this was missed the first time.** Report 00 stated that "TypeScript + production build"
was recorded in `06-PHASE-0-TEST-AND-REGRESSION-REPORT.md` — a file that did not exist. The
verification the reports referred to had never been performed against the committed state, so a
build-breaking change was reported as PASS. This report now contains the actual command output,
and report 00 no longer points at a missing file.

Two further documentation defects were corrected in the same pass, both found by reading the
claims against the code rather than trusting them:

- Report 05 cited the build overlay at `components/build/build-stage-overlay.tsx`; the real path is
  `components/workspace/build-stage-overlay.tsx`.
- Reports 03 and 07 described a build-time database dependency for `/pricing` that does not exist
  (§5 above).

## 7. Test infrastructure (§10.1)

The directive recorded a premise that "a significant local test collection may be gitignored".
**That premise does not hold in the current tree:**

| Question | Finding |
|---|---|
| Are the tests tracked? | **Yes** — `git ls-files` returns **229** test files (`*.test.ts` / `*.test.tsx`) |
| Why would they be ignored? | **They are not** — `.gitignore` contains no rule matching `test` or `spec` |
| Are they in the working environment? | Yes — all 229 run in the full suite (226 files passed + 4 failed) |
| Can CI execute them? | Yes — `.github/workflows/ci.yml` is tracked and runs `npx tsc --noEmit`, `npm test` and `npx next build` as three gates, with a `mongo:7` service and `MONGODB_URI` exported |
| Do the fixtures still work? | Yes, except the two provisioning e2e tests, which need the Mongo URI |
| Do they contain secrets or environment-specific dependencies? | Not observed. The only environment-specific dependency found is `MONGODB_URI` for the provisioning e2e suite |

**The two provisioning e2e failures are a local-runner gap, not a CI failure.** `vitest.config.ts`
loads no env file, so `MONGODB_URI` (present in `.env` / `.env.local`) is not visible to the test
process and the runtime returns 503 "not configured" where the test expects 403. CI exports
`MONGODB_URI` and runs a Mongo service, so these two tests are expected to pass there.

They were **not** run locally against the configured database: `MONGODB_URI` points at a shared
remote Atlas cluster (`vettcode.kycouyv.mongodb.net`), and executing the provisioning e2e suite
would write test projects and API keys into that shared database. That is shared external state
and was left untouched. **This is the one §10 gate that remains unverified locally.**

## 8. Regression protection against §10.2

Each listed workflow, and the suite that covers it, all green in the full run unless marked.

| Workflow | Coverage | Result |
|---|---|---|
| User authentication | `lib/auth/__tests__/session.test.ts`, `session-revocation.test.ts`, `routes-security.test.ts`, rate-limit suites, `app/api/auth/*` | pass |
| Project creation / selection | `lib/projects/project-id.test.ts`, `lib/projects/continue-start.test.ts` | pass |
| Business building | `lib/analysis/pipeline-credit-resume.test.ts`, `pipeline.launch-reconcile.test.ts`, `lib/analysis/runtime-capabilities.test.ts` | pass |
| Manual build | `lib/credits/build-pricing.test.ts` (22) + `lib/analysis/pipeline-credit-resume.test.ts` | pass |
| Automated build | `lib/analysis/pipeline*.test.ts` | pass |
| Runtime API authentication | `lib/runtime/auth/auth.test.ts`, `authorize.test.ts`, `app/api/runtime/v1/route.test.ts` | pass |
| Runtime usage metering | `lib/runtime/metering/*` | pass |
| Credit reservations | `lib/billing/credit-service.*`, `lib/runtime/metering/resolver.test.ts` | pass |
| Credit refunds | `app/api/billing/webhook-refunds.test.ts`, `app/api/projects/[id]/fork-refund.test.ts`, `status-refund-regression.test.ts` | pass |
| Credit ledger integrity | `lib/store/mongo-store.credits.test.ts`, `lib/billing/credit-valuation.test.ts`, `lib/billing/operation-identity.test.ts` | pass |
| Dodo subscription checkout | `app/api/billing/webhook/route.test.ts`, `webhook-integrity.test.ts`, `lib/billing/checkout-return.test.ts` | pass |
| Payment webhooks | `app/api/billing/webhook/route.test.ts`, `lib/billing/webhook-recovery.test.ts` | pass |
| AI co-founder | `lib/cofounder/conversation.test.ts`, `agent-history.test.ts`, `lib/cofounder/tools/*.test.ts` | pass |
| Conversation persistence | `lib/cofounder/conversation.test.ts` | pass |
| Totalum integration | `lib/integrations/totalum/errors.test.ts` | pass (coverage is limited to error mapping — no provider contract test exists) |
| Existing hosting workflows | `app/api/projects/[id]/deploy-claim.test.ts`, `launch/route.test.ts`, `lib/workspace/build-handoff.test.ts` | pass |
| Project deletion | `lib/store/mongo-store.deletion.test.ts` (5) | pass |

## 9. Remaining issues

1. **The one-line build fix is uncommitted.** Until it is committed, `main` does not build. This
   is the single highest-priority follow-up.
2. **The provisioning e2e suite is unverified locally** (shared Atlas DB — deliberately not run).
   CI is expected to cover it.
3. **Totalum integration coverage is thin** — error mapping only. There is no test that exercises
   the provider's actual contract, so W2's "external teardown is impossible today" claim rests on
   reading the integration source, not on a test.
4. **Full-suite failures remain in the main session's ads/market-studio work** (3 files, 4 tests).
   They are not Phase 0's to fix from here, but they do mean the tree is currently red.
5. **W5's broader §8.2 copy sweep is still open**, so the honest product-messaging workstream
   status is PARTIAL, not PASS (report 00).

No failure was hidden, and no status was raised on the strength of code that was written but not run.
