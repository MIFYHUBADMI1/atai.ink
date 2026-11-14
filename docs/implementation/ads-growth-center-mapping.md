# Ads & Growth Center — design-to-code mapping

Reference: the founder-supplied "ATAI.INK — Professional Ads & Growth Center" brief plus the
Competition dashboard screenshots (the native design benchmark). This mapping was produced
before implementation, per the brief's instruction. It records what is reused as-is, what is
improved in place, and what is genuinely new.

## Ground rules carried into every phase

- **Honesty model wins over illustrative figures.** The brief's sample KPI numbers (12,400 reach,
  846 visits…) are image-generator placeholders. Instructions 8–9 of the brief and the platform's
  existing trust model (`lib/marketing/growth-overview.ts`) forbid fabricated statistics: every
  metric renders a real measured value, a real measured zero, or a professional empty state with
  the reason it is not measured. No "sample data" rows are invented.
- **Manual execution only.** Nothing publishes, schedules, or spends. Promotion requests are
  executed by Atai's team by hand; estimates are planning ranges, never guarantees.
- **Credits are the only billing currency here.** Proposal prices come from admin-configurable
  `ad_pricing_packages`; charging goes through `chargeAdRequest` → `consumeCredits`. Money and
  credits are never blended into one number.
- **Design language = Competition page.** `rounded-2xl border border-border bg-card` cards,
  semantic `primary` accents (never literal violet outside charts), underline tabs, lucide icon
  tiles, recharts guarded by `useMounted`, themed tooltips, `CHART_COLORS` violet-led palette.

## Section-by-section mapping

| Brief section | Reuse as-is | Improve in place | New |
| --- | --- | --- | --- |
| §2 Layout / navigation | `DashboardShell`, `workspaceGrowNav` | `ads-nav.tsx` → full center IA (Overview, Strategy, Ad bench, Analytics, Promote, Requests, History + Ad Studio / Campaigns / Assets cross-links); sidebar label "Ads & Growth", Campaigns entry | — |
| §3 Growth Overview | `getGrowthOverview`, `listCampaigns`, `getAdStrategy`, `listAdsKitDrafts` | `app/project/[projectId]/ads/page.tsx` overview tab replaced | `lib/marketing/ads/growth-center.ts` (view model), `components/marketing/growth-center-overview.tsx`, `components/marketing/growth-charts.tsx` (sparkline / trend / donut / funnel primitives) |
| §4 Marketing Strategy | `AdsStrategyPanel` form + metered recommendations, `ad_strategies` | Same panel: card-based read view when saved, Edit toggle | "Create campaign from strategy" (pure channel mapping in `center-model.ts` + existing `POST /campaigns`) |
| §5 Ad Studio | `MarketStudio` (brief, kinds, channels, tones, credits, preview, save/download/copy), `AdsBench` | Studio result + library gain "Add to campaign" | `AddToCampaignDialog` |
| §6 Campaigns | `campaigns` service + API, status machine, UTM builder | `campaigns-panel.tsx`: summary cards, search + status/channel filters, table (lg+) / cards (mobile), create/edit dialogs with dates + budget | `CampaignDoc.assetIds` linking (types, service validation, API schema), asset titles on the campaigns page |
| §7 Promote My Business | `PromoteWizard` (6 steps, confirmations, idempotent submit), `normalizePromotionUrl` | Promote tab gains the 3-step service explainer; request list moves out | — |
| §8 My Promotion Requests | `ad_campaign_requests` lifecycle, `AdRequestPanel` actions/API | `ad-request-list.tsx` → rich cards (ID, objective, status, quotation, estimated visibility); panel gains full proposal card + lifecycle stepper | `request-lifecycle.tsx` (8-stage stepper, pure), `requests` tab, deep links moved to `tab=requests` |
| §9 Performance Analytics | `ad_campaign_performance` (source: manual/platform/estimated/tracking), `runtime_usage` | — | `lib/marketing/ads/analytics.ts` + pure `center-model.ts` aggregation; `ads-analytics-view.tsx`; `analytics` tab with range + campaign filters |
| §10 Assets Library | `StudioLibrary` (filters, versions, refine, variations, download) | Channel/platform filter; "Add to campaign" action | `AddToCampaignDialog` (shared with studio) |
| §12 Admin configurability | `/admin/ads` console, packages CRUD, proposal editor, refund | — (already complete) | — |

## New shared modules

- `lib/marketing/ads/center-model.ts` — pure, unit-tested: performance-metric normalization,
  latest-report-per-campaign totals, daily buckets, funnel, strategy-stage derivation, request
  lifecycle stage mapping, strategy→campaign channel mapping, campaign summary counts.
- `lib/marketing/ads/analytics.ts` — server-only reads assembling the analytics view model with
  the same trust states as `growth-overview.ts` (measured / measured zero / not recorded).
- `lib/marketing/ads/growth-center.ts` — server-only overview assembly (business context, KPIs,
  tracker, recommendation, recent campaigns, recent creatives).

## Metric semantics (analytics)

`ad_campaign_performance` rows are admin-recorded reports. Totals sum the **latest report per
campaign per canonical metric** (cumulative updates never double-count). The day series sums
**what was recorded each day**. Unknown metric names are never dropped — they render under
"Other recorded results". Every surface labels the source (manually entered / platform-reported /
estimate / integrated tracking). Revenue is money recorded by the team; it is never combined with
credits.

## Phasing

1. Mapping (this file). 2. Pure model + tests. 3. Overview. 4. Analytics. 5. Campaigns.
6. Requests/Promote. 7. Strategy. 8. Assets linking. 9. Nav. 10. Tests + `tsc` + full `next build`.
