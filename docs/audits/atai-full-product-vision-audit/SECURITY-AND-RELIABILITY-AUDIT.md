# SECURITY & RELIABILITY AUDIT

**Audit:** ATAI.INK Full Product Vision & Expectation-Gap Audit (Part 9 of 16)
**Date:** 2026-11-09
**Method:** Read-only code inspection, ownership-check sampling across route families, credential-flow tracing, abuse-surface inventory. Claims carry `path:line` citations and VERIFIED / INFERRED / UNVERIFIED labels. No exploitation was attempted, no production configuration inspected.
**Companion:** RUNTIME-BILLING-AND-INFRASTRUCTURE-AUDIT.md covers metering internals; BUSINESS-DATA-AND-INTEGRATION-AUDIT.md covers deletion lifecycle. This document consolidates the security reading of both plus auth, injection, abuse surfaces, and operational reliability.

---

## 1. Threat model in one paragraph

Atai holds: founder credentials (passwords, sessions), Atai's provider keys (OpenRouter, Dodo, Totalum, Firecrawl, ImageKit), per-project runtime keys held by generated apps, founders' credit balances, and — via one commingled Dodo account — read access to every founder's customers' payment records. Attackers to consider: a malicious founder (IDOR, credit abuse), a compromised generated app (key leak → runtime abuse), malicious content embedded in websites/plans/READMEs (prompt injection), external internet (auth abuse, webhook forgery), and a leaked database dump (credential reuse).

---

## 2. Authentication & sessions — VERIFIED strong

- Passwords: bcrypt reserved for human passwords (`lib/auth/crypto.ts`), separate fast-hash path for high-entropy tokens; strength checked at registration (routes-security test suite mocks `isPasswordStrongEnough`).
- Sessions: opaque 43-char tokens in httpOnly cookies; only SHA-256 hashes stored server-side (`lib/auth/session.ts:10-12`); `sameSite: "lax"`, `secure` derived from request origin (`:110-112`); bulk revocation on password change (`:179`).
- OAuth (Google/GitHub) present with callback routes; state/PKCE handling not re-verified in this pass (UNVERIFIED).
- Login/register/resend each rate-limited (`app/api/auth/login/route.ts:26` — 10/15min per email; `register/route.ts:34` — 5/hr) with a dedicated regression suite (`lib/auth/routes-security.test.ts`, `rate-limit-*.test.ts`, `request-limit.ts` ingress limiter).
- Verification-token flows use single-use `findOneAndUpdate` claims (test mocks confirm `claim` semantics).

**Session-start trust defect found in the UI layer** (from UX audit, repeated here because it is security-relevant): `components/auth/auth-panel.tsx:342` — the verify-view Continue button calls `onAuthenticated(next)` without confirming the email verification state; the composer separately re-probes the session server-side (start-funnel hardening, 2026-11-08), so the backend is safe, but the client gate is soft. P3.

---

## 3. Authorization & IDOR sampling — VERIFIED consistent

- Every project-scoped route sampled performs `project.userId !== user.id` before acting (e.g. `app/api/projects/[id]/route.ts:61,103,275`; assets, secrets, database, deploy, export all follow the same pattern — 16+ routes sampled, zero misses).
- Deletion is atomically ownership-filtered inside the Mongo transaction (`lib/store/mongo-store.ts:551-555`).
- Admin surface: single `users.isAdmin` boolean; `requireAdmin()` throws 403 (`lib/auth/session.ts:164-168`) and is present in every admin route sampled (grep across `app/api/admin/*` — VERIFIED).
- Internal S2S routes use constant-time shared-secret comparison, fail closed when the key is unset (503, not open), and never log key material (`lib/api/internal-key.ts:41-67`), with hashed-identifier rate limiting (`lib/api/internal-limit.ts:5-9`).
- Co-founder mutations go exclusively through pending-action records with an atomic pending→executing claim, so double-approval is structurally impossible (`lib/cofounder/pending-actions.ts:77-97`); tool allow-list is closed (`lib/cofounder/tool-registry.ts`).

