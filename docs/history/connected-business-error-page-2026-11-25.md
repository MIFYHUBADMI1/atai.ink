# Connected business: the page that replaced the whole app

Date: 2026-11-25

## Summary

`/business/[businessId]` could fall into Next's built-in global error page —
"This page couldn't load. Reload to try again, or go back." The repository had
**no `error.tsx` / `global-error.tsx` anywhere**, so any uncaught error, on the
server or in the browser, escaped to the root and replaced the entire app. A
failure that should have been one retryable panel became a dead page.

This change adds a boundary at every level of the tree and reports each caught
failure to a rate-limited anonymous route, so the next occurrence names itself.
It also removes the two *reproducible* crash paths found in the business
surface — a partial intake view replacing a good one, and an unguarded
`member.scope` in the People panel — and pins locale/timezone formatting (a
hydration mismatch on every date and credit count).

The exact production digest could not be recovered: there is no Vercel
credential or retained server log in this environment. Section "What the error
actually is" records what was tested and why the trigger is most plausibly a
transient server-side exception, not a client bug.

## Phase 0 — what was actually deployed

- `git rev-parse HEAD` → `624c75b` (grafted/shallow clone; a single commit).
- The previous sweep's commits (`855ec4f`, `552d7cf`, `302278c`) **do not
  exist** in this repository, and no `error.tsx` / `global-error.tsx` existed
  under `app/`. Nothing from that sweep was running.
- Next.js `16.4.6`, React `19.3.0`.

So every uncaught error rendered Next's built-in page. A reload "worked" only
when it landed on a route that did not throw.

## What the error actually is

### The mechanism (proven)

In Next 16 the copy "This page couldn't load…" is the default `global-error`
fallback. It appears when an error escapes the root layout — including an error
encoded into the RSC payload that the browser throws while hydrating, and a
failed RSC fetch during a client-side navigation (clicking a tab). With no
boundary in the tree, nothing catches it.

### What throws (reproduced with Next's own Flight build)

I ran values through
`next/dist/compiled/react-server-dom-turbopack/server.node.js`
(`renderToReadableStream`, `NODE_ENV=production`, `--conditions=react-server`):

| Prop value | Result |
| --- | --- |
| `new ObjectId()` | **No throw** — serialized via `toJSON()` to its 24-char hex string (`{"_id":"6b06d091…"}`) |
| `new Date()` | No throw — React's `$D` built-in |
| class instance (`class Foo`) | **Throws**: `Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported.` |
| `Object.create(null)` | **Throws** (same message) |
| a function | **Throws**: `Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server".` |

The throwing frames are
`renderModelDestructive (…/react-server-dom-turbopack-server.node.production.js:1872:13)`
and `:1944:11` for functions. In development, `ObjectId` also logs
`Only plain objects can be passed … Objects with toJSON methods are not supported`,
but it does **not** throw and does **not** fail the page in production.

### The audit of the business pages

Every value passed to a Client Component on the business surface was checked:

- `businessPageContext` → `business`; `businessSections` → applications, archived
  applications, members. All plain objects (their `_id`, when present, is an
  `ObjectId` that serializes to a string).
- `IntakeView` is built by `buildIntakeView`, which constructs a new plain object;
  `toDomainView` returns a plain object; `businessSteps` always returns three
  steps. No class instances, no functions.
- `GrowthOverviewView` and `ProjectFinancesView` have no `"use client"` directive,
  so they are Server Components and may receive a `WorkspaceBase` (functions)
  without serialization.
- `BusinessProfile` receives `businessBaseRef()` (data), not a `WorkspaceBase`.

So there is **no non-serialisable prop** on `/business/[businessId]` or its tabs
in `624c75b`. That rules out the serialization class of error for this route.

### Conclusion

The intermittent whole-app replacement is an **uncaught error**, and the only
uncaught errors this route can produce are (a) a transient server-side
exception during the page's data fetch (`businessPageContext`, `store.getProject`,
`listProjectDomains`, `requireBusinessAccess`) or (b) a client-side exception in
a component. Both were previously unbounded. The server path matches the
symptom best: clicking a tab triggers an RSC fetch, and a single failed database
call during that fetch becomes the global page.

The exact digest and server log line cannot be quoted here: no Vercel
credential and no retained log were available. The change makes the next
occurrence self-identifying (see "What to watch").

## What changed

### Error boundaries

