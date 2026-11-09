# Ads & Growth Center — Phase 0 Discovery Report

Scope: transformation of Atai.ink's Ads & Marketing into a full Ads & Growth Center per the transformation brief. Everything below was verified against the working tree on 2026-11-09 (branch `main`, HEAD `e7cc3b3`), not taken from the brief's audit.

## 1. Existing functionality

### Ads Bench (project-level, real and working)

- Route `app/project/[projectId]/ads/page.tsx` — server page gated by `requireOwnedProject` + `isMarketStudioEnabled()`; renders `AdsBench` with bench data.
- Bench data `lib/marketing/ads-bench-data.ts` — fail-soft assembly of slots + credit balance + `ai.text`/`ai.image` availability.
- Slot definitions `lib/marketing/studio/ads-kit-content.ts` — 5 slots: facebook-copy, instagram-copy, tiktok-copy, image-square (1:1), image-story (9:16). Pure module, brief assembly with a 1100-char context budget and a fixed drop order (offer/URL/app name always survive).
- Service `lib/marketing/studio/ads-kit.ts` — `generateAdsKitSlot()` (per-slot generation, persists as `kit: "ads"` + `kitSlot`) and `listAdsKit()` (newest draft per slot, media dataUrls projected OUT).
- API `app/api/projects/[id]/market/ads-kit/route.ts` — NDJSON streaming POST, per-slot started/done/failed frames, per-call billing inside the router, slot failure never aborts the kit.
- UI `components/marketing/ads-bench.tsx` — offer + audience inputs, per-slot select/regenerate, copy-to-clipboard for text, inline image ONLY when the item's media came back in the same response, credits badge, stop button.

### Platform-level `/ads`

- `app/ads/page.tsx` is STILL a `ComingSoonPage` ("Plan, launch and manage campaigns."). The brief's audit is correct on this point even though later commits touched the project-level bench.

### Marketing Studio (canonical surface)

- `app/project/[projectId]/studio/page.tsx` — tabs via `?tab=` (home/create/library/calendar/brand), each a real URL.
- Generation service `lib/marketing/studio/market-service.ts` — `generateMarketContent()` for 9 kinds (copy/email/social/timeline/blog/brief/image/voice/video), runtime-identity resolution (project API key → workspace identity), central runtime metering, media capped at 4.5M chars (`notPersisted` overflow flag), per-item GET returns media (`getMarketContent`), lists exclude dataUrls.
- Studio API `app/api/projects/[id]/market/studio/route.ts` — GET (state/list/per-item via `?contentId=`), POST (generate / pollVideo), DELETE.
- Library `components/marketing/studio-library.tsx` — list + per-item detail client-side, edit/save, variants; no URL-driven item deep link (selection is client state only).

### Growth Overview (Phase 2 substrate already exists)

- `lib/marketing/growth-overview.ts` — trusted-metric view model with `MetricState` (available / measured_zero / unavailable / not_instrumented), trust notes, next steps; reads projects, runtime_usage, credit_ledger, referrals. **This is exactly the honesty model the brief demands.**
- Rendered at `app/project/[projectId]/market/page.tsx` (Market & grow hub) with LaunchKitPanel + GrowthOverviewView + SeoAuditPanel. `components/marketing/growth-overview-view.tsx` is the view.
- `OwnerGoals` shape: `{ businessGoal?, revenueTarget?, destination?, intent? }` read from user onboarding (`readOwnerGoals`).

### Campaign planning

- `lib/marketing/campaigns/service.ts` + `campaigns`/`campaign_history` collections + `CampaignDoc`/`CampaignHistoryDoc` types + validated transitions + append-only history. UI: `components/marketing/campaigns-panel.tsx`, page `app/project/[projectId]/campaigns/page.tsx`. Free (no credits) by design.

### Billing (Atai Credits)

- `lib/billing/credit-service.ts` — `consumeCredits({ userId, amount, transactionType, idempotencyKey, referenceType?, referenceId?, metadata?, projectId? })` inside a Mongo session transaction with suffixed-key idempotency (`${key}_sub`/`${key}_perm`), `reverseCredits()`, `getAvailableCredits()`, `getLedgerEntries()`. This is the ONLY path Phase 5 may use for campaign charges.

### Admin

