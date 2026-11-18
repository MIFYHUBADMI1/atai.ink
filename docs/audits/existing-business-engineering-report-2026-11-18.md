# Existing Business Initialization + Domain Ownership — Final Engineering Report

Date: 2026-11-18
Scope: Phase 1 ("Bring Your Existing Business to Atai") and Phase 1.5 (native domain ownership verification), delivered as extensions of the existing Atai architecture.
Companion audit: `docs/audits/existing-business-initialization-audit-2026-11-18.md` (read-first audit of reusable capabilities, gaps and collision surface).

Verification vocabulary used throughout:
- **Test-verified** — an automated test exercises the behavior and passes.
- **Reviewed in code** — implemented and read/type-checked, but not exercised against live external services in this environment.
- **Not verified here** — requires staging credentials, a real public domain, or an interactive browser this environment cannot provide. Called out explicitly; never claimed as working.

---

# PART M — FINAL IMPLEMENTATION REPORT

## 1. Summary

Atai now serves two kinds of founder without duplicating any system:

1. **Existing-business intake** (`/new/existing`): a 4-step wizard (business words → website → repository → goals & review) creates a normal Atai project (`mode: "scratch"`) with additive `startingPoint: "existing_business"` and an `intake` record. A background run reads the website (existing Firecrawl capability, cached), reads the repository read-only (existing GitHub OAuth client), claims the website's domain for verification, and generates a 9-section evidence-based assessment through the existing one-shot AI pipeline. Failed optional sources never destroy successful evidence; retries are idempotent and never double-charge.
2. **Business profile** (`/project/[id]/business`): honest processing states (submitted ≠ analyzed ≠ verified), the full assessment with an evidence ledger and basis labels, retry/reassess controls, and the domain verification panel.
3. **Native domain ownership verification** (Phase 1.5): meta-tag and HTML-file methods, 256-bit crypto tokens stored hashed, owner-only display copy, 7-day expiry, regeneration invalidation, hostname-exact claims with cross-business uniqueness enforced by a partial unique index, full SSRF protection with DNS pinning and per-hop redirect revalidation, rate limits, bounded history, a 3-strike grace policy for failed re-checks with owner notification, and release semantics. No paid third-party verification API. Verification is optional and never blocks initialization; it is explicitly **not** Google Search Console verification.
4. **Co-founder awareness**: the existing agent context now carries a bounded existing-business digest, and one new owner-gated READ tool (`get_business_assessment`) serves the full assessment on demand. No second AI system.
5. **Guided-tour registration**: the new surfaces are registered in the tour system built by the concurrent session (routes, targets, one tour definition) — additive-only edits, validated by that system's own 129 tests.

## 2. Audit findings — what was reused

| Capability | Reused implementation | Extension |
|---|---|---|
| Project creation | `lib/projects/create-project.ts`, `POST /api/projects` | Additive `startingPoint` + `intake` body fields; existing-business branch always uses `mode: "scratch"` so no existing mode branch changes behavior |
| Business entity | `MirrorProject` + `store` | Additive fields only; **no new business collection, no second onboarding** |
| Website reading | Firecrawl scrape service + 7-day `firecrawl_cache` + scrape credit charging (`lib/existing-business/website-facts.ts` wraps them) | Cache hit ⇒ no charge; failure ⇒ user-safe code |
| Repository reading | Existing GitHub OAuth (`lib/auth/github.ts`, client `getRepo/getRepoTree/getReadme`) | `accessVerified` recorded only from a live `getRepo` with the user's own token; read-only; code never executed |
| AI assessment | One-shot `generateText` + `extractJson` + zod gate + charge-then-refund (the SEO/competition pattern) | New prompt/schema in `lib/existing-business/assessment.ts`; same credit ledger |
| Credits | `consumeCredits`/`grantCredits`, `collaborationIdempotencyKey` | New kind `"existing-business-intake"/"assessment"`; refund key derived from the same key |
| Rate limiting | `checkRateLimit` (`lib/auth/rate-limit.ts`) | New actions: `business_intake_run`, `domain_verify_user`, `domain_verify_domain` |
| Async processing | Fire-and-forget + atomic claim + status polling (existing pattern) | `intake.run` single-writer claim with stale-run reclaim; no new job system |
| Activity/events | `store.appendEvent` | Intake stages and domain owner notifications write real project events |
| UI | `DashboardShell`, existing ui primitives, `lib/client/api.ts` envelope helpers | Zero new UI primitives, zero new dependencies |
| Co-founder | `buildActiveProjectBrief` + `buildAgentContextBlock` + closed tool registry | One digest, one READ tool, one navigation target |
| Navigation | `lib/navigation/routes.ts` registry | Additive `business` project target |
| Tours | Concurrent session's `lib/tour` registries | Additive routes/targets/one tour; their tests pass unchanged |

