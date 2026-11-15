# 💳 Credit System

**Complete reference for how credits work, flow, and are charged**

---

## Overview

Atai bills users in **credits** — an internal currency. Users buy credits (or get them free/via subscription), then spend them on operations. This is intentional:

- Decouples pricing from API costs (we can adjust without changing user-facing prices)
- Allows flexible pricing tiers
- Enables subscriptions + one-time purchases together
- Common pattern in SaaS tools (like OpenAI tokens)

**Main file**: `lib/credits/credits.ts`  
**DB collection**: `credit_ledger` (every transaction recorded)  
**User balance**: Stored in `users.credits` (fast read) + `users.creditBuckets` (detailed)

---

## Credit Costs (Current)

### Analysis Operations

| Operation | Mode | Cost |
|-----------|------|------|
| Website Scrape (Smart Crawl) | Legacy | **5 credits** |
| Website Scrape (Smart Crawl) | Heavy | **100 credits** |
| Plan Generation | Legacy | **5 credits** |
| Plan Generation | Heavy | **100 credits** |
| Deep Crawl (full site) | Legacy | **500 credits** |
| Deep Crawl (full site) | Heavy | **1,000 credits** |

**So for a full deep crawl + plan in heavy mode**:
- Deep crawl: 1,000 credits
- (Plan is included in heavy mode cost)
- Total: **1,000 credits**

**For smart crawl (legacy)**:
- Scrape: 5 credits
- Plan: 5 credits
- Total: **10 credits**

### Build Operations (Tier-Based)

After analysis, building the actual code costs more and depends on complexity:

| Complexity | Legacy (Standard) Build | Heavy (Pro) Build |
|-----------|-------------|-------------|
| Simple    | 50,000 cr   | 100,000 cr  |
| Medium    | 75,000 cr   | 112,500 cr  |
| Complex   | 100,000 cr  | 133,333 cr  |

**These are the charged amounts.** They come from `getTierCost()` (`lib/credits/credits.ts`), which reads the admin-configurable build-tier costs (`BUILD_TIERS` in `lib/billing/config.ts`, overridable via `app_settings`). Heavy mode scales the base by the tier ratio (simple ×2, medium ×1.5, complex ×4/3, rounded).

> ⚠️ The `TIER_COSTS` (25k/50k/75k) and `HEAVY_TIER_COSTS` (50k/75k/100k) constants in `credits.ts` are **only the ratio denominators** for the heavy scale — they are **not** what users are charged. Displayed == charged: the pricing page and both build paths (manual route + pipeline) read the same `getTierCost` authority. Source of truth at runtime: `GET /api/credit-costs`.

**Complexity is auto-classified** by the system based on:
- Number of enabled features (×2 weight each)
- Number of data entities (×1 weight each)
- Number of integrations (×3 weight each — hardest to build)
- Number of core user flows (×1 each)
- Number of backend requirements (×1 each)

Score ≤ 6 = simple, ≤ 14 = medium, > 14 = complex

---

## Credit Types

### 1. Subscription Credits
- Granted monthly with a paid subscription plan
- **Expire at the end of the billing period**
- Consumed first (before permanent credits)

### 2. Permanent Credits
- Purchased as credit packs (one-time payment)
- **Never expire**
- Consumed after subscription credits are exhausted

### Consumption Order
```
User has:
  - 500 subscription credits (expire Jan 31)
  - 2,000 permanent credits (never expire)

User spends 300 credits:
  → 300 taken from subscription credits first
  → Subscription: 200 remaining
  → Permanent: 2,000 (untouched)

User spends 400 more credits:
  → 200 taken from subscription credits (now empty)
  → 200 taken from permanent credits
  → Subscription: 0
  → Permanent: 1,800 remaining
```

This is "oldest-first" or "use-it-or-lose-it" — subscription credits drain first so users don't waste their monthly allocation.

### Expiry mechanics

Subscription credits are held as buckets in `users.creditBuckets[]`, each with `expiresAt` set to the billing period end (`grantSubscriptionCredits`). Permanent credits live in the flat `permanentCredits` field and have no expiry.

Expiry happens in three places, so a stale grant can never survive a period:

