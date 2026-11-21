<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes

- Two separate journeys, never merged: **GitHub import** (`/new/github` → `lib/projects/create-project.ts`) brings a repository in to build; **connected business** (`/new/existing` → `lib/existing-business/*`) reads a live website and connects an app that keeps running outside Atai. The existing-business path never reads a repository.
- The business profile (`/project/[id]/business`) is a three-step stepper — `lib/existing-business/steps.ts` decides order and completion (assessment → domain proof → connection), `components/existing-business/business-profile.tsx` renders only the active step. Keep it one step at a time: a wall of every section at once is what made the page unreadable.
- Connection truth lives in `lib/connected-business/` (`businessConnectionStatus` needs both a verified domain and a first authenticated call). Access helpers: `userHasBuiltBusiness` (Atai-built app) vs `userHasRealBusiness` (built **or** connected) in `lib/dashboard/business-access.ts`; nav items declare `requires: "built" | "business"`.
- Verify with `npx tsc --noEmit`, `npx vitest run` and `npm run lint` (flat config `eslint.config.mjs`: typescript-eslint recommended + the two classic react-hooks rules + Next's recommended rules; the React Compiler rules in react-hooks v7 are deliberately not enabled). Lint must report zero errors; the remaining warnings are pre-existing `no-explicit-any`/`no-unused-vars` debt.
