# Public billing config — implementation report

**Date:** 2026-11-22
**Scope:** Customer-facing pricing, credit, and reward copy.

## Problem

Marketing and help pages repeated billing values as literals. When an admin
changed a runtime price or reward, the page could disagree with the amount the
pipeline actually charged. Some values were also stale (for example, a
`500`-credit welcome grant in the auth path while the admin setting had moved).

## Change

A single public, non-secret read of the billing authority now feeds every
customer-facing surface:

- `lib/billing/public-config-types.ts` — public interfaces for rewards, build
  tiers, mirror-pipeline costs, and deployment costs.
- `lib/billing/public-config.ts` — server-only composition of
  `getRewardSettings`, `getBuildTierCosts`, `getMirrorPipelineCosts`, and
  `getDeploymentCosts`.
- `app/api/billing/public-config/route.ts` — public JSON endpoint with a short
  cache, used by client components through SWR.

Server-rendered pages read `getPublicBillingConfig()` directly. Pages that use
it are rendered dynamically so an admin change is not frozen into a static
build.

## Surfaces updated

- Pricing page, plan cards, and plan grid (launch costs, publishing cost,
  welcome credits, reward copy).
- Landing page, docs, developers, register, terms, refund policy, referral
  program, and the referral dashboard.
- Settings billing, credit meter, verify-email banner, publish menu, crawl-mode
  dialog, and public project actions.
- Welcome credits in `lib/auth/users.ts` now come from
  `getRewardSettings().welcomeBonus` instead of a local `500`.
- Referral fallback constants in `lib/referrals/referrals.ts` were removed; the
  runtime settings are the only source.
- Admin referral totals and the admin referral page read the configured reward
  values rather than `500` / `1,500`.
- Removed hardcoded plan-credit strings from commercial feature copy. The plan
  card already renders the catalog's `mirrorCredits`, so the feature list no
  longer carries a second, drift-prone number.

## Verification

- `npx tsc --noEmit` — passed.
- `npx vitest run` — 373 files passed, 4,339 tests passed.
- `npm run lint` — 0 errors; pre-existing warnings only.
- `npm run build` — passed. `/terms`, `/refund-policy`, `/docs`, and `/register`
  now build as dynamic routes.

## Acceptance notes

- Admin changes to build tiers, deployment cost, mirror-pipeline costs, or
  rewards flow to customer pages without a deploy.
- Client-rendered surfaces pick up changes on the next public-config fetch
  (cache window up to 60 seconds).
- Internal admin caps (for example, the feedback reward ceiling) remain
  hardcoded validation limits, not customer pricing.
