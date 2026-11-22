# 1. OBJECTIVE

Make one business belong to exactly one Atai account.

A business is identified by the live website it runs on. Today the same founder can create several existing-business projects for the same site, and a second account can create a project for a site that another account has already claimed — the intake only writes a warning event and still runs (and charges) the assessment. The goal is:

* the same account cannot connect the same business twice (the existing project is reused instead),
* no other account can connect a business whose website is already claimed/verified,
* the only ways to free a business are the owner releasing/deleting it, or a support-assisted transfer,
* nothing is disclosed about who holds the other claim.

# 2. CONTEXT SUMMARY

**Journey.** This is the connected-business journey only (`/new/existing` → `POST /api/projects` with `startingPoint: "existing_business"`). The GitHub-import and build journeys are untouched.

**Creation funnel.** `createUserProject` in `lib/projects/create-project.ts` is the single creation path (the Co-founder `create_project` tool also calls it). For an existing business it requires `intake.websiteUrl` (`hasIntakeSource` / `INTAKE_SOURCE_ERROR` in `lib/existing-business/source-rule.ts`), seeds `project.intake` via `buildIntakeRecord`, then calls `startBusinessIntake`. Its duplicate check is `findRecentDuplicate(userId, { idea })` — it compares the founder's prose, not the website, so two projects for the same site are not detected.

**Claim registry.** `lib/domain/service.ts` stores ownership claims in the `business_domains` collection (`BusinessDomainDoc` in `lib/types/business-intake.ts`). `registerDomain` is idempotent per `(projectId, hostname)` and throws `DOMAIN_TAKEN` (409) when another unreleased record already holds the exact `hostname`. The unique partial index `business_domains_hostname_active_unique` in `lib/db/collections.ts` is the race-safe authority. `releaseDomain` sets `releasedAt`/`status: "revoked"`, clears the token and frees the hostname.

**Intake.** `lib/existing-business/intake.ts` runs crawl → `registerIntakeDomain` → assessment. `registerIntakeDomain` currently catches every failure (including `DOMAIN_TAKEN`) and only appends a warning event, so a duplicate business still gets an assessment and is charged. `prepareIntakeRun` is the pre-flight gate used by both `startIntakeRun` and `runBusinessIntake`; it checks access, eligibility, credits, rate limit and the single-writer claim, but not whether the business is already held by someone else.

**Deletion.** `MongoStore.deleteProject` (`lib/store/mongo-store.ts`) revokes runtime keys and cascades build runs, attachments and project artifacts, but it does **not** release `business_domains` records. Deleting a connected business therefore leaves its hostname claimed forever.

**UI.** `components/existing-business/intake-wizard.tsx` collects the URL and submits; it shows a generic error from `postJson`. `components/existing-business/business-profile.tsx` renders the three steps from `lib/existing-business/steps.ts` (assessment → domain → connection). `components/existing-business/domain-verification.tsx` already has a per-domain “Release” action. `components/project-card.tsx` already has a dashboard Delete action that calls `DELETE /api/projects/[id]`.

**Constraints / invariants.**
* The exact submitted hostname is the verification target; `registrableDomain` is display-only and must never decide verification (`lib/domain/host.ts` header).
* `www.example.com` and `example.com` currently count as different claims, although they are the same business for this purpose.
* A pending challenge currently blocks the hostname forever; `toDomainView` shows it as “expired” but the database record still participates in the unique index.
* Credits are charged per stage (`readCost` for the crawl, `assessmentCost` for the model call). A guard must run before both.
* Domain claims must never reveal the owning account or project.

# 3. APPROACH OVERVIEW

Use the existing `business_domains` collection as the single authority for “who holds this business”. Do not add a second project-level registry.

