# Settings Section — Full Audit

**Date:** 2026-11-15
**Scope:** `/settings` and all sub-pages, every component they render, every API route they call, and every datastore touched.
**Shell:** All settings pages render inside `DashboardShell` (`components/dashboard/dashboard-shell.tsx`) — sidebar nav, sticky header (title, business search, Ask-co-founder, notifications, credit meter, theme toggle, account menu, verify-email banner), `CofounderPanel`, and `AuthGate`.

---

## 1. Route Inventory

| Route | File | Type | Auth | Shell title |
|---|---|---|---|---|
| `/settings` | `app/settings/page.tsx` | Server | `getCurrentUser()` → redirect `/login?next=%2Fsettings` | Settings |
| `/settings/profile` | `app/settings/profile/page.tsx` | Client | `useSession()` → `router.replace("/login?next=%2Fsettings%2Fprofile")` | Profile |
| `/settings/security` | `app/settings/security/page.tsx` | Client | `AuthGate` via shell; reads `useSession()` | Security |
| `/settings/appearance` | `app/settings/appearance/page.tsx` | Client | `useSession()` redirect | Appearance |
| `/settings/billing` | `app/settings/billing/page.tsx` | Client | `useSession()` redirect | Billing |
| `/settings/ai` | `app/settings/ai/page.tsx` | Server | `getCurrentUser()` → redirect | AI co-founder |
| `/settings/features` | `app/settings/features/page.tsx` | Server | `getCurrentUser()` → redirect | Feature switches |
| `/settings/feedback` | `app/settings/feedback/page.tsx` | Client | `AuthGate` via shell only | Feedback & privacy |

**Not in settings but adjacent:** `/confirm-email-change` (token landing page for email changes), `/forgot-password`, `/reset-password`.

---

## 2. Per-Page Detail

### 2.1 `/settings` — index (server component)

**Data fetched server-side:**
- `getCurrentUser()` — session user (`lib/auth/session`)
- `getBalance(user.id)` — credit balance (`lib/credits/credits`)

**Renders:**
- Profile card: name, email, auth provider label, links → `/settings/profile`, `/settings/security`, `/settings/appearance`
- Credits card: balance, links → `/settings/billing`
- AI co-founder card → `/settings/ai`
- Feature switches card → `/settings/features`
- Admin-only section (`user.isAdmin`): links to `/admin`, `/admin/payments`, `/admin/users`, `/admin/transactions`, plus `<AdminSelfCredit />`
- WhatsApp channel promo banner (external link)

**Client mutations from this page:** none directly. `AdminSelfCredit` POSTs `/api/admin/self-credits`.

### 2.2 `/settings/profile`

**Hooks/data:**
- `useSession()` → `/api/me` (shared client store, deduplicated)
- SWR `GET /api/credits/balance` — **BROKEN: this route does not exist** (see Findings §7.1). Balance silently renders `0`.

**Components:**
- `ProfileAvatarUpload` — click/drag image upload → `POST /api/me/avatar` (multipart `file`, ≤5 MB client-side check, `image/*` only). On success `router.refresh()`.
- `ProfileAvatarUpload` internals: local object-URL preview, spinner overlay, initials fallback.

**Displayed data:** avatar, name, verified badge, email, auth provider, member-since date, account details `<dl>` (name, email, email status, sign-in method, created date, credits), connected services (GitHub connect via `/api/auth/github?next=/settings/profile` when `user.githubConnected` is false; Google shown as "Soon" for password users), quick links to security/billing/appearance.

**Missing UI:** `PATCH /api/me/profile` (display-name update) exists but **no form on this page calls it** — name is read-only here (Finding §7.2).

### 2.3 `/settings/security`

**Hooks/data:**
- `useSession()` → `/api/me`
- SWR `GET /api/auth/sessions` → `{ sessions: SessionItem[] }` (`id`, `userAgent`, `createdAt`, `expiresAt`, `isCurrent`)