1. **On every balance read and every consumption** — `expireOverdueBuckets` (`lib/billing/credit-service.ts`) removes buckets whose `expiresAt` has passed, ledgering each removal. It is the single authority for balance mutation.
2. **On the monthly grant** — `grantSubscriptionCredits` reads the balance before writing the new bucket, and that read sweeps overdue buckets first; the new bucket is written with a fresh `expiresAt`, so the grant and the expiry of the previous period cannot drift apart.
3. **Daily sweep** — `POST /api/admin/billing/credits/expire-sweep` (scheduled in `vercel.json`) expires overdue buckets for accounts that never log in after their period ends.

The grant itself is idempotent per subscription per period: the ledger key is `sub_grant_<subscriptionId>_period_<periodEndDay>`, so a duplicated `subscription.active` / `subscription.renewed` event cannot double-credit a period.

---

## The Credit Flow Pattern

Every operation that costs credits follows this exact pattern:

```
1. RESERVE  → Deduct credits atomically BEFORE the operation starts
2. EXECUTE  → Run the actual operation (crawl, AI call, etc.)
3. CHARGE   → Confirm the charge (already deducted in step 1)
   OR
   REFUND   → Return credits if operation failed
```

### Why Reserve First?

If you check the balance and then deduct, two concurrent requests can both pass the balance check with the same balance and both succeed — even if the user only has enough for one. This is a **race condition**.

The reservation is **atomic** — it checks AND deducts in a single database operation. Only one can succeed if credits are tight.

```typescript
// From credits.ts
export async function reserveCredits(
  userId: string, 
  amount: number, 
  buildRunId: string, 
  reason: string
): Promise<boolean> {
  // Single atomic DB operation — no race condition possible
  const reserved = await store.reserveCreditsAtomic(userId, amount, {
    id: cryptoId(),
    userId,
    type: "reserve",
    amount: -amount,
    reason,
    buildRunId,
    createdAt: Date.now(),
  })
  if (!reserved) return false  // Not enough credits
  return true
}
```

### Reconciliation

For operations where actual cost might differ from estimated (like AI token usage), there's a reconcile function:

```typescript
// If actual cost < reserved → refund the difference
// If actual cost > reserved → charge the extra
await reconcileCredits(userId, reserved, actual, buildRunId)
```

---

## Credit Transaction Types

At the store flow level, every credit movement is one of:

| Type | Meaning |
|------|---------|
| `grant` | Credits added (signup bonus, subscription renewal, admin gift) |
| `reserve` | Credits held before an operation (temporary hold) |
| `consume` | Credits charged for a completed operation |
| `refund` | Credits returned (operation failed, or partial refund) |

The persisted `credit_ledger` entries carry a richer, typed vocabulary (`LedgerTransactionType` in `lib/billing/config.ts`) for auditability — e.g. `signup_bonus`, `referral_bonus`, `credit_purchase`, `subscription_grant`, `subscription_renewal`, `build_reservation`, `build_finalization`, `build_release`, `build_refund`, `fork_purchase`, `fork_royalty`, `ai_collaboration`, `infrastructure_purchase`, `admin_adjustment`, and the runtime types (`runtime_usage`, `runtime_reservation`, `runtime_refund`). Treat transaction types as an open vocabulary.

---

## Admin Credit Operations

Admins can:
- **Grant credits** to any user (free credits, compensation, etc.)
- **Deduct credits** from any user (abuse, correction)
- **View credit history** for any user
- **View full ledger** across all users

**Admin panel**: `/admin/billing` and `/admin/ledger`

---

## Subscription Plans (Current Pricing)

Billing provider is **Dodo Payments** (not Stripe). The customer-facing commercial catalog lives in `lib/billing/entitlements/catalog.ts` (`PLAN_PRICING`, `PROVISIONAL_MONTHLY_CREDITS`, `PLAN_BASE`) and is rendered by `lib/billing/entitlements/commercial-plans.ts`. It is the **only** catalog that is displayed or sold — there is no feature flag and no legacy fallback offering. The legacy six-plan rows in `lib/billing/config.ts` (`LEGACY_SUBSCRIPTION_PLANS`) remain solely as renewal-attribution plumbing for pre-existing Dodo subscriptions; they are never shown to a customer and cannot be bought.

**Commercial catalog (live):**