| File | Catches |
| --- | --- |
| `app/global-error.tsx` | the root layout itself (own `<html>/<body>`, inline styles) |
| `app/error.tsx` | any route segment below the root layout |
| `app/business/error.tsx` | `app/business/[businessId]/layout.tsx` and `BusinessShell` |
| `app/business/[businessId]/error.tsx` | `page.tsx` and the client components under it |

A segment's `error.tsx` does not wrap its own layout, which is why both business
boundaries exist. Each renders `ErrorBoundaryView`: what failed, that saved work
is unaffected, **Try again**, a way back, and the digest as a "Reference" when
Next supplies one.

### Reporting

- `lib/client-error-payload.ts` — pure types, bounds and `normalizeClientErrorReport`.
- `lib/client-error-report.ts` — browser-only `buildClientErrorReport` / `reportClientError`
  (`keepalive`, never throws).
- `app/api/client-errors/route.ts` — anonymous, rate-limited per IP (30/min), logs
  one line with `reason` + `digest`, stores nothing personal (no IP, user agent,
  email or cookie; the IP is the rate-limit key and is discarded).
- `/api/client-errors` is in `PUBLIC_API_PREFIXES` so a root-layout failure can
  still report when there is no session.

### Partial views

- `lib/existing-business/intake-view.ts` — `completeIntakeView()` and
  `completeAssessmentResult()` fill a missing section, coerce an unknown status
  to the neutral one, and drop malformed rows.
- `BusinessProfile` routes the initial view, every poll response and every start
  response through `completeIntakeView`. A partial payload can no longer replace
  a good view and crash the next render (e.g. `DomainVerification` receiving
  `domains: undefined`).
- `AssessmentReport` normalises the stored assessment itself, so an older row
  missing `evidence` or a section renders instead of throwing.
- `businessPriorities` already normalised the horizon (a prior crash); it now
  also defaults the string fields.

### Client-side hardening

- `BusinessWorkspace` People panel: `member.scope` and `applicationIds` are
  guarded. A legacy or partial member row now reads "Whole business" instead of
  throwing `Cannot read properties of undefined (reading 'kind')`.

### Serialisation hygiene

- `lib/connected-business/client-docs.ts` — `withoutMongoId()` drops `_id` and
  returns a plain object. Applied once at the source (`businessPageContext`,
  `businessSections`). `ObjectId` serializes anyway, so this is **not** the fix
  for the crash; it removes a dev-only React warning and keeps the props plain.

### Hydration

- `lib/client/format.ts` gains `formatNumber()` (en-US) and
  `formatTimestamp()` (en-US, **UTC**).
- Every unpinned `toLocale*String()` on the business surface now uses them:
  `business-profile`, `assessment-report`, `connection-card`,
  `reading-preview-dialog`, `domain-verification`, `business-workspace`,
  `credits-shortfall-dialog`, `intake-wizard`.
- Relative times (`relativeTime`, `relativeDeadline`) come from `Date.now()` and
  now carry `suppressHydrationWarning` on the element that prints them.

## Tests

- `lib/connected-business/client-docs.test.ts` — `_id` is removed, the result is
  plain, and the serializer's rule is asserted directly.
- `lib/existing-business/intake-view.test.ts` — empty/partial/unknown views,
  idempotence.
- `lib/client/format.test.ts` — en-US grouping and UTC timestamps.
- `lib/client-error-payload.test.ts` — validation, truncation, scope fallback.
- `components/error-boundary-view.test.tsx` — copy, reference, retry, back link.
- `components/existing-business/business-profile.test.tsx` — a partial view
  renders.
- `components/existing-business/assessment-report.test.tsx` — a partial stored
  assessment renders.

## Verification

- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors (368 pre-existing warnings).
- `npx vitest run` — 4630 passed, 15 skipped, 2 todo; 0 failed.
- `npm run build` — succeeded; `/api/client-errors` compiled as a dynamic route.

## What to watch

The next occurrence is now identifiable from the founder's screen alone: the
boundary prints a **Reference** (the Next digest). The matching line is

```
stage: "client_error", reason: <message>, scope: <boundary>, digest: <Reference>,
path: <route>, locale, timeZone, stack, componentStack
```

A server throw is also logged by Next with the same digest. Search the logs for
the digest and read `path` (which tab) and whether the line came from
`client_error` (browser) or Next's own server error (server render). That
distinction is the fact this change exists to supply.