1. Introduce a **canonical business host**: the normalized hostname with a safe leading `www.` removed (only when the remainder is still a valid registrable name). Exact hostname remains the verification target; the canonical host is used only for uniqueness/conflict checks.
2. Store `canonicalHostname` on every claim and add a unique partial index over active primary claims, so “one business, one claim” is a database guarantee rather than a check-then-insert race.
3. **Reserve the claim at project creation** (before the project row and before any credits). If the caller already holds it, return that project with `reused: true`; if another account holds it, return `409 BUSINESS_ALREADY_CONNECTED` without creating a project.
4. **Fail fast in intake**: `prepareIntakeRun` checks the claim before the crawl, and `registerIntakeDomain` aborts the run before the assessment if the redirect target is held by someone else. No read or assessment credits are spent on a business that cannot be connected.
5. **Lifecycle**: unverified reservations expire (anti-squatting); a claim that was ever verified stays blocking until explicitly released, deleted with its project, or released by support.
6. **Release paths**: project deletion cascades to claims; releasing the last verified domain refreshes the connection status. The dashboard Delete action is the owner-facing “delete it from the other user” path.
7. **Founder-facing states**: a preflight availability check in the wizard, a blocked-state card in the business profile, and copy that never names the other account.
8. **Rollout**: backfill `canonicalHostname` and reconcile pre-existing duplicates before the unique index is created.

**Decisions (confirmed):**

| Decision | Choice |
|---|---|
| What counts as “the same business” | Exact host + `www` alias; subdomains (`shop.example.com`) are distinct |
| Unverified claim blocking window | 72 hours, then it stops blocking |
| Verified claim after a failed re-check | Keeps blocking until released/deleted/support |
| Self-service takeover by proving the domain | Not allowed; support-assisted transfer only |
| Preflight check in the wizard | Included: `GET /api/business/availability` |
| Support override | Operator script (dry-run/apply) with audit |

**Out of scope:** changing the verification mechanism or token model, merging the two onboarding journeys, build/deploy behaviour, billing/pricing changes, workspace-level (multi-member) ownership.

# 4. IMPLEMENTATION STEPS

### Step 1 — Canonical business host helper
**Goal:** One pure, tested rule for “same business” that never weakens verification.
**Method:** Add `canonicalBusinessHost(hostname: string): string` to `lib/domain/host.ts`. Lowercase/IDNA is already done by `normalizeHostname`. Strip a leading `www.` only when the remainder still has at least two labels and `registrableDomainOf` agrees (so `www.example.com` → `example.com`, but `www.co.uk` stays as-is because `co.uk` is a public suffix). Export a `sameBusinessHost(a, b)` helper for call sites. Document that this is a uniqueness input, never a verification target.
**Reference:** `lib/domain/host.ts`, `lib/domain/host.test.ts`.

### Step 2 — Extend the claim document and index
**Goal:** Persist the canonical key and make one primary claim per business a database invariant.
**Method:**
* Add `canonicalHostname?: string` and optional `aliasOf?: string` to `BusinessDomainDoc` (`lib/types/business-intake.ts`). Keep it optional during rollout: the service must fall back to `canonicalBusinessHost(hostname)` for records the backfill has not reached yet. `aliasOf` marks an additional exact-host record that belongs to the same project as the primary claim (preserves the existing ability to verify apex and `www` separately without letting another project claim either).
* In `ensureIndexes` (`lib/db/collections.ts`), add a unique partial index:
  `businessDomains.createIndex({ canonicalHostname: 1 }, { unique: true, partialFilterExpression: { releasedAt: { $exists: false }, aliasOf: { $exists: false }, canonicalHostname: { $type: "string" } }, name: "business_domains_canonical_active_unique" })`
  Keep the existing exact-hostname index.
* Add a `claimExpiresAt?: number` field for unverified reservations (used by Steps 3–5) so expiry is explicit rather than inferred from the token TTL.
**Reference:** `lib/types/business-intake.ts`, `lib/db/collections.ts`.

