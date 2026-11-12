# REGRESSION & CI STRATEGY

**Assignment:** ATAI — Audit Findings Validation & Gap-Closure Planning (Task 6 + deliverable 7)
**Date:** 2026-11-09
**Scope:** why the test suite is gitignored; whether it is valid and safe to restore; what is missing for a clean checkout; what CI must execute; which critical journeys lack tests. No ignore rules were changed and no files were committed during this investigation.

---

## 1. What was found

### 1.1 The suite exists, is current, and is green — but is not shipped

| Fact | Evidence |
|---|---|
| 210 test files on disk (209 under `lib|app|components|packages` + one stray `./proxy.test.ts` at repo root) | scoped `find` during validation |
| 2,499 tests, **all passing**, 409 s on the current tree (including the 79-file WIP) | full `vitest run`, executed 2026-11-09 |
| 0 tracked test files in git | `git ls-files` matched with `\.test\.(ts|tsx|js|jsx|mjs)$` and `\.spec\.` patterns → zero |
| Ignore rules | `.gitignore:26-31`: `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`, `**/__tests__/**`, `packages/atai-sdk/tests/**` |

The audit's "~207 test files" estimate is corrected to **210**; "~2,400 passing cases" is confirmed precisely as **2,499**.

### 1.2 Why they are ignored (inference, clearly labelled)

The rules sit as a block with no commentary. The most plausible explanation, consistent with repo history: tests were excluded during the period the folder lost its `.git` and history was re-attached (2026-11-06, per project record) — a bulk-import decision, not a per-file quality judgement. Supporting observations: the suite is disciplined (mocked providers, fake fixtures, no network), the test *configuration* is tracked while the tests themselves are not, and several test files assert correctness of the money path (billing, credits, runtime metering) — code whose owner demonstrably cares about regression safety. **This is INFERRED; only the founder can confirm intent.** Nothing in the suite looks like it was ignored *because* it fails — the whole suite passes today.

### 1.3 Validity: the suite is real and runnable

- **Vitest config is tracked** (`vitest.config.ts`): node environment, globals, `@` alias → repo root, and a shim plugin for `server-only`/`client-only` imports. A clean checkout gets a working test runner the moment test files are added.
- **All test dependencies are declared**: `vitest ^5.0.0`, `fast-check ^4.10.2`, plus every imported utility (e.g. `zod`, `jose`) is in `package.json`. No test imports a package that isn't installed. **Clean checkout is runnable once the files are tracked.**
- **Fixtures/utilities**: there is no `fixtures/` or `test-utils/` directory — mocks are inline per test file (e.g. runtime auth tests stub the store; SEO tests stub the crawler with `"crawl boom"`). Nothing external is missing; the suite is self-contained.

### 1.4 Secrets, environment files, generated artifacts

| Item | Tracking status | Contents examined? |
|---|---|---|
| `.env`, `.env.local` (and `.env*.local` variants) | **Untracked** — covered by `.gitignore:10-11` | **No.** Per assignment, tracking status was established from `.gitignore` + `git status --porcelain` only; contents never read or printed |
| `.env.example` | Tracked | Placeholder keys only (safe) |
| Secret-shaped strings inside test files | Tracked-if-restored | **Yes, checked** — all are fake fixtures (`atai_production_consumerTestKey1`, `sk-or-v1-thisisnotarealopenrouterkeyvalue`, fake Dodo/test keys). No live credentials found in any of the 10 files examined |
| Test files reading `process.env` | 19 files | Mostly read env through mocks; no test requires a real provider secret to pass (the full green run on a machine that does have local env files cannot distinguish this — flagged for the restore PR: run once on a machine with no `.env` to prove hermeticity) |
| Stray tracked artifacts | `.baseline-test.log`, `.tmp-test-phase1.log`, `.tmp-test-verify.log`, `test-out.txt` | Tracked *in git* (they match no ignore rule). Cleanup candidates for the same PR — deletion requires founder approval, not done |

### 1.5 What CI executes today

**Nothing.** `.github/` (including any workflows) was deliberately deleted during the 2026-11-06 git re-attachment and does not exist on disk. There is no other CI configuration (no `.gitlab-ci.yml`, `circle.yml`, etc.). A clean clone ships with: no tests, no CI, ESLint broken (`eslint.config.mjs` v9 flat-config mismatch — `npm run lint` unusable).