- Pages under `app/admin/**` (billing, ledger, users, feature-requests with `[id]` detail pages, planning-runs, etc.). No `/admin/ads`.
- API guard: `requireAdmin()` from `lib/auth/session.ts:164` (throws 403 unless `user.isAdmin`).
- Export/upload precedents: `app/api/admin/lessons/upload/route.ts`, `app/api/admin/resources/upload/route.ts` (ImageKit upload), audit-logs routes exist.

### Notifications

- No push/notification collection. `buildNotificationInbox()` in `lib/dashboard/view-model.ts` DERIVES inbox items from live state (projects, feature requests) + `lib/dashboard/notifications-store.ts` (localStorage read/dismiss). Campaign-request notifications must follow this derived-from-state pattern.

### Uploads / storage

- `app/api/projects/[id]/assets/route.ts` — ImageKit upload via `uploadImageToImageKit` + `project_assets` collection, rate-limited, AI-lease guarded. Reusable for campaign asset uploads.

### Analytics

- `atai.analytics` runtime capability wired for generated apps (commit `d1d9b1c`); platform-level app analytics is `not_instrumented` for growth metrics by design. Campaign attribution prep should stay honest to this.

## 2. Existing database structures (verified)

- `contentItems` (`ContentItemDoc`): `kind: "marketing_asset"`, `assetKind`, `media {kind,dataUrl,jobId,status,notPersisted}`, `runtime {calls[],totalCreditsCharged}`, `brief {brief,tone,channel,audience,aspectRatio,...}`, `kit`, `kitSlot`, `version`/`parentContentId`/`variantOf`, `tags`, `plannedAt`, `creditsCharged`.
- `campaigns` + `campaign_history` (see CampaignDoc above).
- `project_assets` (ImageKit uploads), `credit_ledger` (LedgerEntry with idempotencyKey + referenceType/referenceId + projectId), `runtime_usage`, `referrals`.
- Collection factory: `lib/db/collections.ts` (`getDbCached()` + per-collection accessors + `ensureIndexes()`); runtime collections separately in `lib/db/runtime-collections.ts`.

## 3. Existing APIs and services

- `/api/projects/[id]/market/ads-kit` (POST NDJSON), `/api/projects/[id]/market/studio` (GET/POST/DELETE), `/api/projects/[id]/market/launch-kit`, `/api/projects/[id]/market/competition-snapshot`.
- `/api/projects/[id]/assets` (upload/list).
- Admin APIs under `/api/admin/**` guarded by `requireAdmin()`.
- Route conventions: `ok()/fail()/handleRouteError()` from `lib/api/respond`, `withAiProtection("studio", handler)`, `checkRateLimit`, `readJsonBody`, zod `.strict()` schemas, `AppError` codes.

## 4. Existing reusable components

- `AdsBench` (bench pattern to extend), `StudioNav` (URL-tab nav), `StudioLibrary`, `DashboardShell`, `ProjectComingSoon`, `GrowthOverviewView`, `LaunchKitPanel` (kit-panel pattern with slots), admin list/detail page patterns (feature-requests).

## 5. Missing functionality (gaps the brief targets — verified)

1. Platform `/ads` is a coming-soon page — disconnected from the bench.
2. Bench image slots: stored items carry NO media in the list read; UI shows "open it in the Studio" text instead of the image, and Studio has no ads-specific deep link. After refresh, images are effectively unviewable from the bench.
3. No image download anywhere (bench or studio).
4. Generation brief (offer/audience) is persisted on each item's `brief` field but the bench does not prefill from it; returning users see empty inputs.
5. `ownerGoals` is read in the route and passed to `generateAdsKitSlot` but NEVER used (dead parameter).
6. "Open in Studio" links to the studio homepage, not the library item.
7. Bench list read omits the brief → no brief display; per-slot "versions" (older drafts) exist in the library but are not surfaced from the bench.
8. No campaign lifecycle for advertising: the existing `campaigns` collection is founder-tracked PLANS only, not Atai-managed promo requests.
9. No advertising request system, no admin ads workspace, no pricing/quotations, no manual execution workspace, no performance reporting.
10. Bench tests exist only indirectly via ads-kit-content tests; no service/API/component tests for the bench flow (verified: no `ads-kit.test.ts`, no ads route tests).

## 6. Security and billing risks