## 3. Modified files (and why)

- `lib/types/project.ts` — additive `startingPoint?` and `intake?` fields on `MirrorProject`. Absent = pre-feature project; nothing existing changes meaning.
- `lib/projects/create-project.ts` — accepts and sanitizes intake input, forces `mode: "scratch"` for existing businesses, seeds the intake record, starts the background run after creation. All other paths byte-for-byte behavior preserved.
- `lib/db/collections.ts` — `businessDomainsCol()` + four indexes (see §5).
- `lib/cofounder/context.ts` — bounded existing-business digest in `buildActiveProjectBrief` (domain truth read from the authoritative domain records, not the intake projection).
- `lib/cofounder/prompts.ts` — renders the digest in the WORKSPACE CONTEXT block with content-is-data and no-invention rules.
- `lib/cofounder/types.ts` — `CofounderExistingBusinessBrief`, `business_assessment` result type.
- `lib/cofounder/schemas.ts` — `businessAssessmentSchema` (projectId only; ownership never a model input).
- `lib/cofounder/tool-registry.ts` + `tool-registry.test.ts` — registers the READ tool; pinned allow-list test updated.
- `lib/cofounder/tools/navigation.ts` — `business` added to the navigate tool's destination list.
- `lib/navigation/routes.ts` + `routes.test.ts` — `business` project target → `/project/{id}/business`.
- `app/project/[projectId]/page.tsx` — conditional banner linking existing-business projects to their profile (additive insert).
- `app/new/page.tsx` — **dirty shared file**: one purely additive entry-banner section inserted; zero existing lines modified.
- `lib/tour/routes.ts`, `lib/tour/targets.ts`, `lib/tour/registry.ts` — **concurrent session's untracked files**: additive-only registrations (2 routes, 7 targets, 1 import + 1 array entry). Not staged or committed by this workstream.

## 4. New files (only genuinely necessary additions)