### Step 3 — Claim service: reserve, look up, release
**Goal:** One API for the creation guard, the intake guard and the UI, so all three agree.
**Method:** Add to `lib/domain/service.ts`:
* `canonicalClaimFor(rawUrlOrHost, now)` → the active primary claim for the canonical host, treating a reservation whose `claimExpiresAt` has passed as inactive.
* `reserveBusinessClaim({ userId, projectId, rawUrl })` → `{ claim, created } | { reusedProjectId } | throws BUSINESS_ALREADY_CONNECTED`. It normalizes the URL, looks up by `(projectId, hostname)` first (idempotent), then by canonical host. Same project → alias record (if the exact host differs); same user different project → return that project id for reuse; other user → 409. Insert as primary and let the unique index settle races; translate `E11000` into `BUSINESS_ALREADY_CONNECTED` (same user → 409 `IN_PROGRESS`).
* Extend `registerDomain` to use `canonicalHostname` for the conflict check and to set `claimExpiresAt` on pending records. Keep `DOMAIN_TAKEN` as the low-level code for compatibility; add `BUSINESS_ALREADY_CONNECTED` for canonical conflicts with one shared founder message.
* Extend `releaseDomain` to clear `claimExpiresAt` and call `refreshConnectionStatus(projectId)` (from `lib/connected-business/service.ts`) so releasing the last verified domain drops the cached connection status.
* Add a small `releaseProjectClaims(projectId, reason, session?)` helper reused by deletion and support tooling.
**Reference:** `lib/domain/service.ts`, `lib/connected-business/service.ts`.

### Step 4 — Creation guard in `createUserProject`
**Goal:** No duplicate project is created, for the same account or another account.
**Method:** In `lib/projects/create-project.ts`, for `isExistingBusiness`:
* Keep the idempotency-key path first.
* Generate the project id before the claim: `const projectId = cryptoId()` and let `newProject` accept it.
* Call `reserveBusinessClaim({ userId, projectId, rawUrl: intake.websiteUrl })` after the source validation and before `store.createProject`.
  * `reusedProjectId` → load and return that project with `reused: true` (the wizard already navigates to `/project/:id/business`).
  * `BUSINESS_ALREADY_CONNECTED` → return `fail("BUSINESS_ALREADY_CONNECTED", message, 409)`. Message: the website is already connected to another Atai account; only that account can disconnect it; if this is your business, contact support. Never include an account id, email or project id.
  * Reservation created → create the project; if `store.createProject` throws, release the reservation in a `catch` and rethrow.
* Replace `findRecentDuplicate(userId, { idea })` for existing businesses with this claim check (keep it for other modes).
* If the claim is orphaned (its `projectId` no longer resolves to a project, or the project is not owned by this user), release it and reserve again.
**Reference:** `lib/projects/create-project.ts`, `lib/store/store.ts` (`getProject`), `lib/api/respond.ts` (`fail`).

### Step 5 — Intake fail-fast and abort before assessment
**Goal:** A taken business never spends read or assessment credits, and never ends up looking connected.
**Method:**
* In `prepareIntakeRun` (`lib/existing-business/intake.ts`), after eligibility and before the credit check/rate limit: resolve the canonical host from `intake.website.url`; call `canonicalClaimFor`. If the holder is another user → return `{ ok: false, code: "BUSINESS_ALREADY_CONNECTED", message }`. If there is no claim (legacy project), call `reserveBusinessClaim` for this project; if taken, refuse. This covers both `startIntakeRun` and cron `runBusinessIntake`.
* Change `registerIntakeDomain` to return `{ ok: true } | { ok: false, code, message }`. On `BUSINESS_ALREADY_CONNECTED`/`DOMAIN_TAKEN`, `executeIntakeRun` appends one event, releases the run as `failed`, and returns the refusal **before** `runAssessment` — the crawl may already have been charged, but the assessment is not. Other domain failures (malformed host, network) keep the current non-blocking behaviour.
* On a redirect to a different host, reserve/register the redirect target as an alias. If that target is held by another user, abort with the same message and keep the original claim (the founder submitted that address).
* Persist the refusal on the intake record (e.g. `intake.claim = { hostname, state: "held_by_other", at }`) so the profile can show it after a reload, not only as an activity event.
**Reference:** `lib/existing-business/intake.ts` (`prepareIntakeRun`, `executeIntakeRun`, `registerIntakeDomain`), `lib/types/business-intake.ts` (`BusinessIntake.claim`).