**The one broken tenancy boundary** is not a route — it is the runtime key surface (see §5).

---

## 4. Secrets handling — VERIFIED strong

- Runtime keys: 256-bit random, plaintext shown once, SHA-256 stored, safe 4-char prefix display, constant-time digest compare (`lib/runtime/key-crypto.ts:15-77`).
- Log redaction: field-name and value-shape based stripping (`atai_*` keys, bearer tokens, Mongo URIs, `whsec_*`, `sk-*`), 500-char value caps, envelope-key namespacing (`lib/logging/logger.ts:5-58`).
- Built-app secrets: values pass through Atai to Totalum and are never stored or returned by list endpoints (`app/api/projects/[id]/secrets/route.ts:31-38`); `ATAI_API_KEY` name is reserved from founder overwrite (`:80+`).
- Webhook secret: base64-decoded per request, never logged; configured-ness (not the value) is what logs expose (`app/api/billing/webhook/route.ts:80-88`).
- `.env` hygiene: only `.env.example` is tracked (VERIFIED via `git ls-files`).

---

## 5. Cross-tenant exposure — the P0 finding

**S-01 (P0): a generated app's key can read every Atai founder's payment feed.**

Chain, each link VERIFIED:
1. Auto-provisioned keys carry the full routed capability set including `payments` (`PROVISIONED_KEY_SCOPES = ROUTE_CAPABILITY_IDS minus "test"`, `lib/runtime/provisioning/service.ts:83-85`).
2. Dodo `listPayments` and `listPayouts` are executed with **platform** credentials (`lib/runtime/router/adapters/dodo/client.ts:188-202`).
3. The list input supports only limit/status/subscription/customer filters — no project or metadata filter (`lib/runtime/router/adapters/dodo/mapper.ts:279-327`); the response mapping passes through customer email/name and amounts (`:395-411`).
4. Payouts are account-level by design (`mapper.ts:412-420`).

Consequence: any compromised generated app (or its leaked `ATAI_API_KEY` from a client bundle, a git repo, or a screenshot) can enumerate customers and payment amounts **across all Atai founders**, because every founder's revenue settles in the same Dodo account (BUSINESS-DATA audit §8). Fix shape: server-side `_ataiProjectId` metadata filtering for project-context keys; drop `payments` from provisioned scopes or split into a read-own-scope; move payouts behind admin-only surface.

**S-02 (P0): deleted projects leave valid credentials and a live app.** Keys stay usable after project deletion (`lib/runtime/auth/authenticate.ts:135-195` has no project-liveness check; no `revokeApiKey` call site on delete — grep VERIFIED), and the Totalum project is never deleted (`app/api/projects/[id]/route.ts:267-284`). Consequence: zombie apps retain AI/payments scopes and keep charging their owner's credits; a "deleted" app remains publicly reachable. Fix shape in BUSINESS-DATA audit D-01.

**S-03 (P1): manual dashboard keys default to all capabilities.** `scopeCovers` treats an empty scope list as everything (`lib/runtime/auth/authorize.ts:29-32`), and dotted sub-namespaces mean a parent scope covers every sub-operation. The provisioning path explicitly avoids empty scopes (comment at `service.ts:86-89`), but nothing stops a dashboard key from being created that way. INFERRED risk: convenience default + human error = over-scoped keys. Fix shape: require explicit scopes for new manual keys; keep empty=all only as legacy.

---

## 6. Prompt injection — VERIFIED, defense in depth

The strongest area relative to product stage:

- Website evidence is fenced as `<untrusted_website_evidence>` with a compact digest (never raw HTML) (`lib/analysis/understanding.ts:8-9,146`).
- Specification and plan prompts repeat the untrusted-data rule (`lib/analysis/specification.ts:111`).
- The co-founder system prompt mandates CONTENT-IS-DATA, authoritative tool results, and reporting suspicious content (`lib/cofounder/prompts.ts:10-13`).
- Studio/SEO recommendation prompts fence external findings identically (`lib/marketing/seo/recommendations.ts:105-115`, `lib/marketing/studio/refine.ts:65`).
- Provider-name enforcement (`lib/analysis/runtime-capabilities.ts:136`) plus a regex audit for leaked external-provider naming (`:330`) — this also constrains what injected content can make plans claim.
- The build handoff applies an injection-shaped-phrase neutralizer to plan content (`lib/analysis/prompt-builder.ts:165`).