**Sections & mutations:**

| Section | Action | Endpoint |
|---|---|---|
| Sign-in security | Info only; "Forgot password?" link for password users | — |
| Email address | `POST /api/auth/change-email { newEmail }` → sends confirmation link to **new** address (1h token, `email_change` purpose) | success → inline "Confirmation sent" panel |
| Change password (password-auth users only, `authProvider === "password"`) | `POST /api/auth/change-password { currentPassword, newPassword }` | client validates ≥8 chars, match, different |
| Active sessions | `DELETE /api/auth/sessions` ("Revoke all others") | ⚠️ deletes **all** sessions incl. current — see §7.3 |
| Danger zone | `POST /api/auth/logout` → `window.location.href = "/login"` | server sets `Clear-Site-Data: "cache", "cookies"` |

**Session row rendering:** parses `userAgent` into device (Desktop/Mobile/Tablet) + browser (Chrome/Firefox/Safari/Edge); `isCurrent` badge; "Last active" actually shows `createdAt` (mislabeled — it is sign-in time, not last-active).

### 2.4 `/settings/appearance`

**Hooks/data:**
- `useSession()` redirect guard
- `useTheme()` from `components/theme-provider.tsx`

**Themes:** `system | dark | light | light-blue | glass` — picker grid with live `ThemePreview` swatches, active check badge, per-theme info card (glass perf note, system note).

**Persistence (two layers):**
- `localStorage["atai:theme"]` — instant, FOUC-safe init script in `app/layout.tsx`
- `PATCH /api/user/theme` via shared store (`useAccountTheme`, `lib/store/client-store.ts`) — DB wins over localStorage after fetch; optimistic local update

### 2.5 `/settings/billing` (largest page)

**Hooks/data:**
- `useSession()` redirect guard
- SWR `GET /api/billing/overview` → `BillingOverview`:
  - `balance { total, subscription, permanent }`
  - `history[]` — last 50 signed credit-ledger entries (`id`, `reason`, `creditType`, `createdAt`, `amount`)
  - `subscription { planId, planName, status, currentPeriodEnd, cancelAtPeriodEnd } | null`
  - `usageAlerts { creditsNearLimit, creditsAtLimit, creditUsageRatio, businessCapReached, businessCapNear, warnings[] }`
  - `plans` — commercial catalog from server (`getCommercialPlans()`)
  - `activeCommercialPlanId`, `businessCount`
- `<BillingCheckoutReturn />` — reads `?subscription_id` search param → `applyCheckoutReturn()` (`lib/billing/checkout-return-client`) → syncs with `/api/billing/sync` then `router.replace("/start")` or back to `/settings/billing`

**Sections:**
1. **Credit balance card** — total + subscription/permanent split, expiry explanation.
2. **Usage alerts** — advisory warnings list + usage-ratio progress bar (red ≥100%, amber ≥80%).
3. **Current plan card** — plan name, "Active" badge, price/credits, period end, `<CancelSubscriptionButton>` when not already cancelling, amber notice when `cancelAtPeriodEnd`.
4. **How credits work** — static explainer (subscription first → permanent second → 500 free on verification).
5. **Subscription plans** — grid of non-custom commercial plans via `<PlanCard>` (props: plan, activePlanId, currentPeriodEnd, allPlans, currentBusinesses).
6. **Buy permanent credits** — `PERMANENT_CREDIT_PACKS` grid, each with `<CheckoutButton type="permanent" productId={pack.id}>`.
7. **Credit history** — desktop table / mobile list of ledger entries.

**Checkout flow:** `CheckoutButton` → `POST /api/billing/checkout { type, productId, billingCycle?, returnPath? }` → returns `checkoutUrl` (Dodo hosted checkout) → `window.location.href` redirect. Webhook (`/api/billing/webhook`) grants credits async.