### Step 6 — Deletion and release lifecycle
**Goal:** Deleting the business from the owning account frees the website so it can be connected again.
**Method:**
* In `MongoStore.deleteProject` (`lib/store/mongo-store.ts`), inside the existing transaction and after the ownership-checked `deleteOne`, release every active claim for the project: set `status: "revoked"`, `releasedAt`, `updatedAt`, `$unset` `token`/`tokenHash`, `$push` a bounded history entry `{ status: "revoked", at, detail: "project deleted" }`. Use the same session. Import `businessDomainsCol` and `MAX_DOMAIN_HISTORY`.
* Keep the existing runtime-key revocation; a released business with revoked keys has no lingering access.
* Update the `DELETE /api/projects/[id]` response warning (`app/api/projects/[id]/route.ts`) so it distinguishes “the Atai ownership claim is released” from “external domains/subscriptions are not cancelled”.
* Add an explicit “Release claim” path already present in `domain-verification.tsx`; make its copy state that releasing the last verified domain frees the website for another account.
* A separate “Disconnect this business” action is deliberately not included: deletion is the documented owner path, and per-domain release already covers “keep the project, free the host”.
**Reference:** `lib/store/mongo-store.ts`, `app/api/projects/[id]/route.ts`, `components/existing-business/domain-verification.tsx`.

### Step 7 — Expose claim state and update the UI
**Goal:** The founder learns the truth before filling a form or spending credits.
**Method:**
* Add `claim: { hostname?: string; state: "unclaimed" | "yours" | "held_by_other" }` to `IntakeView` (`lib/existing-business/view.ts`), derived from `intake.claim` + the domain records. Add a test in `view.test.ts`.
* `business-profile.tsx`: when `claim.state === "held_by_other"`, replace the domain step body with a clear card: “This website is already connected to another Atai account.” + “If you own it, contact support to recover it.” + “If you connected it with another account of your own, sign in to that account and delete the business there.” Hide the token/verification controls for that state. Do not offer “Try again” for the assessment while the claim is held.
* `intake-wizard.tsx`: on submit, surface `BUSINESS_ALREADY_CONNECTED` as an inline error on the URL step (not a toast), keep the form values, and add the support link. When the preflight (Step 8) says unavailable, disable “Continue” with the same copy.
* `domain-verification.tsx`: show a `taken` state for a `DOMAIN_TAKEN`/`BUSINESS_ALREADY_CONNECTED` response instead of a generic red line.
**Reference:** `lib/existing-business/view.ts`, `components/existing-business/business-profile.tsx`, `components/existing-business/intake-wizard.tsx`, `components/existing-business/domain-verification.tsx`.

### Step 8 — Preflight availability endpoint
**Goal:** Tell the founder before the form is complete, with no ownership disclosure.
**Method:** Add `app/api/business/availability/route.ts`:
* `GET ?url=…`, `requireUser`, `checkRateLimit({ action: "business_claim_check", identifier: user.id, limit: 60, windowMs: 3_600_000 })`.
* Normalize the URL; return `{ hostname, available: boolean, mine?: boolean }`. `available: false` only when another account holds an active claim; `mine: true` when the caller already holds it. Never return the holder’s id, name, project or claim status.
* Invalid URLs → `{ available: false, reason: "invalid" }` with 422, using the same message as `assertSiteUrl`.
* The wizard debounces ~500 ms on a parseable URL and uses the result as a hint; the creation guard remains authoritative.
**Reference:** new route, `components/existing-business/intake-wizard.tsx`.

### Step 9 — Support / operator release
**Goal:** A legitimate owner can recover a business when the old account is unreachable, without a database console.
**Method:** Add `scripts/release-business-claim.ts` following the `scripts/migrate-entitlements.ts` pattern (`dry-run` / `apply`, `--force`): resolve by exact host or canonical host, refuse unless `--reason` is given, release with `detail: "released by support: <reason>"`, log the operator action. An admin-only page/API is explicitly deferred; the script is the v1 support path.
**Reference:** `scripts/release-business-claim.ts`, `lib/domain/service.ts`.

### Step 10 — Backfill, rollout, observability, docs
**Goal:** Existing data is consistent before the unique index is enforced, and the rule is discoverable.
**Method:**
* Add `scripts/backfill-business-claims.ts` (dry-run/apply):
  1. compute `canonicalHostname` for every `business_domains` doc;
  2. group unreleased docs by canonical host;
  3. pick the primary: verified first, then oldest;
  4. same project + different exact host → set `aliasOf`; different projects → release the non-primary with `detail: "duplicate canonical host — released during backfill"`;
  5. set `claimExpiresAt` on pending records;
  6. report collisions so an operator can review before `apply`.