INFERRED residual risk: fences are prompt-level, not structural. The co-founder's write tools are confirmation-gated (good), but its READ tools will summarize injected content as if it were founder context — acceptable, since reads are owner-scoped and non-mutating.

---

## 7. Input handling & XSS — VERIFIED strong

- Image uploads: 5MB hard cap enforced at the stream level before buffering, single-file form requirement, 180-char name cap, then sharp validation with format allow-list (png/jpeg/webp/gif), 25MP pixel cap, animated-page cap, full re-encode stripping metadata and trailing payloads (`lib/imagekit/validate-image.ts:8-71`), AI-lease concurrency slot (`app/api/projects/[id]/assets/route.ts:16`), 20/min rate limit (`:15`).
- Markdown rendering: `react-markdown` + `remark-gfm` without `rehype-raw` — raw HTML in AI output or plan text cannot execute (`components/cofounder/markdown.tsx:1-6`); links get `rel="noreferrer"` (`:40-46`); react-markdown's default URL transform blocks `javascript:` hrefs.
- `dangerouslySetInnerHTML` occurrences are all static code constants (structured-data JSON-LD at `app/layout.tsx:191`; option labels defined in the same file at `components/project-preferences-dialog.tsx:176-213`), not user content — VERIFIED by reading both sites.
- Zod validation at every runtime adapter boundary (`mapper.ts` schemas throughout) and route-body validation in sampled routes.

---

## 8. Abuse surfaces & rate-limit coverage — VERIFIED, partially mitigated

**S-04 (P1): 126 of 173 API routes have no per-route rate limit** (computed by diffing `find app/api -name route.ts` against routes importing `checkRateLimit`; list retained in the audit working notes). The uncovered set includes the expensive AI routes: `analyze-plan`, `auto-complete`, `plan-chat`, `generate-visual`, `capture-preview`, `resources/*`, `market/*` kits, plus the Totalum database CRUD proxies and status-poll routes.

Mitigations that exist (VERIFIED): nearly all AI routes charge credits first (plan analysis 10, chat 2, auto-complete 8 credits by default — `lib/billing/runtime-config.ts:16-30`), concurrency is capped by per-user AI leases (`lib/api/ai-lease.ts`), and the runtime gateway has its own platform caps. Residual risk: the founder's own credits bound their abuse of AI routes, but a script polling status/database/studio routes contributes unbounded load, and 2-credit chat messages at scale are cheap compute on Atai's OpenRouter bill. Fix shape: a cheap default per-user limiter in middleware with per-route exemptions, rather than sprinkling `checkRateLimit` everywhere.

**S-05 (P1): no production error tracking or uptime monitoring.** Logging is stdout JSON with redaction (`lib/logging/logger.ts:60-66`); grep found no Sentry/OTel integration; the privacy page mentions Vercel Analytics + PostHog (`app/privacy/page.tsx:473`) for product analytics, not error monitoring. Incidents surface via user reports. UNVERIFIED whether the hosting platform adds log drains.

**S-06 (P2): webhook replay protection is correct but its recovery loop is manual** (covered in R-02; security angle: unprocessed financial events are also unmonitored ones).

---

## 9. Reliability engineering — what exists and what doesn't