| Plan | Monthly | Annual | Monthly Credits\* | Businesses | Production apps | Custom domains |
|------|---------|--------|------------------|-----------|----------------|----------------|
| Explorer | Free | — | 500 one-time (planning, on verification) | 1 (planning only) | 0 | 0 |
| Starter | $89.99 | $989.89 | ~150,000 | 1 | 1 | 0 |
| Growth | $199.99 | $2,199.89 | ~400,000 | up to 4 | up to 4 | 1 |
| Scale | $499.99 | $5,499.89 | ~1,200,000 | unlimited | unlimited | up to 4 |
| Enterprise | Custom | Custom | negotiated | unlimited | unlimited | custom |

\* **Provisional** — `PROVISIONAL_MONTHLY_CREDITS` are placeholders pending the Phase 4 contribution-margin ratification; admin-overridable per plan. Do not treat as final.

**Explorer is planning-only:** one business may be planned with the co-founder, but production builds and deploys are refused server-side (`EXPLORER_PLANNING_ONLY`).

**Annual billing:** 12 months for the price of 11 (~8% saved), charged once upfront; credits are issued **monthly** via the annual-sweep cron (month-0 at activation, months 1–11 by sweep), deduplicated by the shared grant-window key.

**Dodo products:** each plan/cycle pair has its own Dodo product, named `Atai — <Plan> — $<price>/mo|yr`. Set `DODO_COMMERCIAL_PRODUCT_<PLAN>` (and `..._ANNUAL`) to a provisioned product id to lock the price; when the variable is absent, checkout creates the product on demand at the catalog price. A legacy product is never reused.

**Credits renew monthly.** Unused subscription credits expire at period end. Permanent credits never expire.

---

## Credit Packs (One-Time Purchase)

Defined in `PERMANENT_CREDIT_PACKS` (`lib/billing/config.ts`):

| Pack | Credits | Price | Per Credit |
|------|---------|-------|-----------|
| perm_200k | 200,000 | $59 | $0.000295 |
| perm_500k *(popular)* | 500,000 | $119 | $0.000238 |
| perm_1m | 1,000,000 | $219 | $0.000219 |
| perm_5m | 5,000,000 | $859 | $0.0001718 |
| perm_15m | 15,000,000 | $2,499 | $0.0001666 |

Larger packs = better rate. All credits are permanent (never expire).

---

## Free Credits

- **Welcome bonus**: 500 credits, granted on **email verification** (not at signup) — `WELCOME_BONUS_CREDITS` / `DEFAULT_REWARDS.welcomeBonus`.
- **Referral verification reward**: 500 credits to the referrer when a referred user verifies their email.
- **Referral milestone reward**: 1,500 credits when the referred user reaches the qualifying build-usage threshold (75,000 credits).
- **Admin gift**: Admin can manually grant credits.

---

## Checking Balance

### In Code
```typescript
// Get current balance
const balance = await getBalance(userId)

// Check before operation
const canAfford = await hasSufficientCredits(userId, 500)
if (!canAfford) {
  // Show "insufficient credits" error to user
}
```

### In Admin Panel
- Go to `/admin/users`
- Click any user
- See credit balance + full ledger history

---

## Idempotency

Every ledger entry has an `idempotencyKey` that prevents double-charging.

If a charge operation is retried (due to network error, server crash), the idempotency key ensures the credit is only deducted once.

**Format**: `{operation}:{entityId}` (e.g., `"project:proj_abc123:crawl"`)

This is production-critical. Without it, a server crash mid-operation could result in credits being charged twice.

---

## Common Credit Issues

### "Not enough credits" error but user has credits
**Cause**: Race condition OR subscription credits expired  
**Fix**: Check `users.creditBuckets` — look for expired buckets  
**Admin fix**: Grant credits manually, investigate ledger

### Credits deducted but operation failed
**Cause**: Refund transaction didn't fire  
**Fix**: Admin manually grants credits as compensation  
**Prevention**: Always wrap in try/catch with `refundReservation()` in catch

### Credits showing wrong balance
**Cause**: `users.credits` out of sync with ledger  
**Fix**: Recalculate from ledger and update user record  
**Admin**: Use admin panel to investigate discrepancy

---

## Key Files

```
lib/credits/credits.ts          ← All credit functions (reserve, charge, refund)
lib/db/collections.ts           ← creditLedgerCol(), usersCol()
lib/billing/billing-types.ts    ← TypeScript interfaces
app/api/admin/billing/          ← Admin billing API endpoints
app/api/admin/ledger/           ← Admin ledger API
```

---

**Related**: `DATABASE_SCHEMA.md` → `credit_ledger` and `users` collections
