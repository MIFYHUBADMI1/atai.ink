<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes

- Two separate journeys, never merged: **GitHub import** (`/new/github` → `lib/projects/create-project.ts`) brings a repository in to build; **connected business** (`/new/existing` → `lib/existing-business/*`) reads a live website and connects an app that keeps running outside Atai. The existing-business path never reads a repository.
- The business profile (`/project/[id]/business`) is a three-step stepper — `lib/existing-business/steps.ts` decides order and completion (assessment → domain proof → connection), `components/existing-business/business-profile.tsx` renders only the active step. Keep it one step at a time: a wall of every section at once is what made the page unreadable.
- Connected-business pages share one layout language, matching `/new/existing`: a mono eyebrow (`font-mono text-[11px] uppercase tracking-[0.18em]`), an `h1` at `text-2xl sm:text-3xl`, a `max-w-2xl` support line, then a `lg:grid-cols-[minmax(0,1fr)_300px]` split — the step card on the left, a sticky aside holding the progress rail, a per-step "why this matters", and "what Atai never does". Inside a step card, use numbered sub-steps and `border-t` sections; do not nest `Card` in `Card`.
- A finished step announces itself: `sonner` toast plus a dismissible success strip, and the view advances to the next step. Nothing is marked done on optimism — `businessSteps` reads the same view the server builds.
- Run control is two-phase: `startIntakeRun` awaits only the decision (access, eligibility, rate limit, single-writer claim) so `POST /api/projects/[id]/intake` can answer `started: true|false` or a refusal with a message; `runBusinessIntake` keeps the awaiting form for tests and cron. A fire-and-forget POST cannot tell the founder that a retry was refused, which is exactly how an inert "Try again" button happened.
- After a start the profile polls on its own (`watching`) until the assessment has a verdict — the view returned by a start is the pre-run one, so polling only while `overall` is pending leaves the page frozen on a failed stage.
- Assessment parsing is per-field and tolerant (`normalizeResponse` in `lib/existing-business/assessment.ts`): renamed keys, an omitted section or one weak finding must not fail the whole run. Only a payload with no findings and no priorities is rejected, and a rejected reply gets exactly one repair attempt inside the same charge and time budget. Parse failures are logged with `reason` and `model` — that log line is the answer to "why did the assessment fail?".
- Connection truth lives in `lib/connected-business/` (`businessConnectionStatus` needs both a verified domain and a first authenticated call). Access helpers: `userHasBuiltBusiness` (Atai-built app) vs `userHasRealBusiness` (built **or** connected) in `lib/dashboard/business-access.ts`; nav items declare `requires: "built" | "business"`.
- Verify with `npx tsc --noEmit`, `npx vitest run` and `npm run lint` (flat config `eslint.config.mjs`: typescript-eslint recommended + the two classic react-hooks rules + Next's recommended rules; the React Compiler rules in react-hooks v7 are deliberately not enabled). Lint must report zero errors; the remaining warnings are pre-existing `no-explicit-any`/`no-unused-vars` debt.