**Cancel flow:** `CancelSubscriptionButton` — 4-step modal (retention pitch → reason radio list → optional discount step → processing):
- `POST /api/billing/subscription/cancel-feedback { reason, feedback, planName }` → Mongo `cancellation_feedback` collection
- `POST /api/billing/subscription/cancel` → Dodo `subscriptions.update(cancel_at_next_billing_date: true)` + local `subscription_records.cancelAtPeriodEnd = true`
- ⚠️ Hardcoded `DISCOUNT_CODE = "9W1JK59M0JSL"` shipped in client bundle for reason `too_expensive` ("15% OFF next renewal") — verify this code is actually valid in Dodo before shipping (§7.4).
- "Switch to a Smaller Plan" just routes to `/settings/billing#plans` — no in-place plan-change API is called (downgrade path may be manual/via new checkout).

### 2.6 `/settings/ai` (server)

**Data:** `getCurrentUser()`; `listCofounderTiers()` (admin-managed catalog, `lib/cofounder/model-catalog`); `readCofounderModelTier(user.id)` (user doc); `COFOUNDER_MODEL_TIER` env pin.

**Component:** `AiModelPicker` — tier cards (name, Free/credits-per-message badge, strength, raw `modelId` for transparency). `PATCH /api/settings/ai-model { tier }` on click, optimistic with revert on error. Env pin disables picker with explanation.

### 2.7 `/settings/features` (server)

**Data:** `getCurrentUser()`; `user.featurePreferences`; per-feature env-block checks (`isSeoAuditEnvBlocked`, `isGrowthTasksEnvBlocked`, `isCampaignsEnvBlocked`, `isLessonsEnvBlocked`); affordability costs via `getSeoAuditAffordability`, `getLessonsPackAffordability`.

**Toggles:** `seoAudit`, `growthTasks`, `campaigns`, `lessons` — each with title/description/cost note/blocked note.

**Component:** `FeatureToggles` — optimistic switch flips → `PATCH /api/settings/features { [key]: bool }` → response `enabled` map reconciles state; revert + error banner on failure.

### 2.8 `/settings/feedback`

**Data:** `loadPrivacyPrefs()` — localStorage-backed `FeedbackPrivacyPrefs` (`lib/feedback/privacy`): `launcherEnabled`, `collectPage`, `collectDevice`, `collectErrors`, `autoScreenshot`.

**Renders:** checkbox list bound to local prefs (no server persistence), explanatory copy, link to `/contributions`. The feedback launcher itself is `components/feedback/atai-feedback-launcher.tsx` (excluded route `/settings/feedback` from auto-mount? — it excludes `/verify-email`, `/public/`, etc.).

---

## 3. API Endpoint Inventory

### Called by settings UI

