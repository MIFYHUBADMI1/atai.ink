import { requireUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { getBalance } from "@/lib/credits/credits"
import { isTotalumConfigured } from "@/lib/integrations/totalum/client"
import { isFirecrawlConfigured } from "@/lib/integrations/firecrawl/service"
import { ok, handleRouteError } from "@/lib/api/respond"
import { toPublicUser } from "@/lib/auth/users"
import { singleFlight } from "@/lib/cache/single-flight"
import { subscriptionRecordsCol } from "@/lib/db/collections"

const CACHE_HEADERS = {
  // Private: per-user data, must not be shared by CDN.
  // max-age=0: browser must always revalidate — no stale authenticated
  // responses after logout. stale-while-revalidate is intentionally omitted:
  // if the session cookie is gone, a stale /api/me would return old user data
  // which is the root cause of session bleed when switching accounts.
  // must-revalidate ensures the browser won't serve stale copies past max-age.
  "Cache-Control": "private, no-cache, must-revalidate",
}

/**
 * Returns the current authenticated user's session info.
 * Private: per-user data, must not be shared by CDN.
 *
 * Uses single-flight deduplication so that concurrent identical requests
 * (e.g. 50 SWR clients hitting /api/me on page load) only hit the DB once.
 * The store's in-memory LRU cache also serves repeated reads within the TTL,
 * but single-flight handles the case where the cache is cold simultaneously
 * for multiple requests.
 */
export async function GET() {
  try {
    const user = await requireUser()

    // Single-flight wrapper: concurrent identical calls share one DB query.
    const fetcher = singleFlight<Response>(`api.me:${user.id}`)
    return fetcher(async () => {
      const [balance, transactions, subRows] = await Promise.all([
        getBalance(user.id),
        store.listTransactions(user.id, 30),
        (await subscriptionRecordsCol())
          .find({ userId: user.id })
          .sort({ createdAt: -1 })
          .limit(1)
          .toArray(),
      ])
      // Same active-status rule as /api/billing/overview: terminated
      // subscriptions fall through to 0 so the header shows no plan pool.
      const ACTIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due", "paused", "payment_failed"])
      const sub = subRows[0]
      const allowance = sub && ACTIVE_SUB_STATUSES.has(sub.status) ? Math.max(0, sub.mirrorCredits) : 0
      return ok({
        user: toPublicUser(user),
        userId: user.id,
        // `reserve` transactions already debit the balance immediately (see
        // lib/credits/credits.ts), so there is no separate "held" pool to
        // subtract — the full balance is available. `allowance` is the active
        // plan's monthly credit grant — the fixed denominator the header meter
        // divides the live balance by (0 = no active plan).
        credits: { balance, reserved: 0, available: balance, allowance },
        transactions,
        providers: {
          totalum: isTotalumConfigured(),
          firecrawl: isFirecrawlConfigured(),
        },
      }, { headers: CACHE_HEADERS })
    })
  } catch (e) {
    return handleRouteError("api.me", e)
  }
}
