# Part 00 — Application Discovery (what is actually here)

Measured 2026-11-06 by the lead auditor. Commands and counts are reproducible from a clean checkout.

## Size and shape

| Measure | Value | How obtained |
| --- | --- | --- |
| Page routes | 110 | `find app -name page.tsx \| wc -l` |
| API route handlers | 156 | `find app -name route.ts \| wc -l` |
| Source LOC (app, lib, components, runtime, packages) | 26,873 | `find … -name "*.ts*" \| xargs wc -l` |
| Test files present on disk | 198 | `find lib components app runtime packages -name "*.test.ts*"` |
| Test files tracked in git | **0** | `git ls-files "*.test.ts" "*.test.tsx" \| wc -l` |
| MongoDB collections named in `lib/db/collections.ts` | 36 (+ runtime set in `lib/db/runtime-collections.ts`) | grep of quoted names |
| Env vars documented | ~50 keys across 175 lines | `.env.example` |
| CI configuration | none | no `.github/` directory at HEAD |

Framework: Next.js **16.3.3** with React 19, `--webpack` dev mode, `next.config.mjs` only (no `vercel.json`). pnpm workspace (`pnpm-workspace.yaml`) with `packages/atai-sdk`. A top-level `runtime/` directory holds the runtime-control plane.

## Subsystems (from `lib/`, one line each on what the code shows)

- `analysis/` — the plan engine: `pipeline.ts` (analysis → plan → auto-launch build), `prompt-builder.ts` (the natural-language brief sent to Totalum), `consistency.ts` (contradiction checks), `plan-update-stream.ts`, `cofounder.ts`.
- `planning/schemas/` — the plan document model (`core-types.ts`), section definitions.
- `cofounder/`, `collab-chat/` — the in-workspace assistant: `tool-registry.ts`, `tools/*` (applications, studio, growth), `context.ts`.
- `billing/` — `config.ts` (plans, build tiers, packs, `WELCOME_BONUS_CREDITS`), `runtime-config.ts` (admin-editable pricing incl. `getDeploymentCosts`), `credit-service.ts` (balance), `build-auth.ts`, `packages.ts` (deprecated shim).
- `credits/` — cost estimation for initial build / followup edits / tiers.
- `integrations/totalum/` — the external build+deploy engine (`client.ts` → `https://api-accounts.totalum.app`, `service.ts`: `launchProject`, `isTotalumConfigured`, `getCreditCosts`).
- `runtime/` — the product API the *generated* apps call: `router/adapters/*` (provider routing, has its own `ssrf.test.ts`), `keys/`, `control/` (owner-facing runtime console), `provisioning/`.
- `workspace/` — what the founder sees during and after a build: `progress-view-model.ts`, `operating-room.tsx`, `build-handoff.ts`, `team-roles.ts`.
- `projects/` — `project-actions.ts` is the real state machine driver (build / edit / deploy, each with its own credit reservation and 402 gate).
- `marketing/` — studio (draft copy, never publishes), seo, growth, `feature-flags.ts` (every flag is read somewhere).
- `finances/` — server-computed series feeding recharts panels.
- `auth/` — `session/`, `google.ts`, `rate-limit`, `client-intent`.
- `infrastructure/`, `intelligence/`, `screenshots/`, `media/`, `imagekit/`, `email/`, `logging/`, `cache/`, `analytics/`, `referrals/`, `resources/`, `feature-requests/`, `onboarding/`, `navigation/`, `store/`, `types/`.

## Request-layer facts worth carrying into the report

- `proxy.ts` (Next 16's renamed middleware) short-circuits API calls that carry **no** `Atai_session` cookie. The file itself documents that this is presence-only, not validity, and must not be relied on for auth.
- `instrumentation.ts` + `instrumentation.node.ts` are the only startup hook; `onRequestError` currently only filters benign disconnects — no error reporting sink is wired.
- Guard usage across the 156 handlers: 100 reference `requireUser`/`getCurrentUser`, 35 reference `requireAdmin`. A further ~22 use purpose-built guards (verified examples: `requireOwnedProject` in `app/api/projects/[id]/runtime/control/route.ts:2`, `requireStudioProject` in `app/api/projects/[id]/studio/brand/route.ts:4`, `authorizeInternalRequest` + `checkInternalLimit` in `app/api/internal/credits/route.ts:13-14`).
- Routes with no session dependency that are legitimately so: the auth flows, `app/api/health`, `app/api/public/*`. Two checked by hand:
  - `app/api/billing/top-up/[id]/verify/route.ts` is a **410 stub** — explicitly deprecated, cannot award credits. Verified, not a vulnerability.
  - `app/api/credit-costs/route.ts` exposes cost estimates with no session check; whether that is a disclosure problem is left to SEC review.

## Public-facing surface map

Marketing/SEO: `/`, `/pricing`, `/about`, `/founder`, `/docs`, `/sdk`, `/developers`, `/modes-comparison`, `/start`, `/new`, public `/explore`, `/public`. Account: `/dashboard`, `/projects`, `/project/[id]` (+ `collaborate`, `build`, `market`, `market/seo`, `studio`, `tasks`, `ads`, `lessons`, `competition`, `campaigns`, `hosting`), `/finances`, `/notifications`, `/settings/*`, `/billing`, `/workspace`, `/account`, `/referrals`, `/resources`, `/feature-requests`. Admin: `/admin`, `/admin/*`, `/api/admin/*` (billing 6, runtime 5, infrastructure 3, users 2, planning-runs 2, feature-requests 2). Legal: `/privacy`, `/terms`, `/refund-policy`, `/database-terms`.

Placeholder surface: 14 page files import `ComingSoonPage` or `ProjectComingSoon` — `/ads`, `/competition`, `/hosting`, `/lessons`, `/market` globally, and `ads`, `campaigns`, `competition`, `lessons`, `market`, `market/seo`, `studio`, `tasks` project-scoped (some of these are conditional, not unconditional stubs).
