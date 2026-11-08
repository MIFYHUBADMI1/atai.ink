# 05 — Verification & Launch Readiness (QA / Release Review)

Pre-MVP independent audit of Atai.ink. All work read-only; no source, test, or git state was modified.

## Scope & method

- Question A: do the 199 vitest files provide real protection? Classified them, traced the DB-mocking strategy, checked coverage of money/journey paths, checked whether any verification exists for the *generated application*.
- Question B: production readiness — deployment path, env/config completeness (`.env.example` vs code), observability, reliability (pool/timeouts/retries/rate limits/degradation), ops basics (backups, retention, deletion, support, status).
- Method: read-only git forensics, `grep`/file inspection across `app lib runtime packages components`, targeted reads of representative test files and production code (`lib/env.ts`, `lib/db/mongodb.ts`, `lib/billing/dodo-webhook.ts`, `lib/logging/logger.ts`, `instrumentation*.ts`, `next.config.mjs`, `vitest.config.ts`, `package.json`, `docs/DEVELOPMENT_SETUP.md`). Did NOT re-run the full suite or `next build` (operator already provided: 199 files / 2391 tests passing, 231s; pricing typecheck passes).
- Line references are from the working tree as of commit `0b81417`.

## Commands run and results

| Command | Result |
| --- | --- |
| `git ls-files '*.test.ts' '*.test.tsx'` | **0 tracked test files** |
| `find app lib runtime components packages -name '*.test.ts(x)'` | **198 test files on disk** (+1 root `proxy.test.ts` = the 199 vitest counts) |
| `git check-ignore -v app/api/admin/planning-runs/route.test.ts` | matched `.gitignore:26:**/*.test.ts` — tests are **git-ignored**, not merely untracked |
| `git log --all --diff-filter=A -- '*.test.ts'` | tests WERE committed historically (e.g. `5b4deed`, `1b599d3`, `c614608`) |
| `git show --stat 932293f` | commit `932293f` ("fix: keep test files out of the tracked tree and build typecheck", 2026-10-25) added the ignore rules AND deleted the tracked test files, after a Vercel build failed because `lib/auth/__tests__/session.test.ts` imported `fast-check` "not declared in package.json" |
| `grep process.env` across `app lib runtime instrumentation* proxy.ts packages` → diff vs `.env.example` | 136 distinct vars read by code vs 67 keys in example (see Launch readiness for the material mismatches) |
| `grep -l "connectDB\|mongoose.connect\|mongodb-memory-server" --include='*.test.ts'` | **0** — no test ever opens a real database |
| `grep -rn "maxDuration" app` | 0 routes set an explicit function duration |
| `grep snapshot assertions` in tests | 0 `toMatchSnapshot`/`toMatchInlineSnapshot` |
| `ls .github; grep netlify/docker/fly/render/wrangler` | no CI/CD config of any kind; no `vercel.json` |
| dependency scan `package.json` | no Sentry/Axon/Otel/Langfuse/datadog; `@vercel/analytics` present; **`fast-check` IS in devDependencies now** (contradicting the commit message that justified untracking tests) |

## Test assessment

### Classification (199 files)