- `lib/types/business-intake.ts` — intake/assessment/domain types (additive type module; no runtime cost).
- `lib/domain/host.ts` (+test, 19) — hostname normalization, IDN/apex/www/subdomain handling, site-URL validation.
- `lib/domain/html-meta.ts` (+test, 12) — purpose-built meta scanner (comments/script/style raw-text skipped; quoted/unquoted attrs; entity decode). Avoided a cheerio dependency.
- `lib/domain/secure-fetch.ts` (+test, 59) — SSRF-guarded document fetch: scheme/port/credential guards, DNS resolve + all-addresses-public assertion, IP pinning with real TLS SNI/cert hostname, manual redirects revalidated per hop, byte/time caps.
- `lib/domain/service.ts` (+test, 38) — registration, token lifecycle, both verification methods, grace policy, owner notifications, release, bounded history, views.
- `lib/existing-business/objectives.ts` — 10 objectives mapped only to routes that exist, gated by the founder's feature switches.
- `lib/existing-business/website-facts.ts`, `repo-facts.ts` — thin wrappers over the existing scrape/GitHub capabilities producing compact evidence + digests.
- `lib/existing-business/intake.ts` (+test, 33) — record seeding, progress, atomic run claim, stage orchestration, credit-safe retries.
- `lib/existing-business/assessment.ts` (+test, 27) — evidence header, untrusted-content fencing, zod-gated 9-section output, measurement ban, objective-scoped priorities, charge/refund.
- `lib/existing-business/view.ts` — one founder-facing view shape keeping submitted/analyzed/verified distinct.
- `lib/cofounder/tools/business.ts` (+test, 12) — `get_business_assessment` READ tool.
- `lib/cofounder/context.test.ts` (12) — digest bounds, domain truth, prompt rendering.
- `components/existing-business/intake-wizard.tsx`, `business-profile.tsx`, `assessment-report.tsx`, `domain-verification.tsx` — the four UI surfaces.
- `app/new/existing/page.tsx`, `app/project/[projectId]/business/page.tsx` — server pages (auth + ownership gated).
- API routes: `app/api/projects/[id]/intake/route.ts`, `…/domains/route.ts`, `…/domains/[domainId]/route.ts`, `…/domains/[domainId]/verify/route.ts`, `…/domains/[domainId]/file/route.ts`.
- `lib/tour/tours/existing-business.ts` — one tour definition (concurrent session's directory; additive).

**Zero new npm dependencies.** The meta scanner, pinned fetch and token primitives are small, tested, purpose-built modules; every alternative considered (cheerio, a verification SaaS, a job queue) added cost or duplicated existing infrastructure.

## 5. Database changes

- `projects` (existing collection): additive optional fields `startingPoint` and `intake` (stages, run claim, assessment result, domain projection). Old documents read unchanged; `businessStartingPointOf` treats absent as `from_scratch`. No migration.
- **New collection `business_domains`** — justified: hostname uniqueness is a *cross-business* guarantee and cannot be enforced inside a project document. One document per claimed hostname per business; link-only by `projectId`.
  - Indexes: `id` unique sparse; `hostname` **unique with `partialFilterExpression: { releasedAt: { $exists: false } }`** (a released claim frees the hostname; active claims can never collide — enforced by the database, not check-then-insert); `{projectId, createdAt:-1}`; `{userId, updatedAt:-1}`. Created through the existing `ensureIndexes` path.
  - Secrets: `tokenHash` (SHA-256) is authoritative; `token` display copy is owner-only (see §11). History bounded to 20 entries, newest first (`$push` with `$each/$position:0/$slice`).
- No changes to credits, conversations, users or any other collection's shape.

## 6. API changes

All new routes use the existing `{ok,data}/{ok:false,error}` envelope, `requireUser` session auth, and project-ownership checks with uniform 404s (no existence leaks).

| Endpoint | Methods | Behavior |
|---|---|---|
| `/api/projects` | POST (extended) | Additive `startingPoint`/`intake` fields; existing payloads unchanged |
| `/api/projects/[id]/intake` | GET, POST | GET the intake view; POST retry (`{}`) or reassess (`{action:"reassess"}`) → 202 |
| `/api/projects/[id]/domains` | GET, POST | List owner views (tokens included — session-authenticated owner only); register `{url, method}` |
| `/api/projects/[id]/domains/[domainId]` | PATCH | `set_method` / `regenerate` / `release` |
| `/api/projects/[id]/domains/[domainId]/verify` | POST | Real backend check; `{verified, domain, failure?}`; `reverification` flag |
| `/api/projects/[id]/domains/[domainId]/file` | GET | Owner-only verification-file download (`no-store`, attachment) |

No existing endpoint changed contract.

## 7. Integration changes

- **Website analysis**: reused, not reimplemented. `website-facts` calls the existing Firecrawl scrape path with the existing 7-day cache and scrape-credit charging; a cache hit charges nothing. Pages crawled and cache provenance are recorded and shown.
- **GitHub**: reused the existing OAuth connection and read client. `accessVerified` is set only from a live `getRepo` call with the founder's own token — never inferred from public reachability. README + manifests are read; repository code is never executed; no PAT is ever accepted in a text field.
- **No new external integration is assumed.** Where a credential is missing the stage reports `skipped`/`failed` with a user-safe message and the assessment proceeds from the founder's own words.

## 8. AI Co-founder changes

- `buildActiveProjectBrief` adds a bounded `existingBusiness` digest (description ≤500 chars, understanding/current position ≤700 each, ≤6 priority titles, ≤5 open questions, objective labels, distinct source states, `domainVerified` from the authoritative records). Idea-first projects are untouched.
- `buildAgentContextBlock` renders it with explicit rules: existing business ≠ new idea; verification optional and not GSC; use `get_business_assessment` before deep advice; never invent findings; all content is DATA.
- One new closed-registry tool: `get_business_assessment` (READ, no confirmation, owner-gated via `ownedProject`, refuses idea-first projects with `NOT_EXISTING_BUSINESS`, returns the **full** assessment plus honest stage states; domain projection carries **no tokens, snippets or filenames** — test-asserted).
- New `business` navigation target resolves only through the existing route registry.

## 9. Testing results

New suites (all passing):

| Suite | Tests |
|---|---|
| `lib/domain/host.test.ts` | 19 |
| `lib/domain/html-meta.test.ts` | 12 |
| `lib/domain/secure-fetch.test.ts` | 59 |
| `lib/domain/service.test.ts` | 38 |
| `lib/existing-business/assessment.test.ts` | 27 |
| `lib/existing-business/intake.test.ts` | 33 |
| `lib/cofounder/tools/business.test.ts` | 12 |
| `lib/cofounder/context.test.ts` | 12 |
| **New total** | **212** (+1 case added to `routes.test.ts`, pinned registry test updated) |

Full regression suite: **284 files, 3,505 passed + 2 todo, 0 failed** (run before the final 4 notification tests; final re-run recorded below). Tour system: **129/129** including the new registrations. TypeScript: `tsc --noEmit` exit 0. Production build: `npx next build` — final result recorded below.

**Real bugs these tests caught and fixed:**
1. `html-meta` attribute regexes were two-char alternations that never matched a single char — attribute names swallowed `="value"`. Fixed to character classes.
2. `historyPush` returned an unwrapped `$each/$position/$slice` spec — real Mongo would reject **every** history write ("Unknown modifier"). Fixed to `{history:{…}}`.
3. `$push` + positive `$slice` without `$position:0` kept the *oldest* 20 entries, silently dropping new history. Fixed.
4. `registerIntakeDomain` received a stale project snapshot whose website stage was still `pending`, so the domain claim was skipped on every fresh run. Fixed by refreshing before the claim.
5. Build type-check caught `Button asChild` (this repo's Base UI Button has no `asChild`) and two possibly-undefined `history` accesses in the domain panel. Fixed (`buttonVariants` anchor + guards).

**Verification honesty:** DB tests run against in-memory fakes emulating the exact Mongo semantics used (unique index, dotted `$set`, `$push` modifiers, claim filter) because the dev database is a shared remote cluster. `secure-fetch` tests include real-socket tests of `defaultRequest` against a local HTTP server (byte cap, timeout). **No live verification against a real public domain was performed in this environment** — the verification flow is test-verified, not staging-verified. UI is type-checked and build-verified; interactive browser testing was not possible here (browser tooling cannot reach localhost), so UI behavior is reviewed-in-code, not click-tested.

## 10. Security review

- **SSRF**: string-level guards (http/https only, ports 80/443 only, no credentials, reject file/ftp/data/javascript, malformed URLs) → DNS resolution with **all** answers asserted public (mixed public/private rejected; IPv4 + IPv6 including mapped addresses) → connection pinned to validated IPs via custom `lookup` while TLS SNI/certificate verification keeps the real hostname → every redirect hop re-resolved and re-validated (max 3, loop detection, hostname-change policy per method). Raw network errors never reach users or logs; failures map to user-safe codes. 59 dedicated tests including rebinding, metadata endpoints, and redirect-to-loopback.
- **Tokens**: `randomBytes(32)` base64url (256-bit); SHA-256 hash stored as the authoritative secret; constant-time comparison; 7-day expiry; regeneration bumps the generation and invalidates the old challenge; release unsets token + hash. Display copy served only from the session-authenticated, ownership-gated endpoint; never logged; never in model payloads (test-asserted).
- **Ownership/isolation**: every domain operation checks `userId` + `projectId` with uniform 404s; hostname conflicts return `DOMAIN_TAKEN` without revealing the holder; verified domains are never auto-transferred; failed re-checks apply a 3-strike grace before expiry and notify the owner through the project activity feed.
- **Rate limits**: `business_intake_run` 6/h/user; `domain_verify_user` 20/h; `domain_verify_domain` 10/30min — checked before any fetch.
- **AI input safety**: website/repo/owner content fenced as untrusted in the assessment prompt; system prompt bans following embedded instructions and inventing metrics; output zod-gated; findings claiming unmeasured metrics (ranks, visitors, CTR…) are dropped; observed-basis downgraded to assumption without sources; priorities restricted to chosen objectives and real routes. Co-founder tool inputs never carry authorization.
- **Billing**: assessment charges the admin-configured plan-analysis cost with a per-project idempotency key; refund on model failure/unusable output; crawl charged only on cache miss; insufficient credits refuse before any spend.

## 11. Known limitations

1. **Token display copy is stored plaintext** (owner-only retrieval, never logged). Encryption at rest is a follow-up; the hash is already the authoritative secret.
2. **No periodic re-verification scheduler.** Re-checks are manual/event-driven; the platform has no job substrate yet (deliberately not invented). The grace policy and attention flag are ready for a future scheduler.
3. **Owner notification = project activity event + prominent "needs attention" UI**, not email/push (no general notification channel exists to reuse).
4. External credentials required for full functionality: Firecrawl (website reads), OpenRouter (assessment), GitHub OAuth (private repos). Without them the intake degrades honestly to owner-stated evidence.
5. Assessment quality depends on the configured model; outputs are schema-gated and metric-filtered but not human-reviewed.
6. **Not staging-verified**: no live public-domain verification, no interactive browser pass, no real-credit end-to-end run in this environment.
7. Atai verification establishes an internal ownership record only. It grants nothing in Google Search Console, Analytics, ad platforms, DNS or hosting — those keep their own authorization flows.

## 12. Launch readiness

Honest assessment: **code-complete and automated-check green, not yet production-certified.**
- Verified here: 212 new tests + full regression suite + tour suite + `tsc` + production build (final numbers below); SSRF and token behavior test-verified including real-socket fetch bounds.
- Required before a production claim: a staging run with real credentials — create an existing business end-to-end, verify a real public domain via both methods (meta tag and file), exercise expiry/regeneration/release against the live site, and click through the wizard/profile/panel on mobile and desktop. The spec's own rule is honored: no successful-verification claim without a real backend verification, and no production-readiness claim without those passes.

---

# PART 13 — FINAL ENGINEERING REPORT (Domain Ownership & Verification)

1. **Initial codebase audit** — `docs/audits/existing-business-initialization-audit-2026-11-18.md`; domain-specific findings: no existing verification capability, reusable rate-limit/crypto/fetch guards, shared-Atlas constraint.
2. **Existing capabilities reused** — `generateToken` (auth crypto), `checkRateLimit`, `store.appendEvent`, API envelope/auth helpers, ui primitives, Firecrawl/GitHub clients for intake integration. No paid verification API, no DNS provider access, no hosting credentials.
3. **Database changes** — `business_domains` collection + partial unique hostname index (see Part M §5). One document per claim; bounded history; release frees the hostname.
4. **API endpoints** — five new owner-gated routes (Part M §6); tokens only in session-authenticated owner responses.
5. **Token architecture** — 256-bit `randomBytes` → base64url; SHA-256 hash authoritative; constant-time compare; 7-day TTL; generation counter invalidates old challenges on regeneration; owner-only display copy; release unsets secrets.
6. **Meta tag method** — `<meta name="atai-verification" content="TOKEN">` scanned by a purpose-built parser (raw-text elements skipped, attribute quoting variants, entity decoding); diagnosis distinguishes missing vs mismatch; script-interior text never counts (test-asserted).
7. **HTML file method** — `atai-verification-TOKEN.html` containing exactly `atai-verification=TOKEN`, fetched at the hostname root with hostname-change disallowed; owner-only download endpoint serves the exact file; wrong/empty/unrelated content rejected.
8. **SSRF implementation** — see Part M §10; 59 tests incl. DNS rebinding, mixed answers, IPv6 mapped metadata addresses, redirect chains, real-socket byte/time caps.
9. **Rate limiting** — per-user 20/h and per-domain 10/30min on verification, checked before fetch; intake runs 6/h/user; existing architecture, no new limiter.
10. **UI changes** — domain panel inside the business profile: method choice, copyable snippet with clipboard fallback, file download, status chips, needs-attention warning with grace explanation, expiry/attempts line, check/re-check, new challenge, inline release confirmation, formatted bounded history. Mobile-first stacked cards; nothing clipped.
11. **Business initialization integration** — intake claims the website hostname automatically after a successful read (best-effort; `DOMAIN_TAKEN` never blocks); profile shows submitted/analyzed/verified as three distinct states; verification never blocks onboarding; assessment evidence records `domainVerified` from the authoritative records.
12. **Test results** — 128 domain tests (host 19, html-meta 12, secure-fetch 59, service 38) + intake/assessment integration coverage; full suite and build numbers in Part M §9.
13. **Known limitations** — Part M §11 (plaintext display copy, no scheduler, activity-feed notification, staging passes outstanding).
14. **Deployment requirements** — no new environment variables and no new services. Indexes are created by the existing `ensureIndexes` path on boot. Existing credentials (Mongo, Firecrawl, OpenRouter, GitHub OAuth) cover everything; verification itself needs none. Recommended before launch: the staging verification matrix in Part M §12.

---

# ACCEPTANCE CRITERIA

## Phase 1 (20)

| # | Criterion | Status |
|---|---|---|
| 1 | Existing initialization paths still work | Test-verified — full regression suite green; creation branches untouched except additive field handling |
| 2 | Users can bring an existing business | Implemented + build-verified (`/new/existing` wizard); interactive click-through pending staging |
| 3 | Existing website URL accepted | Test-verified (intake tests) |
| 4 | Optional authorized GitHub repo | Test-verified (accessVerified from live getRepo; mocked client) |
| 5 | Business description + objectives | Test-verified (sanitize, closed objective list) |
| 6 | Real website analysis | Test-verified orchestration; live Firecrawl run pending staging |
| 7 | Repository analysis where access exists | Test-verified orchestration; live GitHub run pending staging |
| 8 | Evidence-based AI assessment | Test-verified (evidence header, basis downgrade, metric ban, fencing); live model run pending staging |
| 9 | Canonical profile initialized | Test-verified (intake record seeding on the project) |
| 10 | Appears in Businesses section | Reviewed in code — same `store.listProjects` path, no separate entity |
| 11 | Opens in existing workspace | Reviewed in code — standard project routes + additive banner |
| 12 | Workspace recognizes the context | Implemented + build-verified (profile link, `/business` page) |
| 13 | Co-founder has correct context | Test-verified (digest + tool + prompt tests) |
| 14 | Failed optional analyses keep success | Test-verified (partial completion, evidence retained) |
| 15 | Safe idempotent retry | Test-verified (atomic claim, stale reclaim, cache-hit no charge, idempotency keys) |
| 16 | Billing correct | Test-verified (charge/refund paths, pre-checks, keys) |
| 17 | Security boundaries preserved | Test-verified (ownership, SSRF, injection, rate limits) |
| 18 | All relevant tests pass | Test-verified — see Part M §9 |
| 19 | Nothing existing broken | Test-verified — full suite green |
| 20 | No duplicate business/AI systems | Reviewed in code — one project entity, one agent, one registry |

## Phase 1.5 (22)

| # | Criterion | Status |
|---|---|---|
| 1 | Add domains to existing businesses | Test-verified (register) + UI build-verified |
| 2 | Unique secure tokens | Test-verified (256-bit, distinct, hashed) |
| 3 | Meta verification choice | Test-verified + UI |
| 4 | File verification choice | Test-verified + UI |
| 5 | Clear instructions | Reviewed in code (snippet + upload copy) |
| 6 | Copy tags | Implemented (clipboard + manual fallback); click-test pending |
| 7 | Download files | Implemented (owner-only attachment endpoint); click-test pending |
| 8 | Backend verification works | Test-verified incl. real-socket fetch; **live public-domain verification pending staging** |
| 9 | No paid third-party API | True by construction — native only |
| 10 | Success updates the correct business | Test-verified (ownership + record update) |
| 11 | Expired tokens rejected | Test-verified |
| 12 | Invalid tokens rejected | Test-verified (mismatch/missing/wrong file) |
| 13 | Cross-business access prevented | Test-verified (uniform 404s, no holder disclosure) |
| 14 | SSRF protections pass security tests | Test-verified (59 tests) |
| 15 | Redirects validated | Test-verified (per-hop revalidation, rebinding, loops) |
| 16 | Attempts rate-limited | Test-verified (limits before fetch) |
| 17 | History maintained | Test-verified (bounded 20, newest first, store + view) |
| 18 | Token regeneration | Test-verified (old challenge invalidated) |
| 19 | Status visible | Implemented + build-verified (chips, attention, expiry) |
| 20 | Initialization remains functional | Test-verified (intake suite + full regression) |
| 21 | Mobile responsive | Reviewed in code (stacked cards, wrap layouts, 16px inputs); device testing pending |
| 22 | Tests pass | Test-verified — see Part M §9 |

---

## Final verification run (after last fixes)

Re-run after the owner-notification feature and the `domain-verification.tsx` build fixes, with real exit codes captured (log file + `echo $?`, never a pipe):

- `npx vitest run` — **exit 0**. `Test Files 284 passed (284)`, `Tests 3509 passed | 2 todo (3511)`.
- `npx next build` — **exit 0**. `✓ Compiled successfully in 3.1min`, `Finished TypeScript in 47s`. Build manifest lists both new server-rendered routes: `ƒ /new/existing` and `ƒ /project/[projectId]/business`.

Still not covered by this run (unchanged from §9): live domain verification against a real site, real-credential intake end-to-end, and browser click-throughs — those need staging and are listed as click-test pending.