---

## 2. Coverage map — what the suite protects and what it doesn't

Distribution of the 210 files by area (counts from scoped find):

| Area | Files | Read |
|---|---|---|
| Runtime gateway (auth/authorize/provisioning/router/adapters/metering) | 39 | strong — money-critical paths heavily covered |
| Marketing modules (competition, ads bench, growth, campaigns) | 21 | good on computation, none on delivery (nothing delivers) |
| Billing (credits, ledger, webhook-recovery, valuation) | 12 | strong |
| Analysis pipeline | 12 | strong |
| Planning | 10 | good |
| Finances computation | 9 | good |
| Auth (session, routes security) | 9 | good |
| `app/api` route tests | 25 | partial — see gaps |
| Cofounder (agent, tools) | 6 | partial |
| Workspace/projects/start | 13 | partial |
| UI components | 3 (dashboard 1, auth 1, marketing 1) | minimal |

### 2.1 Critical journeys with NO meaningful test coverage

1. **Founder-visible UI journeys** — the five P0 UX findings (UX-1 pricing contradiction, UX-2 verification enforcement, UX-3 mobile credit meter, plus the plan-review approve flow) have zero component tests. Nothing would catch a regression that hides the credit meter on mobile again.
2. **Dodo webhook happy-path end-to-end** — `webhook-recovery.ts` logic is tested, but no test exercises signature verification + grant + idempotent replay in one flow.
3. **Deletion transaction** — no test pins the current cascade scope, so the planned deletion fix (S-02/D-01) has no regression guard to extend.
4. **Cofounder multi-turn behaviour** — agent tests cover tool execution and credit refund; nothing asserts transcript handling (the D-02 fix will need one).
5. **Prerender/RSC boundaries** — only `npx next build` catches these (per project record); no test substitutes for it.

---

## 3. The CI strategy (proposed in Phase 1; not yet implemented)

**Target: three gates on every push, plus a nightly.**

| Gate | Command | Runner | Expected duration | Catches |
|---|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | Linux, Node 24 | ~2 min | type breakage across 200+ modules |
| Unit suite | `npm test` (vitest run) | Linux, Node 24 | ~7 min (local Windows 409 s; CI typically comparable) | regressions in ledger, metering, runtime auth, pipeline, marketing computation |
| Build | `npx next build` | Linux, Node 24 | ~16 min local Windows; budget 25 min CI | prerender failures, RSC-boundary violations, route-level breakage |

**Nightly (once a job substrate or scheduled workflow exists):** build + full suite against a throwaway MongoDB instance for any suite that later needs one (today's suite is fully mocked and needs no database).

**Guardrails carried into the restore PR:**
1. Un-ignore test paths in `.gitignore` (remove lines 26-31) **in the same commit** as adding the files — never one without the other.
2. Add `.baseline-test.log`, `.tmp-test-phase1.log`, `.tmp-test-verify.log`, `test-out.txt` to `.gitignore` **and** `git rm --cached` them (requires founder approval — they are tracked today).
3. Add test artifact patterns (`*.log`, `test-out.txt`) so local runs never re-track outputs.
4. Do **not** commit `.env`/`.env.local` under any circumstance; they remain ignored (`.gitignore:10-11` stays).
5. ESLint is **out of scope for Phase 1** — fixing the v9/legacy mismatch is a separate task; CI ships without lint rather than with a red lint.
6. First restore commit should re-run the suite on a machine without `.env` files (or with CI's clean environment) to prove no test depends on local secrets — closing the 1.4 caveat.
7. Branch protection: require the three gates green on `main`. No force-push.

**Success criteria for the CI workstream** (measurable, feeding IMPLEMENTATION-PROGRAMME Phase 1):
- `git ls-files | grep -cE "\.test\.(ts|tsx)$"` returns ≥ 210 on a clean clone.
- A fresh `git clone` → `npm install` → `npm test` passes with no local env files and no manual steps.
- Every push to `main` runs all three gates; a deliberately broken commit to a scratch branch fails the pipeline within 30 minutes.
- Zero tracked stray log artifacts remain.