- No new risks introduced by the bench itself: ownership re-checked in route + service, billing inside router metering, `.strict()` zod.
- Risks to preserve: `consumeCredits` idempotency (suffixed keys — any campaign charge MUST reuse this), project ownership must never trust client ids (brief's requirement already the codebase norm), admin surfaces must use `requireAdmin()` end-to-end, SSRF discipline for any URL handling (existing crawl infra lives in `lib/marketing/seo/crawl.ts`; do not hand-roll fetching).
- The brief's "campaign submission with uploads" must reuse the ImageKit path with size/type limits, not invent storage.

## 7. Recommended architecture

- **Phase 1 (bench fixes):** include `brief` + a `media` presence flag in `listAdsKit` (dataUrl still excluded); add a per-slot media fetch (`GET /api/projects/[id]/market/studio?contentId=` already exists — reuse it); add image download (client-side blob from dataUrl fetch); persist last offer/audience server-side per project (new small `ads_briefs` doc or derive from newest kit item's brief — derive, no new collection); prefill inputs; deep link `?tab=library&item=<contentId>` (add item param support to studio library); use `ownerGoals` in `buildAdsKitContext`; connect `/ads` platform page to a real index of the founder's projects' benches (honest "pick a business" page); add tests.
- **Phase 2 (Growth Center):** build project `/ads` as the Ads & Growth hub (overview cards from `getGrowthOverview` + campaigns + new requests), keep bench as a section; extend strategy via existing plan sections; navigation via StudioNav-style tabs on the ads page.
- **Phase 3 (requests):** new collections `adCampaignRequests` (+ history/messages) modeled on CampaignDoc patterns; submission API with derived ownership, rate limit, idempotency key, ImageKit upload reuse; statuses as validated transitions.
- **Phase 4 (admin):** `/admin/ads` + `/api/admin/ads/**` with `requireAdmin()`, inbox with search/filter/pagination, full review page incl. application intelligence (spec + plans + existing assets, provenance-labeled), notes vs founder messages.
- **Phase 5 (pricing/quotations):** `adPricingPackages` collection (admin-editable, credits only); quotation snapshot embedded in the request (versioned); approval → `consumeCredits` with `referenceType: "ad_campaign_request"` + idempotency key; refunds via `reverseCredits`.
- **Phase 6 (execution):** `adCampaignActivities` tasks (configurable, admin-marked), publication records (URL/date/account) — manual only, explicitly labeled.
- **Phase 7 (performance):** `adCampaignPerformance` entries with source + evidence link + reportedAt; founder view on request detail; notification inbox derives campaign-request states; finances linkage via credit_ledger referenceType (already flows).
- **Phase 8:** tests + build + report.

Execution-mode field on requests (`manual` only today) leaves the door open for future automation without redesign.

## 8. Required migrations

- New collections only (additive): `ad_campaign_requests`, `ad_request_events` (audit), `ad_pricing_packages`, `ad_campaign_activities`, `ad_campaign_performance`. No destructive changes; `contentItems`/`campaigns` untouched. Indexes via `ensureIndexes()` extension.

## 9. Phase dependencies

- Phase 1 is independent and immediately shippable.
- Phase 2 depends on Phase 1 (bench becomes a section of the hub).
- Phase 3 depends on Phase 2's hub (submission entry point) and uploads infra.
- Phase 4 depends on Phase 3 (requests exist).
- Phase 5 depends on Phase 3+4 (quotation needs a request + admin workspace).
- Phase 6 depends on Phase 5 (paid campaigns only).
- Phase 7 depends on Phase 3–6 (data to report on).
- Phase 8 runs across all.

## 10. Implementation checklist

- [x] Verify brief's audit claims against code (this report)
- [ ] Phase 1: bench brief persistence + prefill, image view/download, ownerGoals, deep links, /ads page, tests
- [ ] Phase 2: ads hub (overview + strategy + generation + history + nav)
- [ ] Phase 3: request flow + collections + uploads + notifications
- [ ] Phase 4: admin inbox + review + dossier + downloads
- [ ] Phase 5: pricing packages + quotations + credits charging + refunds
- [ ] Phase 6: execution workspace + activities
- [ ] Phase 7: performance + finances/co-founder linkage
- [ ] Phase 8: full test pass, build, final report