VERIFIED strengths:
- **Concurrency control:** single-flight wrappers (`lib/cache/single-flight.ts`), per-user AI leases with expiry recovery (`lib/api/ai-lease.ts`), atomic build-slot claims (`store.claimBuildSlot`), atomic pending-action claims (`pending-actions.ts:77-97`), Mongo transactions for multi-document invariants (`mongo-store.ts:541-566`, `password-reset.ts:45`).
- **Stall recovery:** pipeline runs detect death-without-report and auto-restart within a cap, surfaced in `projects.pipelineRecovery` (`lib/types/project.ts:81-90`); build recovery on return via `lastPolledAt` (`:255-258`); ambiguous-launch reconciliation polls Totalum before refunding (`lib/analysis/pipeline.ts` reconcile path — keep per project memory).
- **Idempotency everywhere money moves** (runtime `runtime_<requestId>`, grants `payment_…/refund_…/sub_grant_…`, topups).

VERIFIED gaps:
- **No scheduler/queue/worker of any kind** — recovery, rollups, retention beyond Mongo TTL, digest emails, anything time-based simply cannot happen (`webhook-recovery.ts:41`).
- **Long operations in-request** (240s agent cap `lib/cofounder/agent.ts:14`; 60s Totalum calls) — serverless timeout exposure.
- **No CI in the repository.** CI configuration was deliberately deleted with `.github/` during the git re-attachment (project memory; VERIFIED absent on disk), and the test suite is gitignored (`**/*.test.ts`, `__tests__/` in `.gitignore`), so a clean clone ships with zero tests and nothing runs them. Locally ~203 test files / ~2,400 cases existed and passed as of 2026-11-08 (project memory — UNVERIFIED at audit time; suite not re-run). This is the largest reliability regression risk: nothing prevents a commit that breaks the build or the ledger from deploying.
- **No backup/restore tooling in-repo**; MongoDB provider-side backups UNVERIFIED.
- **Single-region, single-process architecture assumptions** (in-process caches keyed `proj:…`/`projs:…`, `mongo-store.ts:562-565`) — a second instance would serve stale reads after writes from the first. Fine at current scale; a scaling landmine.

---

## 10. Findings register

| ID | Sev | Finding | Fix owner |
|---|---|---|---|
| S-01 | P0 | Provisioned `payments` scope + account-wide Dodo reads = cross-tenant financial read | Runtime contracts + Dodo adapter |
| S-02 | P0 | Deletion leaves valid keys + live Totalum app | Deletion transaction (D-01) |
| S-03 | P1 | Empty-scope manual keys = all capabilities; dot-subsumption widens further | Key service validation |
| S-04 | P1 | 126/173 routes unthrottled incl. AI-cost surfaces | Shared middleware limiter |
| S-05 | P1 | No error tracking/uptime alerting | Ops tooling |
| S-06 | P2 | Manual-only webhook recovery (no heartbeat) | Scheduler (R-02) |
| S-07 | P2 | No CI; tests gitignored | Repo hygiene |
| S-08 | P2 | In-process cache invalidation assumes one instance | Defer to scaling |
| S-09 | P2 | Backup/RPO/RTO unverified | Ops confirmation |
| S-10 | P3 | Soft client-side verify gate (`auth-panel.tsx:342`) | UI fix |
| S-11 | P3 | SameSite=lax only; no CSRF tokens (JSON APIs mitigate) | Acceptable; document |
| S-12 | P3 | Admin routes rely on requireAdmin without rate limits | Bundle with S-04 |

---

## 11. Explicit strengths (verified, worth preserving)

1. Webhook pipeline: verify-first → persist → idempotent-process → replay through identical logic (`app/api/billing/webhook/route.ts:82-170`, `webhook-recovery.ts:20-46`).
2. Runtime key cryptography and one-time display (`key-crypto.ts`).
3. Log redaction of secret-shaped values by shape as well as name (`logger.ts:5-58`).
4. Ownership filtering on every sampled route, atomic on delete.
5. Upload hardening (stream-capped, re-encoded, metadata-stripped).
6. Prompt-injection fencing applied consistently across five AI surfaces.
7. Pending-action atomicity making double-approval impossible.

The security posture is well above what the product's stage requires — with exactly one exception: **the runtime key ↔ payments ↔ commingled Dodo account triangle (S-01) is a genuine cross-tenant financial exposure and should be treated as the top security priority, ahead of anything in this document.**