| Endpoint | Method | Auth | Purpose | Body / Response |
|---|---|---|---|---|
| `/api/me` | GET | session | Shared session store: user, credits `{balance, reserved, available, allowance}`, last 30 transactions, provider flags | `useSession()` everywhere; single-flight + `private, no-cache` |
| `/api/me/profile` | PATCH | `requireUser` | Update display name (1–80 chars) | `{ name }` → `{ name }`. **No UI caller found** |
| `/api/me/avatar` | POST | `requireUser` + rate limit `image_upload` 20/min + AI lease | Multipart image → ImageKit `/Atai/avatars` → `project_assets` + `provider_usage` rows + `users.imageUrl` | FormData `file` → `{ imageUrl }` |
| `/api/auth/sessions` | GET | `requireUser` | List session docs for user | `{ sessions[] }` |
| `/api/auth/sessions` | DELETE | `requireUser` | `deleteMany({userId})` — **all** sessions | `{ message }` |
| `/api/auth/change-password` | POST | `requireUser` + ingress `change_password` + rate limit 5/hr | Verify current pw (password users), strength check, `hashPassword`, `setPasswordHash`, **destroy all sessions + create fresh one** | `{ currentPassword, newPassword }` |
| `/api/auth/change-email` | POST | `requireUser` + ingress `change_email` + rate limit 3/hr | Normalize, uniqueness check, delete prior `email_change` tokens, insert 1h `verification_tokens` doc, SMTP send to **new** email via `emailChangeEmail` template → `/confirm-email-change?token=` | `{ newEmail }` → `{ sent, reason? }` |
| `/api/auth/confirm-email-change` | POST | token | Consumes `email_change` token (used by `/confirm-email-change` page, not settings directly) | `{ token }` |
| `/api/auth/logout` | POST | session | `destroyCurrentSession()` + `Clear-Site-Data` header | — |
| `/api/auth/github` | GET | — | OAuth start; `?next=` return path; sets state + referral cookies | redirect to GitHub |
| `/api/user/theme` | GET/PATCH | session | Theme preference persistence | `{ theme }` |
| `/api/settings/ai-model` | GET/PATCH | `requireUser` | Read/write co-founder engine tier on user doc; PATCH validates against live `getCofounderTier` catalog | `{ tier }` |
| `/api/settings/features` | PATCH | `requireUser` | Merge `featurePreferences`; refuses (409) when env kill-switch blocks | `{ seoAudit?, growthTasks?, campaigns?, lessons? }` → `{ preferences, enabled }` |
| `/api/billing/overview` | GET | `requireUser` | Balance split, 50-entry history, active subscription, usage alerts, commercial plans, business count | see §2.5 |
| `/api/billing/checkout` | POST | `getCurrentUser` + per-user/product rate limit + session lock | Dodo checkout session (subscription = commercial catalog only; permanent = `PERMANENT_CREDIT_PACKS`); auto-provisions products; country→currency detection | `{ type, productId, billingCycle?, returnPath? }` → `{ checkoutUrl, sessionId }` |
| `/api/billing/subscription/cancel` | POST | `getCurrentUser` | Finds `active|trialing` sub → Dodo `cancel_at_next_billing_date` → sets `cancelAtPeriodEnd` | `{ success, periodEnd }` |
| `/api/billing/subscription/cancel-feedback` | POST | `getCurrentUser` | Inserts into `cancellation_feedback` collection | `{ reason, feedback?, planName }` |
| `/api/billing/sync` | (called by checkout-return flow) | session | Reconciles Dodo state after redirect return | — |
| `/api/admin/self-credits` | POST | `requireAdmin` | `grantCredits` permanent/admin_adjustment, ≤1,000,000 | `{ amount }` → `{ message, newBalance }` |
| `/api/credits/balance` | GET | — | **DOES NOT EXIST** — called by profile page | 404 (Finding §7.1) |
| `/api/auth/github/status` | GET | — | **DOES NOT EXIST** — called by `/new/github` (not settings) | 404 (Finding §7.5) |

### Billing-adjacent routes that exist but are NOT called by settings UI
`/api/billing/upgrade-options` (used by `credit-gate-dialog`), `/api/billing/top-up/*` + `/api/billing/admin/top-ups/*` (legacy Mobile Money — read-only/admin), `/api/billing/webhook` (Dodo inbound), `/api/billing/subscription/cancel-feedback` (called), `/api/internal/credits`.

---

## 4. Data Stores Touched