* Rollout order: deploy the script and run `dry-run` → `apply` in the target environment, then deploy the index change. `ensureIndexes` already catches/logs a failed bootstrap and retries; do not let a failed index creation crash requests.
* Log `business.claim` events (`reserved`, `refused`, `released`) with hostname/projectId/userId/reason; never log tokens. Add one project activity event when intake refuses a business.
* Update the “Project notes” section of `AGENTS.md`: one business = one account; canonical host rule; deletion releases the claim; exact hostname still verifies.
**Reference:** `scripts/backfill-business-claims.ts`, `lib/db/collections.ts`, `AGENTS.md`.

# 5. TESTING AND VALIDATION

**Unit / integration tests**
* `lib/domain/host.test.ts`: `canonicalBusinessHost` — case, `www.example.com` → `example.com`, `www.example.co.uk` → `example.co.uk`, `www.co.uk` unchanged, `shop.example.com` distinct, IP literals unchanged, IDN.
* `lib/domain/service.test.ts`: same canonical host from two projects → `BUSINESS_ALREADY_CONNECTED`; same project apex + `www` → alias record, no second primary; released claim frees the host; expired reservation stops blocking; verified claim never expires; `E11000` race → taken; release clears the token and refreshes connection status.
* `lib/projects/create-project.test.ts` (new): same user twice → `reused: true`, one project, no second reservation; another user → 409, no project created; orphaned claim → released and re-reserved; project-creation failure → reservation released.
* `lib/existing-business/intake.test.ts`: `prepareIntakeRun` refuses a held business before `chargeBusinessReadCredits`/assessment; `registerIntakeDomain` conflict aborts before `generateBusinessAssessment`; redirect-to-taken aborts; legacy project with no claim reserves on first run.
* `lib/existing-business/view.test.ts`: claim states (`unclaimed`, `yours`, `held_by_other`) and the persisted refusal.
* `lib/store/mongo-store.deletion.test.ts`: `businessDomainsCol.updateMany` releases claims inside the transaction; no release when ownership fails; failure propagates.
* `app/api/business/availability/route.test.ts` (new): available/unavailable/mine, no holder leakage, rate limit, invalid URL.
* `components/existing-business/domain-verification.test.tsx` and `business-profile.test.tsx`: blocked copy, hidden token, support link, release copy. UI assertions use `renderToStaticMarkup` (the suite runs in `node`).
* Migration: a pure reconciliation function tested with duplicate apex/`www` and cross-project fixtures (dry-run must not write).

**Manual scenarios**
1. Same account, same URL twice → lands on the existing business, no second project, no second charge.
2. Account B enters a URL held by account A → inline “already connected” message; no project created, no credits spent; nothing about A is shown.
3. Account A deletes the business from the dashboard → the claim is released; account B can now connect it.
4. Account A releases the domain in the profile → the connection drops from “Connected”; account B can connect the same host.
5. Account A reserves but never verifies → after the reservation window the host is available to B.
6. Account A has a verified claim → it stays blocking indefinitely, including after a failed re-check.
7. `https://example.com` and `https://www.example.com` are the same business; `https://shop.example.com` is distinct.
8. A site that redirects to a host held by another account → intake stops before the assessment and says why.
9. Support script `dry-run` shows the claim; `apply` frees it with an audit history entry.
10. Existing single-business flows (GitHub import, build-from-idea, website mirror) are unchanged.

**Commands**
* `npx tsc --noEmit`
* `npx vitest run`
* `npm run lint` (zero errors; existing warnings acceptable)

**Success criteria**
* At most one active primary claim exists per canonical business host, enforced by the database.
* No existing-business project is created for a business held by another account.
* No read or assessment credits are spent on a business that cannot be connected.
* Deleting or releasing the business frees the host; no verified claim is freed implicitly.
* No response or log line reveals the other account’s identity.
* All existing tests pass; the new tests cover each rule above.