| Class | Where | Count (files) | How the DB behaves |
| --- | --- | --- | --- |
| Unit-on-pure-function (pricing, schemas, parsers, validators, adapters' request mapping, SDK config) | mostly `lib/**`, `packages/atai-sdk/tests/**` | ~150 | No DB at all, or `vi.mock("@/lib/db/collections")` returning `vi.fn()` stubs |
| Handler-level (imports real `POST`/`GET` route/export, mocks auth + store + billing + provider SDKs) | `app/api/**` (24), plus route-ish `lib` tests | ~45 | Mocked `@/lib/store/store` / `@/lib/db/collections`; some use a hand-rolled "modeled ledger" (`structuredClone` + `Set` idempotency ledgers — e.g. `app/api/projects/[id]/status-refund-regression.test.ts:23-49`) |
| Real integration (real MongoDB / real provider / browser) | — | **0** | — |
| "In-process e2e" (real route + real SDK + real router pipeline, all I/O mocked) | `lib/runtime/provisioning/e2e.test.ts`, `app/api/runtime/v1/route.test.ts` | 2–3 | Mocked fetch + mocked collections |

Distribution by top-level dir: `app` 24, `lib` 162, `packages/atai-sdk` 8, `components` 4, root 1.

### Mocking strategy and divergence risk

`vitest.config.ts` is minimal: node environment, `server-only` shim plugin, no setup file, no coverage provider, no global fixtures. Every test writes its own `vi.mock` blocks per file; there is **no shared in-memory Mongo harness** (the `docs/audits/atai-stage1-security-report-2026-10-28.md:85` "in-memory harness" is these ad-hoc per-file mocks). Critically:

- `credit-service` uses **real Mongo transactions** (`startSession`/`withTransaction`, `lib/billing/credit-service.ts`) — tests stub `withTransaction` as a pass-through `await fn()` (`lib/billing/credit-service.reversal-race.test.ts:32-35,62-64`). Isolation, abort/rollback, write-conflict retry, and read-under-concurrency are **never executed**.
- Unique-index-based idempotency (webhook dedupe, key uniqueness) is mocked as plain `vi.fn()`; index enforcement is untested.
- Query-shape correctness (`$inc` guards, filter fields against real documents) is only asserted against mock call args — a wrong filter that matches zero rows in real Mongo passes tests while failing in prod.

The memory "integration tests must hit a real database" was **not found** as a rule in `CLAUDE.md`/`AGENTS.md`/docs (grep for "integration tests must" = no matches); the docs instead repeatedly flag the absence ("API endpoints (no integration tests)", `docs/CURRENT_STATUS.md:316`, `docs/NEXT_STEPS.md:264`). The rule does **not** hold: not one test touches a real database. Divergence risk: HIGH for concurrency/transactional money paths, MEDIUM for query semantics, LOW for pure logic.

### The untracked-tests consequence (P0)

All 198 test files are excluded by `.gitignore:26-31` (`**/*.test.ts`, `**/*.test.tsx`, `**/__tests__/**`, `packages/atai-sdk/tests/**`), removed from the tracked tree by commit `932293f`, and excluded from typecheck (`tsconfig.json` exclude mirrors those patterns). Consequences for launch:

1. A clone of the repo contains **zero tests**; `npm test` on any fresh checkout fails with "no test files". The 2391 green tests exist only on this one machine.
2. CI is impossible by construction (no `.github`, and even with one, nothing is checked out to run). No other engineer — human or agent — can be regression-guarded.
3. Test code is also outside typecheck, so the suite can silently rot (type drift against changed APIs) with no signal until someone runs vitest locally.
4. The original trigger is already obsolete: `fast-check` is now in `devDependencies`, so the stated reason for untracking no longer applies. The correct fix (declare the dep) was made, but the workaround (untracking ~19k lines of safety net) was kept.

### Quality spot-check

Assertion quality is generally *high* where tests exist — they are behavior tests, not call-count theater: `status-refund-regression.test.ts` asserts refund-before-state-finalize **ordering** via `invocationCallOrder` (line 55), 503-retain/retry-recover semantics (64-79), idempotent refund identity (81-92), and cross-user 404 (94-99). `webhook/route.test.ts` asserts the oversized-body rejection happens *before* `verifyWebhookSignature` is called. Zero snapshot-only tests. One heuristic outlier (`pipeline-credit-resume.test.ts`, 56/61 assertions are `toHaveBeenCalled*`) still pairs call args with value checks. Main weakness is **coverage shape** (all mocked, no DB), not assertion triviality.

### Coverage of the money path and journey path

| Behavior | Protected? | Evidence |
| --- | --- | --- |
| Reserve → refund on build failure (incl. retry-after-failed-refund, idempotency) | YES (mocked ledger) | `status-refund-regression.test.ts`, `fork-refund.test.ts`, `retry/route.test.ts`, `credit-service.reversal-race.test.ts` |
| Reserve → **charge/commit** under success + failure | PARTIAL | `consume-plan.test.ts`, `credit-valuation.test.ts`, `operation-identity.test.ts` — unit-level; the atomic consume inside a real transaction is never exercised |
| Webhook signature rejection | YES, two layers | `dodo-webhook.ts` is fail-closed when the secret is unset (`:52-54`); `webhook-integrity.test.ts`, `webhook-refunds.test.ts`, `webhook-recovery.test.ts` |
| Project state machine transitions | PARTIAL | Transitions asserted ad hoc inside handler tests (`building`→`build_failed` etc.); `deploy-claim.test.ts`, `continue-start.test.ts`, `credit-block.test.ts`; **no dedicated legal/illegal-transition matrix** |
| Credit metering on every provider call | YES (mocked) | `metering.test.ts` (54 cases: pricing rules, idempotency, fail-closed billing, pre-charge+refund) |
| Launch handoff (plan→build→deploy→claim) | YES (mocked) | `launch/route.test.ts`, `deploy-claim.test.ts`, `build-recovery.test.ts`, `pipeline-credit-resume.test.ts` |

## Critical paths with no automated protection

1. **Real MongoDB semantics for the money path** — transactions, `$inc`-guarded debits, unique idempotency keys, webhook dedupe indexes. All stubbed; nothing verifies these behave correctly against a real server. (QA-03)
2. **The generated application** — no e2e, no Playwright/Cypress/puppeteer anywhere (`package.json`, repo root), no post-deploy smoke check of the Totalum-served app, no build-output quality gate. The product's actual deliverable is verified by zero automated tests. The `e2e.test.ts` in provisioning is an in-process mock chain, not the live product. (QA-04)
3. **State-machine legality** — no test enumerates forbidden transitions (e.g. `plan_ready`→`deployed` directly), so a route writing an illegal state passes CI-less. (QA-05)
4. **Cross-process concurrency on credits** — refund races are tested only against a single-threaded modeled ledger; a true parallel consume vs reverse against real Mongo is untested. (QA-03)
5. **Payment provider contract** — Dodo SDK calls (`dodopayments` package) are fully mocked; a Dodo API/enum change ships undetected until real money breaks. Same for Totalum/OpenRouter response-shape drift (mapping tests mock the responses). (QA-06)
6. **Typecheck of tests** — excluded by `tsconfig.json`; drift against refactored source is invisible until the (untracked, local-only) suite is run. (QA-02)

## Launch readiness

### B1 — Deployment path

- Vercel, push-to-`main` auto-deploy (`docs/DEVELOPMENT_SETUP.md:274-288`); `lib/env.ts:131` pins `https://atai.ink`; commit `932293f`'s message documents a Vercel build; no `vercel.json` (defaults), `next.config.mjs` is 8 lines (`images.unoptimized`), `dev` uses webpack.
- Concretely, "no CI/CD" for a billing product means: the only gate between a commit and production is Vercel's `tsc`/build and the human habit "always run `npm run build` locally first" (doc line 288). Tests are not in the pushed tree, so **even a green local suite cannot protect production** — the reverse also holds: the 2391 passing tests are invisible to the deploy pipeline. Every push to `main` is a production release with no automated regression step, no staging gate, and (given `.gitignore` rules) no way to add one without first un-ignoring the tests. Rollback = manual re-push.

### B2 — Configuration completeness

Code reads 136 distinct `process.env.*` names; `.env.example` documents 67. Most of the gap is benign (Node/CI/Vercel internals: `NODE_ENV`, `VERCEL_URL`, `GITHUB_*`, `ROLLUP_WATCH`, `NAPI_RS_*`, `NEXT_RUNTIME` are environment-provided; many model names like `PLANNER_MODEL`/`CRITIC_MODEL` have in-code defaults). Material mismatches:

| Issue | Detail | Severity |
| --- | --- | --- |
| **Name mismatch: `RESEND_FROM_ADDRESS` (example) vs `RESEND_FROM_EMAIL` (code)** | `lib/runtime/router/adapters/resend/config.ts:42` and `mapper.ts:65` read `RESEND_FROM_EMAIL`; copying `.env.example` verbatim leaves runtime email capability broken-but-claimed (availability list `lib/runtime/router/adapters/availability.ts:57` requires both) | OPS-02, P1 |
| **Dodo permanent-credit product IDs disagree** | Example defines `DODO_PRODUCT_PERM_50K/100K/300K/600K`; code reads `DODO_PRODUCT_PERM_200K/500K/15M` (`lib/billing/config.ts:274-278`) plus `PERM_1M/PERM_5M` (also in example). Following the example silently leaves checkout products with `dodoProductId: undefined` — purchases for those tiers fail or vanish | OPS-03, P1 |
| `TOTALUM_VCAAS_API_KEY` | read as a fallback alias (`lib/integrations/totalum/client.ts:14`) but not in the example — acceptable if `TOTALUM_API_KEY` is set; document the precedence | low |
| Feature flags absent from example | `CAMPAIGNS_ENABLED`, `STUDIO_ENABLED`, `SEO_AUDIT_ENABLED`, `MARKET_STUDIO_ENABLED`, `GROWTH_*`, rollout-percent knobs — default to off; a feature can be "invisible in prod" with no error | P2 |
| Model overrides absent from example | ~15 `*_MODEL`/`*_FALLBACK_MODEL`/`PLANNING_STRATEGY` vars use hardcoded defaults; can't tune/cost-control from config alone | P2 |

**Fail-loud audit (good news):** protections do NOT silently disable. `AUTH_SECRET` throws 503 via `required()` (`lib/env.ts:99`); webhook verification fails closed when `DODO_PAYMENTS_WEBHOOK_KEY` is unset (`lib/billing/dodo-webhook.ts:52-54` — note `getDodoConfig` tolerates the empty key at config level, `lib/env.ts:216`, but the verifier itself rejects every event); `DODO_PAYMENTS_ENVIRONMENT` throws in production when unset (`lib/env.ts:221-226`); OAuth/SMTP/ImageKit throw 503 with typed errors; `getAppUrl` rejects non-https in production (`lib/env.ts:109`). No `*_DISABLE` bypass flags exist in code. Residual risk: the empty-string default in `DodoConfig.webhookKey` invites a future caller to trust the config object instead of the verifier.

### B3 — Observability

- **No error tracking.** Confirmed: no Sentry/Datadog/Rollbar/OpenTelemetry in deps. `@vercel/analytics` is route-traffic only.
- `instrumentation.ts`/`instrumentation.node.ts` do one thing: swallow "benign disconnect" errors. Worse, because a `process.on("uncaughtException")`/`unhandledRejection` handler is registered and the non-benign branch is **an empty fall-through** (`instrumentation.node.ts:3-9`), real crashes are silently absorbed with no log line and no restart — the process limps on in an unknown state. `onRequestError` likewise never logs (`instrumentation.ts:9-11`). OPS-04, P1.
- Logging is decent-but-local: `lib/logging/logger.ts` emits structured JSON to stdout with secret redaction (field- and value-shaped). Vercel retains it, but there is **no trace/request-id propagation across the plan→build→poll→charge chain in logs** beyond per-adapter `requestId`, no metrics, no dashboards, no alerting.
- Answer to "could anyone detect builds failing / credits leaking?": **No.** Build failures surface only via a founder's complaint (no webhook/health probe on Totalum outcomes); credit leakage (e.g. reservations never released after a crash between steps) has `lib/finances/reconciliation.ts` + a manual `npm run cleanup:credit-transactions` script, but nothing scheduled and nothing that alarms. A silent Mongo outage or stuck-pool state produces warns in logs nobody watches.

### B4 — Reliability

- **Mongo pool:** properly hardened — bounded `maxPoolSize`/`waitQueueTimeoutMS` via env with clamps, `serverSelectionTimeoutMS`, `connectTimeoutMS`, `socketTimeoutMS`, `maxIdleTimeMS`, client error listener, and a documented fix for the historical leaked-client bug (`lib/db/mongodb.ts:10,36-68`). Singleton cached promise on `globalThis`.
- **External fetch timeouts:** good coverage. `AbortSignal`/timeout present in `firecrawl/client.ts`, `totalum/client.ts`, `openrouter/client.ts`, `adapters/shared/http.ts` (with typed `provider_timeout` classification, `:120-145`). Missing only in `lib/integrations/github/client.ts`, `github/push.ts` (non-money) and `lib/auth/client-intent.ts`. OPS-05, P2.
- **Retry policy:** essentially none end-to-end. Adapters classify network faults as "safe to retry" (`shared/http.ts:140`) but there is no retry/backoff loop in the Totalum or OpenRouter clients for transient 429/5xx; resilience is manual user-facing "retry" affordances + `build-recovery`/`pipeline-recovery`. For metered provider calls this converts transient blips into founder-visible failures (and possibly double-spend on user-initiated retry, though idempotency keys mitigate).
- **Serverless duration:** no `maxDuration` anywhere; the long-running build lives in Totalum and the platform only *polls* it (`/api/projects/[id]/status`), so default limits are probably fine — but the polling loop's progress state (`touchBuildPoll`) dies if Vercel cuts a long request; nobody verified polling latency budget against the platform default. Unverified.
- **Rate limiting across cold starts:** survives — Mongo-backed `rateLimits` collection with TTL index (`lib/db/collections.ts:327`, TTL also on sessions/tokens, `:322-325`), with the in-memory `rejectedUntil` Map as a fast-path only (`lib/auth/rate-limit.ts:4`). Good.
- **Graceful degradation:** `isTotalumConfigured`/`isDodoConfigured`/`isGoogleOAuthConfigured` gating plus a capability-availability matrix (`lib/runtime/router/adapters/availability.ts`) and a tested circuit breaker (`lib/planning/utils/circuit-breaker.test.ts`). Missing-provider paths return typed 503s rather than crashing. This is a strength.

### B5 — Ops basics

- **Backups:** `backups/` contains a single dated `credit_transactions_backup_2026-09-06T20-19-03.json` — a one-off dev snapshot, not a backup system. Atlas defaults aside, there is no documented export/restore procedure in repo. OPS-06, P1.
- **Data retention:** TTL indexes on sessions/tokens/rate-limits/leases only; no policy for user data, project data, or credit ledger. 
- **Account deletion:** no delete-account API or UI found (`app/account` has session revocation only; the sole "deleteAccount" grep hit is a comment in `lib/finances/reconciliation.ts`). For a paid SaaS with EU-ish GDPR exposure this is a gap. OPS-07, P1.
- **Support path:** `mailto:` exists in layout/terms/privacy pages; no ticketing, no monitored status page (`app/` has no status route). A paying customer's only signal when the platform burns is that things stop working.
- **Status/health:** `app/api/runtime/v1/health` route exists (with tests), but no external uptime probe.

## Confirmed findings

| ID | Severity | Blocker? | Finding | Ref | Fix |
| --- | --- | --- | --- | --- | --- |
| QA-01 | **P0** | YES | Entire test suite (198 files / 2391 tests) is git-ignored and untracked; a clone ships zero tests, CI is structurally impossible, and only one machine has a regression net. Original justification (undeclared `fast-check`) is already fixed — the dep is in `devDependencies`. | `.gitignore:26-31`; commit `932293f`; `package.json` devDeps | Remove ignore rules, re-`git add -f` all tests, restore `__tests__`/sdk tests to tracking, keep typecheck exclusion only if needed |
| QA-02 | **P0** | YES (same PR) | Tests also excluded from typecheck, so the suite drifts silently. | `tsconfig.json` exclude | After QA-01, add a separate `tsconfig.test.json` gate in CI |
| QA-03 | P1 | No | Money path runs on `vi.fn()` stubs; real Mongo transactions/idempotency indexes/concurrency are never executed; the "integration tests hit a real DB" rule does not exist in practice. | `lib/billing/credit-service.reversal-race.test.ts:32-35`; `lib/billing/credit-service.ts` (startSession) | Add a real-Mongo integration lane (mongodb-memory-server or staging Atlas db) for reserve/charge/refund + webhook dedupe |
| QA-04 | P1 | No | Zero automated verification of the generated application (the actual product): no Playwright/e2e/smoke, no post-deploy check, no build-output quality gate. | repo-wide grep; `lib/runtime/provisioning/e2e.test.ts` header (all I/O mocked) | Minimum: smoke probe of each launched app's URL + a nightly template-app build |
| QA-05 | P2 | No | No state-machine transition-legality matrix test; illegal writes (e.g. direct `plan_ready`→`deployed`) are unguarded. | `app/api/projects/[id]/**` handler tests | Encode transitions in one module + exhaustive test |
| QA-06 | P2 | No | Dodo/Totalum/OpenRouter contract drift undetected (all provider responses hand-mocked). | webhook + adapter tests | Record/replay real fixtures; contract tests against sandbox mode |
| OPS-01 | **P0** | YES | Deploy pipeline = push to main → Vercel; with tests untracked there is literally no automated pre-production verification for a product that charges money. | `docs/DEVELOPMENT_SETUP.md:274-288`; no `.github`, no `vercel.json` | Restore tests (QA-01), add GitHub Actions: typecheck + vitest + build before merge |
| OPS-02 | P1 | launch-adjacent | `.env.example` documents `RESEND_FROM_ADDRESS`; code reads `RESEND_FROM_EMAIL`. Copy-paste provisioning silently breaks platform email. | `.env.example:78`; `lib/runtime/router/adapters/resend/config.ts:42` | Rename example key; add a boot-time consistency check |
| OPS-03 | P1 | launch-adjacent | Example defines Dodo permanent products 50K/100K/300K/600K; code consumes 200K/500K/15M (+1M/5M). Purchasing those tiers with an example-copied env yields `dodoProductId: undefined`. | `.env.example:25-30`; `lib/billing/config.ts:274-278` | Align example to code; fail fast on missing product ID in production |
| OPS-04 | P1 | No | Registered `uncaughtException`/`unhandledRejection` handlers swallow non-benign errors **without logging**, defeating Node's default crash-and-report behavior; no error tracker anywhere. | `instrumentation.node.ts:3-9`; `instrumentation.ts:9-11` | Log the error (redacted) before returning; add Sentry or Vercel alerts |
| OPS-05 | P2 | No | GitHub-integration fetches have no timeout/AbortSignal. | `lib/integrations/github/client.ts`, `push.ts` | Wrap with `AbortSignal.timeout` like other adapters |
| OPS-06 | P1 | No | No backup/restore procedure; `backups/` is one manual 2026-09 credit-transaction dump. | `backups/` | Document + schedule Atlas PITR verification; periodic ledger export |
| OPS-07 | P1 | pre-EU | No account-deletion path (API or UI) for paying customers; retention policy only for ephemera (sessions/tokens TTL). | `app/account`, `app/api/auth/sessions`; `lib/db/collections.ts:322-327` | Implement delete/anonymize flow + retention doc |
| OPS-08 | P2 | No | No alerting or status page; reconciliation and `cleanup:credit-transactions` are manual; stuck builds/leaking credits detectable only by user complaints. | package.json scripts; `lib/finances/reconciliation.ts` | Scheduled reconciliation job + threshold alerts |
| OPS-09 | P2 | No | Feature flags (`*_ENABLED`, rollout percents) default off and are absent from `.env.example`; a purchased feature can be silently absent in prod. | comm-diff of 136 vs 67 env names | Document all flags with intended prod values |

Positive confirmations (not findings): webhook verification is fail-closed without a secret; `AUTH_SECRET`/payments env fail loudly with typed 503s; Mongo pool config is production-grade after a fixed leak; rate limits are Mongo-backed (cold-start-safe); the provider layer degrades gracefully via capability availability; refund idempotency and 503-retain semantics are genuinely well tested at handler level (mocked, but behaviorally asserted, no snapshot/call-only theater).

## Unverified

- Did not re-run the full suite or `next build` (per instructions); relied on operator-provided green results.
- Actual Vercel project settings (env var values, build command, function region/timeout, git integration branch) — not visible from repo; docs' "push main auto-deploys" taken at face value.
- Atlas tier's real PITR/backup capability, retention windows, and whether they're enabled — no config in repo.
- Live env drift: whether the *deployed* environment contains the correct `RESEND_FROM_EMAIL`/`DODO_PRODUCT_PERM_*` values (the mismatch is between code and the example template, prod may be hand-configured correctly).
- Polling-duration budget for `/api/projects/[id]/status` against Vercel default function timeout under slow Totalum responses.
- Whether `packages/atai-sdk` published dist matches source (tests import `../src`, the e2e header claims "real dist build").
- Secrets values / contents of `.env.local` — never read or printed.
- SMTP vs Resend dual email paths (nodemailer + resend adapter both present) and which is active in prod.