| Store | Collections / keys | Written by |
|---|---|---|
| MongoDB | `users` — `name`, `imageUrl`, `imageFileId`, `featurePreferences`, co-founder tier field, `credits` | profile PATCH, avatar, features PATCH, ai-model PATCH, self-credits |
| MongoDB | `sessions` — session docs per user | login/session create; change-password destroys all; sessions DELETE removes all |
| MongoDB | `verification_tokens` — `purpose: "email_change"`, `tokenHash`, `metadata.newEmail`, 1h expiry | change-email; consumed by confirm-email-change |
| MongoDB | `subscription_records` — `status`, `planId`, `planName`, `mirrorCredits`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `dodoSubscriptionId`, `commercialPlanId` | checkout webhook, cancel, overview reads |
| MongoDB | credit ledger via `lib/billing/credit-service` (`grantCredits`, `getBalance`, `getCreditHistory`) | checkout webhook, self-credits, consumption elsewhere |
| MongoDB | `cancellation_feedback` — userId/email/name, planName, reason, feedback, timestamps | cancel-feedback |
| MongoDB | `provider_usage` — imagekit avatar_upload success/fail rows | avatar upload |
| MongoDB | `project_assets` — `kind: "avatar"` asset rows | avatar upload |
| MongoDB | co-founder tier catalog (admin-managed, `listCofounderTiers`) | read by ai page; written by admin surfaces |
| Browser | `localStorage["atai:theme"]`, `localStorage["atai.sidebar"]` (new), privacy prefs (`lib/feedback/privacy`) | theme, sidebar, feedback |
| Cookies | session cookie, `Atai_github_oauth_state`, `Atai_referral` | auth flows |
| External | Dodo Payments (checkout sessions, subscription cancel), ImageKit (avatar hosting), SMTP (emails), GitHub OAuth | billing/avatar/email/profile |

---

## 5. Client-Side State & Side Effects

- `useSession()` is a **shared store** (`lib/store/client-store.ts`): one `/api/me` fetch per session, 5-min background revalidation, deduplicated across all consumers.
- SWR keys used on settings pages: `/api/auth/sessions`, `/api/billing/overview`, `/api/credits/balance` (broken).
- `BillingCheckoutReturn` consumes `?subscription_id` once (ref-guarded) then strips the param via `router.replace`.
- `AiModelPicker` / `FeatureToggles` are optimistic with server-reconcile/revert.
- All settings pages render inside `AuthGate` (DashboardShell) — unauthenticated users are redirected with `next=<pathname>`.

---

## 6. Security Observations (positive)

- Every settings API route requires `requireUser()`/`requireAdmin()`; inputs zod-validated (`settings/*`) or manually bounded (auth routes).
- Rate limits: password change 5/hr, email change 3/hr, avatar upload 20/min + AI lease, checkout per-user/product limiter + session lock.
- Password change revokes all sessions then issues a fresh one; logout sends `Clear-Site-Data`.
- Email-change tokens are hashed at rest, single-purpose, 1h TTL, prior pending tokens deleted.
- Checkout refuses legacy plan ids, custom contracts, free plans, and unavailable annual cycles; currency resolved server-side.
- Cancel routes verify active subscription server-side; feedback endpoint is write-only.
- `/api/me` sends `private, no-cache, must-revalidate` to prevent session bleed.

---

## 7. Findings

### 7.1 BUG — `/api/credits/balance` does not exist (P2)
`app/settings/profile/page.tsx:49` SWR-fetches `/api/credits/balance`, but only `app/api/credits/route.ts` (`GET /api/credits`) exists. The request 404s; `balanceData?.data?.balance ?? 0` silently renders **0 credits** in Account details. Fix: point at `/api/credits` (`{ balance, transactions }`) or `/api/me` (`credits.balance`).

### 7.2 GAP — display-name edit endpoint has no UI (P3)
`PATCH /api/me/profile` updates `users.name` but nothing in settings calls it; profile name is read-only. Either add an edit affordance or remove the route.

### 7.3 BUG — "Revoke all others" revokes ALL sessions incl. current (P1)
`DELETE /api/auth/sessions` runs `deleteMany({ userId })` — the current session doc is deleted too, so the next request is unauthenticated (effective logout), contradicting the button label and its own comment. `isCurrent` is also only a heuristic (most-recent-first guess), so the UI can't reliably exclude "current" anyway. Fix: identify the current session by token hash (available in `requireUser` context) and delete all *except* it.

