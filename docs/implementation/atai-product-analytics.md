# Product analytics — runtime, SDK and snippet

Status: implemented. Scope: measure what visitors do in an application Atai did
not build, and tell the founder what it means.

## Why this exists

Until now, a connected business was `measurement: "none"`. That was honest — we
did not host the site, so we could not count anything — but it left the founder
with an assessment of their copy and no idea what people actually did with it.
The rule that produced `none` was never "never measure"; it was "never invent a
number". This slice measures, and keeps the rule: a number appears only when a
visitor reported one.

## Shape

```
browser snippet ──┐
                  ├─→ toAnalyticsEvents ─→ analytics_events ─→ summariseProduct ─→ panel
runtime / SDK ────┘        (one normaliser)      (Mongo, 90d TTL)   (pure read model)
```

### The snippet — `public/atai-analytics.js`

One line, installed in `<head>`:

```html
<script defer src="https://atai.ink/atai-analytics.js" data-atai-key="atai_production_pk_…"></script>
```

It records a `page_view` (path + referring host), a `page_view` for every
client-side route change (it wraps `pushState`/`replaceState` and listens for
`popstate`), a `page_leave` with the time spent when the tab is hidden or the
route changes, and a `click` on a link, button or field with the label a person
would use (`aria-label` → `data-atai-label` → `title` → text → tag).

It never records an input value, page content, a cookie, a user agent or an IP.
It sends nothing at all when the visitor sets Do Not Track, unless the site
owner passes `data-atai-dnt="ignore"`. Events are batched (20 or 5s) and sent
with `fetch(keepalive)`; on `pagehide` they go through `sendBeacon`, which is why
the key may travel in the body instead of an `Authorization` header.

### The collector — `POST /api/analytics/collect`

Public and CORS-open, because the app is on another origin. It is in
`PUBLIC_API_PREFIXES` so the session-cookie gate cannot 401 a stranger's
visitor. The trust model:

1. A **publishable** key identifies the project and nothing else. `kind:
   "publishable"` keys are issued as `atai_<env>_pk_<secret>` and their scopes
   are forced to `["analytics"]`, so a key read out of page source cannot call a
   provider, read a summary or spend a credit. A secret key is refused.
2. `projectId` and `environment` come from the key record, never from the body.
3. A bot (crawler, monitor, link preview) is answered `accepted: 0` and stored
   as nothing — a crawler is not a customer, and counting it inflates every
   number the founder is asked to act on.
4. A malformed batch is a 422 the snippet drops. The collector never returns an
   error the host app has to handle.

### The normaliser — `lib/analytics/product/normalize.ts`

Shared by the collector and the runtime mapper so the two entry points cannot
drift. A path is grouped by its shape (`/orders/12345` → `/orders/:id`; uuid and
long hex segments too), a referrer is reduced to its host, a click label is
collapsed and capped at 80 characters, a device is one of three coarse classes,
and an unrecognised `kind` becomes `custom` rather than being dropped.

### The read model — `lib/analytics/product/summary.ts`

Pure: events in, `ProductSummary` out. Sessions (30-minute idle window from the
snippet), visitors, returning vs new, pages per visit, bounce rate, median visit
length, top pages with exit counts and median time, entry/exit pages, top
clicks, daily series, devices, referrers, the three most common journeys, custom
events — and `signals`.

`signals` is the advising half. Each sentence carries the number that justifies
it ("/checkout is where people stop: 80% of the visits that reached it ended
there"), is offered only above three sessions, and is omitted rather than
guessed when the sample is thin.

`getProductAnalytics` reads newest-first with a 20,000-event cap and marks the
result `sampled: true` when the cap is hit, so a capped read is never presented
as exact.

### The surfaces

- `components/marketing/product-analytics.tsx` — one panel, rendered on
  `/business/<id>/growth` and on `/project/<id>/market`. With no sessions it
  shows how to install the collector, not a grid of zeroes.
- `/project/<id>/runtime/keys` — "Create browser key" issues the publishable key
  and shows the snippet.
- `/business/<id>/settings` — `AnalyticsKeyCard` does the same for a connected
  business through `POST /api/businesses/[businessId]/analytics-key`
  (`runtime.keys.manage`), because the operate surface has no project settings
  page and the anchor project id must not reach the browser.
- The SDK (`packages/atai-sdk`) accepts the same event shape, so server code and
  the browser report into the same read.

## What is deliberately not here

- **No per-person identity.** A `visitorId` is a random id in `localStorage`;
  nothing links it to an Atai account, and no IP, user agent or cookie is
  stored. Per-user funnels would need consent this product does not ask for.
- **No third-party analytics.** Events stay in `analytics_events`; there is no
  external key to configure and nothing to leak.
- **The rate limit is in-process.** `checkRateLimit` is a per-instance bucket,
  so the collector's 240 req/min is a best-effort brake, not a distributed
  quota. A real abuse defence belongs at the edge.
- **Retention is the existing 90-day TTL** on `analytics_events`. Nothing reads
  further back, and the read window is capped at 90 days.
- **A business browser key cannot be revoked from the business surface yet.**
  `GET /api/businesses/[businessId]/analytics-key` lists them; revocation runs
  through the project surface's key management.

## Verification

- `lib/analytics/product/normalize.test.ts` — grouping, bot detection, device,
  referrer host.
- `lib/analytics/product/collector-script.test.ts` — the snippet runs in a
  sandbox: page view, click label, SPA route change, hidden tab, Do Not Track,
  and no identifying data in the payload.
- `lib/analytics/product/summary.test.ts` — sessions, bounce, stop page,
  journeys, returning visitors, window filtering, sampled flag.
- `app/api/analytics/collect/route.test.ts` — CORS, publishable-only,
  project scoping, bot drop, 429, 422.
- `app/api/businesses/[businessId]/analytics-key/route.test.ts` — permission and
  publishable-only issuance.
- `components/marketing/product-analytics.test.tsx` — empty state vs measured
  state vs sampled.
