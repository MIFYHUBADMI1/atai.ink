# Part 07 — Production build verification (BLOCKER)

Command: `npx next build` on the working tree, 2026-11-06. Runner banner: `Next.js 16.3.3 (Turbopack)`, environments `.env.local, .env`.

## Result: the build FAILS. Exit status of the build itself is 1 (masked in my log by piping through `tail`).

```
✓ Compiled successfully in 4.3min
✓ Finished TypeScript in 11.4min
  Collecting page data using 3 workers ...
[AI Model] Using: nvidia/nemotron-3-ultra-550b-a55b:free   (x5, during page-data collection)
  Generating static pages using 3 workers (0/176) ...
Error occurred prerendering page "/pricing".
Error: Functions cannot be passed directly to Client Components unless you explicitly
expose it by marking it with "use server". Or maybe you meant to call this function
rather than return it.
  {plan: ..., isLoggedIn: false, bestFor: ..., outcomes: ..., translateFeature: function K}
Export encountered an error on /pricing/page: /pricing, exiting the build.
⨯ Next.js build worker exited with code: 1
```

## Cause

`app/pricing/page.tsx:400` (and again at `:415` for the enterprise card) passes the module-scope
function `translateFeature` as a prop into `<PlanCard>`, which is a Client Component
(`components/billing/plan-card.tsx:1` is `"use client"`; the prop is declared at `:26` and used at `:44`).
Server Components may not serialize a bare function into a Client Component boundary — this is
the documented RSC restriction, not a configuration issue.

## Blast radius

`/pricing` cannot prerender, so the export step aborts and **no build artifact is produced at all**.
This is not a degraded page — it is "you cannot deploy today, from this tree, to any host."

## Scope of the defect (important, and reassuring)

Verified against git: `git show HEAD:app/pricing/page.tsx | grep translateFeature` → **no match**.
The committed code does not pass a function prop.

So: **HEAD builds. The defect exists only in the uncommitted pricing rewrite** (`app/pricing/page.tsx`
+879/-496, `components/billing/plan-card.tsx` +382/-…) that has been sitting in the working tree.
Nothing else in the build complained.

## Why every other check missed it

- `npx tsc -p tsconfig.tmp-pricing-check.json` → clean. TypeScript's `ReactNode`/prop typing permits a
  function-typed prop; the restriction is a serialization rule enforced at prerender time, not a type error.
- `npx vitest run` → 199 files / 2391 tests green. No test imports `app/pricing/page.tsx` and renders it
  across the server/client boundary; there is no build, prerender, or e2e test in the suite.
- `next dev` would also have shown this only when `/pricing` was actually requested, and only as a
  runtime error in the browser, not a compile failure.

This is the clearest possible evidence for QA-01 in part 05: the verification the project runs proves
the code *compiles and unit-behaves*, and proves nothing about whether it *ships*.

## Minimal professional fix (NOT applied — audit rule 1 forbids modifying code before the report)

Choose one, do not do both:

1. Move the translation table into the client component and pass a plain key/flag instead of a
   function — e.g. `<PlanCard translateLabels />`, with `PLAN_JARGON_TRANSLATIONS` living in
   `components/billing/plan-card.tsx` (or a shared non-component module both can import).
   Preferred: keeps a single serialization-safe source of truth.
2. Hoist the copy transform to the server, so `PlanCard` receives already-translated strings:
   `features={plan.features.map(translateFeature)}`. Cheaper, but then `plan.notIncluded` needs the
   same treatment or the struck-through list will keep the raw jargon.

Re-verify with `npx next build` — not with typecheck, and not with vitest.

## Secondary observation for the report

Five `[AI Model] Using: nvidia/nemotron-3-ultra-550b-a55b:free` lines are emitted during
**build-time page-data collection**, i.e. importing page modules reaches model configuration and logs.
Two consequences: the build depends on provider configuration being present, and a `:free` pin is the
value baked in at build. See the pin notes in part 03 and OPS findings in part 05.