### 7.4 RISK — hardcoded discount code in client bundle (P2)
`DISCOUNT_CODE = "9W1JK59M0JSL"` in `cancel-subscription-button.tsx` promises "15% OFF next renewal" for `too_expensive` cancellations. If the code isn't a live Dodo discount, users will hit a dead end at renewal; it's also extractable by anyone. Verify validity or gate it server-side.

### 7.5 BUG — `/api/auth/github/status` does not exist (P2, adjacent page)
`app/new/github/page.tsx:35` SWR-fetches it; no such route (only `/api/auth/github` GET=OAuth start). `hasGitHub` always resolves false → private-repo upsell shows even for connected users. Profile page correctly uses `session.user.githubConnected` instead — same fix applies here.

### 7.6 MINOR — session list accuracy
`sessions` GET labels `sessions[0]` (most recent) as `isCurrent` and shows `createdAt` as "Last active". Both are approximations; consider storing `lastSeenAt` and the current session's token hash for exactness.

### 7.7 MINOR — no per-session revoke
Users can only revoke *all* sessions; individual session revocation isn't exposed (would pair naturally with §7.3 fix).

### 7.8 NOTE — legacy top-up surface
`/api/billing/top-up/*` and `/api/billing/admin/top-ups/*` are legacy Mobile Money flows (admin read-only; `verify` is a 410 stub). Not linked from settings — confirmed dead-end-free, but worth keeping out of any future settings nav.

### 7.9 NOTE — inconsistent auth guards
Server pages use `getCurrentUser()` + `redirect()`; client pages use `useSession()` + `router.replace()` (returns `null` while loading, so no flash). Both are correct, but the client pattern double-gates with the shell's `AuthGate` — harmless redundancy.

---

## 8. File Index

**Pages:** `app/settings/{page,profile/page,security/page,appearance/page,billing/page,ai/page,features/page,feedback/page}.tsx`

**Components:** `components/dashboard/dashboard-shell.tsx`, `components/auth/auth-gate.tsx`, `components/account-menu.tsx`, `components/credit-meter.tsx`, `components/verify-email-banner.tsx`, `components/theme-toggle.tsx`, `components/theme-provider.tsx`, `components/profile-avatar-upload.tsx`, `components/admin-self-credit.tsx`, `components/settings/{ai-model-picker,feature-toggles}.tsx`, `components/billing/{checkout-button,plan-card,cancel-subscription-button,billing-checkout-return,credit-gate-dialog}.tsx`, `components/feedback/atai-feedback-launcher.tsx`, `lib/feedback/privacy.ts`

**API routes:** `app/api/me/{route,profile/route,avatar/route,ads/requests/route}.ts`, `app/api/credits/route.ts`, `app/api/user/theme/route.ts`, `app/api/auth/{sessions,change-password,change-email,confirm-email-change,logout,github}/route.ts`, `app/api/settings/{ai-model,features}/route.ts`, `app/api/billing/{overview,checkout,sync,upgrade-options,webhook}/route.ts`, `app/api/billing/subscription/{cancel,cancel-feedback}/route.ts`, `app/api/admin/self-credits/route.ts`

**Libs:** `lib/auth/session.ts`, `lib/auth/users.ts`, `lib/auth/crypto.ts`, `lib/auth/rate-limit.ts`, `lib/auth/request-limit.ts`, `lib/credits/credits.ts`, `lib/billing/{credit-service,config,dodo-service,checkout-return,checkout-return-client,entitlements/*,upgrade-options}.ts`, `lib/cofounder/{model,model-catalog}.ts`, `lib/marketing/feature-flags.ts`, `lib/marketing/feature-preferences.ts`, `lib/marketing/seo/credits.ts`, `lib/lessons/credits.ts`, `lib/imagekit/{upload,validate-image}.ts`, `lib/client/api.ts`, `lib/store/client-store.ts`, `lib/email/{mailer,templates}.ts`

**External:** Dodo Payments API, ImageKit, SMTP, GitHub OAuth, MongoDB.
EOF
'@ | Out-Null; echo done' 2>$null; echo "written"