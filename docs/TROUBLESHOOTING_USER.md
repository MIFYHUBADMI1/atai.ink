# Troubleshooting & error reference

A single, searchable reference for every common Atai problem: the exact symptom, the cause, and the fix — with the precise page or endpoint to use. If you're stuck, this is the first place to look. For the end‑to‑end walkthrough, see the [onboarding guide](https://atai.ink/docs/onboarding).

> Tip: most fixes need a specific URL. Bookmark [https://atai.ink/settings/billing](https://atai.ink/settings/billing) (the real billing page — `/billing` has no page) and your project workspace.

## Quick lookup

| I want to… | Go to |
|---|---|
| Verify my email | [https://atai.ink/verify-email](https://atai.ink/verify-email) |
| Reset my password | [https://atai.ink/forgot-password](https://atai.ink/forgot-password) → [https://atai.ink/reset-password](https://atai.ink/reset-password) |
| See billing / credits | [https://atai.ink/settings/billing](https://atai.ink/settings/billing) |
| Manage sessions / 2FA | [https://atai.ink/settings/security](https://atai.ink/settings/security) |
| Turn features on/off | [https://atai.ink/settings/features](https://atai.ink/settings/features) |
| Watch a build | [https://atai.ink/project/PROJECT_ID/progress](https://atai.ink/project/PROJECT_ID/progress) |
| Manage runtime keys | [https://atai.ink/project/PROJECT_ID/runtime/keys](https://atai.ink/project/PROJECT_ID/runtime/keys) |
| Contact support | [support@atai.ink](mailto:support@atai.ink) · +256761819885 · [WhatsApp community](https://chat.whatsapp.com/CB3zVz7UnsQLfDjjk04gt1) |

## Common problems

**Authentication & sign-in**

### "Invalid credentials" / cannot log in
- *Cause:* wrong password; email not verified; or the account was soft‑deleted.
- *Fix:* reset at [https://atai.ink/forgot-password](https://atai.ink/forgot-password) → open the emailed link → [https://atai.ink/reset-password](https://atai.ink/reset-password). If you never verified, see below. If removed, email [support@atai.ink](mailto:support@atai.ink). Or use **Sign in with Google** at [https://atai.ink/login](https://atai.ink/login).

### "Verify your email to unlock Atai" — account feels locked, no welcome credits
- *Cause:* the 500 welcome credits are granted **on email verification**, not on signup.
- *Fix:* open the verification link → [https://atai.ink/verify-email](https://atai.ink/verify-email). A persistent **Verify email banner** appears in the header with **Resend email** (calls `/api/auth/resend-verification`) and **I've verified**. Check spam/promotions, then hard‑refresh.

### Verification email never arrives
- *Fix:* click **Resend email** in the banner, wait a minute, check spam and promotions. Then [https://atai.ink/verify-email](https://atai.ink/verify-email). Still missing → [support@atai.ink](mailto:support@atai.ink). Admin causes: expired 24‑hour token or SMTP misconfiguration.

### "Session expired" / logged out repeatedly
- *Cause:* sessions last ~30 days; rotating the platform auth secret invalidates all sessions.
- *Fix:* sign in again at [https://atai.ink/login](https://atai.ink/login). Manage sessions at [https://atai.ink/settings/security](https://atai.ink/settings/security).

### Google OAuth shows `redirect_uri_mismatch` / `access_denied`
- *Cause:* server‑side OAuth config (registered redirect URI, or Google app in "Testing" without your email in test users).
- *Fix:* use email+password at [https://atai.ink/register](https://atai.ink/register) as a workaround; report to [support@atai.ink](mailto:support@atai.ink). Production callback is `https://atai.ink/api/auth/google/callback`.

### "Something went wrong" with no detail
- *Fix:* open DevTools → **Network** → find the failed request and read its response body; note the timestamp; email it to [support@atai.ink](mailto:support@atai.ink).

**Billing & credits**

### "Not enough credits" / "Insufficient credits" / Credit Gate dialog
- *Cause:* balance below the operation cost (a build costs 50,000–100,000 credits while Free grants only 500).
- *Fix:* check balance at [https://atai.ink/settings/billing](https://atai.ink/settings/billing) → **Buy Permanent Credits** or pick a subscription. Compare at [https://atai.ink/pricing](https://atai.ink/pricing). Earn free credits at [https://atai.ink/referrals](https://atai.ink/referrals). Use **Standard** (not **Pro**) for a first project, and refine the plan *before* building.

### Credits deducted but the operation failed
- *Cause:* the automatic refund path didn't execute (rare).
- *Fix:* check **Credit History** at [https://atai.ink/settings/billing](https://atai.ink/settings/billing). If a `build_reservation` has no matching `build_refund`, contact [support@atai.ink](mailto:support@atai.ink) with project id + timestamp.

### Payment succeeded but no credits appeared
- *Cause:* the Dodo webhook (`/api/billing/webhook`) wasn't received/processed, or UI shows a cached balance.
- *Fix:* ① hard‑refresh (Ctrl+Shift+R); ② return from checkout so `/api/billing/sync` runs with the `subscription_id`; ③ check **Credit History**; ④ email [support@atai.ink](mailto:support@atai.ink) with the receipt.

### UI shows credits but build says insufficient
- *Cause:* subscription credits expired, or cached `users.credits` is out of sync with the ledger.
- *Fix:* hard‑refresh; check history at [https://atai.ink/settings/billing](https://atai.ink/settings/billing); contact support.

### Need to cancel or change plan
- *Fix:* [https://atai.ink/settings/billing](https://atai.ink/settings/billing) → Subscription Plans → change or **Cancel subscription** (with feedback). Terms: [https://atai.ink/refund-policy](https://atai.ink/refund-policy).

**Analysis, plan & build**

### Project stuck on "Analyzing website" forever
- *Cause:* a Deep Crawl legitimately takes **up to 15 minutes**; or status polling stopped; or an unhandled exception after crawl.
- *Fix:* ① wait (deep crawls are slow by design); ② hard‑refresh; ③ open [https://atai.ink/project/PROJECT_ID/progress](https://atai.ink/project/PROJECT_ID/progress); ④ if state is `analysis_failed`, use **Retry understanding** from the Workspace.

### Plan won't generate / "Understand needs attention"
- *Cause:* the source site blocked crawling, or the idea text was too vague.
- *Fix:* retry with a clearer brief or a different source URL; use **Retry understanding** in the workspace.

### Build failed / "Build error"
- *Cause:* a transient generation error, or the plan was too large for the chosen tier.
- *Fix:* use **Retry** / **Recover** from the workspace; if it persists, switch **Standard → Pro** only if needed (costs more), or simplify the plan. Check [https://atai.ink/project/PROJECT_ID/progress](https://atai.ink/project/PROJECT_ID/progress).

### Edits after build cost a full build tier
- *Cause:* post‑build plan changes re‑run the build.
- *Fix:* refine the plan *before* building. After build, use the instruction bar / agent for small changes instead of a full replan.

**Publishing & domains**

### Published site shows a broken/old version
- *Cause:* CDN/cache, or you published an older build.
- *Fix:* hard‑refresh; re‑publish from the workspace; confirm the correct build is live.

### Custom domain won't verify (DNS)
- *Cause:* CNAME/records not propagated, or wrong target.
- *Fix:* set the exact DNS records shown on the hosting/domain page for your project, wait for propagation (can take minutes–hours), then click **Verify** again. Free subdomain (`*.totalum-project.com`) needs no DNS.

### "Coming soon" on a top‑level page
- *Cause:* `/market`, `/competition`, `/hosting` are placeholder pages by design.
- *Fix:* use the **project‑level** equivalent (e.g. [https://atai.ink/project/PROJECT_ID/market](https://atai.ink/project/PROJECT_ID/market)). Also check [https://atai.ink/settings/features](https://atai.ink/settings/features) — some tools are opt‑in/gated.

**Database**

### "Table not found" / 404 on the table URL
- *Cause:* wrong table slug, or table deleted.
- *Fix:* open [https://atai.ink/project/PROJECT_ID/database](https://atai.ink/project/PROJECT_ID/database) and click the table to get the correct slug.

### Cannot edit `_id` / `createdAt` / `updatedAt`
- *Cause:* system fields maintained by Atai.
- *Fix:* expected — add your own **Text** field for a business key.

### "Failed to save record"
- *Cause:* value violates the field type, or a required field is empty.
- *Fix:* check each field matches its type (Number/Date/JSON format). Re‑enter and save; if persistent, contact [support@atai.ink](mailto:support@atai.ink).

**Runtime API & keys**

### 401 "Unauthorized" calling the Runtime
- *Cause:* missing/malformed `Authorization: Bearer` header, or revoked key.
- *Fix:* confirm `ATAI_API_KEY` is set where the code runs; header is `Authorization: Bearer <key>`; key still exists at [https://atai.ink/developers/keys](https://atai.ink/developers/keys) or [https://atai.ink/project/PROJECT_ID/runtime/keys](https://atai.ink/project/PROJECT_ID/runtime/keys). Rotate if unsure.

### Key works locally but not in deployment
- *Cause:* the deployed environment lacks `ATAI_API_KEY`, or a dev key is used in production.
- *Fix:* add the variable in the host's secret store; use a production key.

### 429 rate limited
- *Cause:* exceeded the key's request/token limit.
- *Fix:* check [https://atai.ink/project/PROJECT_ID/runtime/limits](https://atai.ink/project/PROJECT_ID/runtime/limits); back off and retry; review plan at [https://atai.ink/pricing](https://atai.ink/pricing).

**GitHub**

### GitHub connection fails / repo push rejected
- *Cause:* missing repo permissions, or the connected account lacks write access.
- *Fix:* reconnect with the correct GitHub account and grant repo access; use the GitHub integration page in the project workspace.

**Growth features**

### A growth tool is greyed out / "Soon"
- *Cause:* operator kill switch or your [https://atai.ink/settings/features](https://atai.ink/settings/features) switch is off.
- *Fix:* enable in Settings → Features. If the toggle is locked, a kill switch is active and can't be overridden.

### SEO audit won't run
- *Cause:* `SEO_AUDIT_ENABLED` off, or project not published (no live URL).
- *Fix:* publish the project, enable SEO in Settings → Features, retry at [https://atai.ink/project/PROJECT_ID/seo](https://atai.ink/project/PROJECT_ID/seo).

**Still stuck?**

Email [support@atai.ink](mailto:support@atai.ink), WhatsApp **+256761819885**, or join the [Atai WhatsApp community](https://chat.whatsapp.com/CB3zVz7UnsQLfDjjk04gt1). Include your project id, the exact error text, and a timestamp — it lets support correlate with server logs fast.
