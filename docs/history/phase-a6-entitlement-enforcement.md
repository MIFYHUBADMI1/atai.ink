# Phase A6 — Consistent Entitlement Enforcement and Presentation-Safe Access (M-22)

## 1. Audit findings

The audit compared every product operation that spends a paid capability with
the server entry point that performs it. The commercial catalog was already the
source of truth for plan caps, but several operations reached the provider
without ever asking the resolver.

| Operation | Server entry point | Before A6 | Gap |
| --- | --- | --- | --- |
| Custom domain registration | `PUT /api/projects/[id]/domain` | No plan check; direct `addCustomDomain` | Starter could register a domain; Growth could exceed one |
| Production subdomain / deploy | `POST /api/projects/[id]/deploy` | `authorizeProductionWork("deploy")` checked `deploy`, not `connectSubdomain` | A plan could deploy without a subdomain slot |
| Production build | `POST /api/projects/[id]/build`, `startProjectBuild` | `buildProduction` only | Build also provisions a database and engages specialists, neither checked |
| Follow-up edit | `POST /api/projects/[id]/agent` → `sendProjectFollowup` | No plan check | A founder could keep changing a production app after losing production capability |
| Database provisioning | Build path (`initializeProjectInfrastructure`) | Implicit in build only | No explicit `provisionDatabase` decision in the compound build gate |
| Storage upload | `POST /api/projects/[id]/assets` | Infrastructure status only | No `useStorage` check and no quota against real bytes |
| Visual generation | `POST /api/projects/[id]/generate-visual` | Infrastructure status only | Same storage gap |
| Specialist teams | Build / follow-up path | No `useSpecialistTeam` decision | A plan without the team tier still ran the build |
| Competition intelligence | `POST /api/projects/[id]/market/competition-snapshot`, Competition page | Feature flag and provider checks only | Starter could spend research credits without the Growth capability |
| Consumed custom domains | `resolveScope` | Query returned `0` unconditionally | Domain caps never reached their limit |
| Consumed subdomains | `resolveScope` | Counted production apps, not deployed projects | Subdomain caps were measured against the wrong resource |
| UI availability | Publish menu, workspace, competition, assets | Assumed every operation was available | Denials surfaced only after a failed request |

## 2. Enforcement architecture

### Central guards

`lib/billing/entitlements/require.ts` is the single place route code asks for a
decision. The existing feature flag remains the emergency rollback switch; it
is on by default.

- `authorizeProductionWork(userId, "buildProduction")` resolves
  `buildProduction`, `provisionDatabase` and `useSpecialistTeam` against one
  fresh snapshot and returns the first denial.
- `authorizeProductionWork(userId, "deploy", { hasExistingSubdomain })` checks
  `deploy`, then `connectSubdomain` only when the project has never published.
- `authorizeCustomDomain(userId, hasExistingDomain)` spends a registration only
  for a new domain. Replacing or removing an existing domain stays a
  management action.
- `authorizeSubdomain(userId, hasExistingSubdomain)` lets an already-published
  project be republished after a downgrade.
- `authorizeStorage`, `authorizeProvisionDatabase`, `authorizeSpecialistTeam`
  and `authorizeCompetitionIntel` are the per-operation guards.

Every guard uses `fresh: true`; the route never trusts a cached plan decision
for a capability that costs money. A resolution error is a refusal, not a
permission: `authorizeProductionWork` returns `ENTITLEMENT_UNAVAILABLE` instead
of allowing the work when the plan cannot be confirmed.

### Resource counting

`lib/billing/entitlements/service.ts` now counts what the catalog prices:

- `subdomains.current` = projects with `deployment.status === "success"`, a
  `deployment.productionUrl`, or `state === "deployed"`.
- `customDomainsIncluded.consumed` = distinct active
  `deployment.customDomain` values plus legacy
  `deploymentHistory[].customDomain` values.

`PUT /api/projects/[id]/domain` now records the active hostname on
`project.deployment` and `DELETE` clears it, so the count reflects the resource
that actually exists. A failed provider call writes neither the project nor an
event.

### Terminated subscriptions

A terminated paid subscription is not a legacy free account. The free plan's
grandfathering exists for founders who never bought a paid plan; it must not
restore production after cancellation. `resolveScope` now looks at the latest
subscription record when no active one exists. `cancelled`, `canceled`,
`expired` and `terminated` fall back to Explorer without
`preserveLegacyBehavior`; a true legacy free account with projects keeps its
old capability.

### Storage

`lib/infrastructure/service.ts` exposes:

- `getProjectStorageUsage(projectId)` — sums real asset and attachment bytes
  and returns `{ usedBytes, limitBytes, withinLimit }`. A project with no
  infrastructure record falls back to the free Testing 50MB cap; an
  uninitialized project cannot upload past that quota.
- `refreshProjectStorageUsage(projectId)` — persists the observation and
  `overQuota` for the infrastructure UI.
- `checkStorageLimit(projectId)` — the existing quota helper now uses observed
  bytes.

Asset upload checks the plan, then reserves bytes before uploading or taking
an AI lease, and refreshes usage after a successful write.
Visual generation reserves the 5MB image ceiling before calling the provider;
a returned image above that ceiling is refused before charging. A generated
image is persisted with its real byte length when known (base64), or with the
5MB ceiling marked as an estimate when the provider returns only a hosted URL.

Build-generated preview screenshots are project storage too:
`lib/screenshots/capture-app-preview.ts` reserves bytes, inserts a countable
`screenshot` asset, and only then adds the URL to `understanding.screenshots`.
A refused reservation skips the preview instead of silently overfilling the
plan. Project attachments are create-time only and remain bounded by their own
2.5MB limit, so they are not a post-creation quota write.

### Atomic capacity reservations

A fresh entitlement read is not atomic. Two requests could both observe the
last free domain/subdomain slot or the last free storage byte, then both write.
`lib/billing/entitlements/reservations.ts` closes that window:

- A short database lock serializes the read-check-reserve section
  (`billing_resource_locks`, 30s TTL, 2s wait). A contender that cannot acquire
  the lock receives `ENTITLEMENT_BUSY` (409), not permission.
- The winner writes a durable hold (`billing_resource_holds`). A domain hold
  lives 30 minutes, a subdomain hold 6 hours, and a storage hold 1 hour. Holds
  count toward the plan limit while pending, so the next request sees the
  capacity as already spent.
- `reserveCustomDomainSlot`, `reserveSubdomainSlot` and
  `reserveProjectStorage` own the lock/check/hold sequence. Routes call these
  instead of `authorize…` followed by a separate write.
- A slot hold is deterministic per scope + kind + project, so a retry for the
  same project is idempotent. A different hostname while a domain change is in
  flight receives `DOMAIN_CHANGE_IN_PROGRESS` (409).
- Provider failure releases the hold. A provider success followed by a failed
  project write deliberately keeps the hold so a retry cannot hand the same
  slot to another request; the hold expires if the write never lands.
- Expired holds are never counted and both collections carry TTL indexes, so a
  crashed request cannot consume capacity forever.

The subdomain counter also includes `state === "deploying"`, because a first
deploy has claimed its slot before the provider finishes. Both the REST deploy
route and the shared `startProjectDeploy` service (used by the Co-founder tool
and pipeline recovery) use the same atomic claim and reservation sequence.

### Kill switch

`ENTITLEMENT_ENFORCEMENT_ENABLED=false` is the emergency rollback. It is read
as an exact string: only `false` turns enforcement off.

When it is off:

- plan-capability guards return allowed; custom-domain and subdomain slot
  reservations return no hold; the project access view also reports those
  capabilities as allowed, so the UI is not left disabled behind an open API;
- the pre-existing infrastructure storage byte quota is still enforced. The
  flag disables the entitlement layer, not the quota that existed before A6;
- credit checks, infrastructure expiry checks and provider checks still run;
- slot holds left from an earlier ON period are not consulted and expire by
  TTL. Storage holds remain counted until their TTL because the byte quota is
  still being enforced.

### Presentation-safe access

`lib/billing/entitlements/presentation.ts` builds a `ProjectAccessView` from
the same resolver the routes use. It is not an authorization token: every
mutating route checks again. `GET /api/projects/[id]` returns it as `access`.

The view reports:

- custom domain: `allowed`, `code`, `reason`, `limit`, `consumed`
- subdomain: `allowed`, `code`, `reason`, `limit`, `current`
- storage: `allowed`, `code`, `reason`, `limitBytes`, `usedBytes`
- database, specialist team, competition intelligence and Agent decisions

Existing resources remain manageable: a project with a custom domain or a
published URL reports the operation as allowed even when the current plan no
longer includes a new one.

### UI wiring

- `components/publish-menu.tsx` disables the subdomain and custom-domain
  actions and shows the server's reason.
- `components/edit-workspace.tsx` does the same in the publish panel.
- `components/workspace/operating-room.tsx` passes `access` from the project
  query.
- `components/project-assets.tsx` disables upload when storage is unavailable.
- `components/marketing/competition-dashboard.tsx` and the Competition page
  show the entitlement reason before the feature/provider reasons.
- `app/project/[projectId]/hosting/page.tsx` passes the server-built access
  view into the publish menu.

The server remains authoritative; an old client, a missing `access` object or
a direct API call cannot bypass a guard.

## 3. Files changed

New:

- `lib/billing/entitlements/presentation.ts`
- `lib/billing/entitlements/reservations.ts`
- `lib/infrastructure/storage-reservations.ts`
- `app/api/projects/[id]/domain/route.test.ts`
- `app/api/projects/[id]/market/competition-snapshot/route.test.ts`
- `lib/billing/entitlements/require.test.ts`
- `lib/billing/entitlements/presentation.test.ts`
- `lib/infrastructure/storage-usage.test.ts`
- `lib/projects/followup-entitlement.test.ts`

Updated:

- `lib/billing/entitlements/require.ts`, `service.ts`, `types.ts`
- `lib/infrastructure/service.ts`
- `app/api/projects/[id]/domain/route.ts`
- `app/api/projects/[id]/deploy/route.ts`
- `app/api/projects/[id]/assets/route.ts`
- `app/api/projects/[id]/generate-visual/route.ts`
- `app/api/projects/[id]/market/competition-snapshot/route.ts`
- `app/api/projects/[id]/route.ts`
- `lib/projects/project-actions.ts`
- `lib/types/project.ts`
- `app/project/[projectId]/competition/page.tsx`
- `components/publish-menu.tsx`, `components/edit-workspace.tsx`,
  `components/workspace/operating-room.tsx`, `components/project-assets.tsx`,
  `components/marketing/competition-dashboard.tsx`
- `app/api/projects/[id]/assets/route.test.ts`,
  `app/api/projects/[id]/deploy-claim.test.ts`,
  `lib/billing/entitlements/entitlements.test.ts`,
  `lib/billing/subscription-terms.test.ts`
- `lib/billing/entitlements/require.ts`, `index.ts`
- `lib/billing/entitlements/service.ts` (deploying counts as a subdomain)
- `lib/screenshots/capture-app-preview.ts`
- `lib/db/collections.ts`, `lib/types/db.ts`
- `lib/projects/project-actions.ts` (shared deploy path)

## 4. Test evidence

New coverage:

- **Operation matrix** — custom-domain cap at consumed 0/1, subdomain cap,
  storage and database provisioning, competition intelligence, specialist
  teams, review-pending historical records, and Agent unlaunched status.
- **Pinned snapshots** — live subdomain and custom-domain counters override the
  frozen snapshot counts without changing purchased caps; a failed deployment
  consumes no slot.
- **Central guards** — compound build checks all three operations against one
  snapshot; deploy skips the subdomain check for an existing URL; existing
  custom domains spend no registration; a resolution failure refuses rather
  than allows; denial shape is stable.
- **Custom domain route** — denial before the provider, successful add records
  the active hostname, existing domain is management, foreign project is 404
  before entitlement, provider failure writes nothing.
- **Competition route** — denial before research/credits, success only after
  the capability check, ownership failure checked first.
- **Storage** — real byte sum, over-quota observation, uninitialized project
  falls back to the Testing 50MB cap, persisted usage, upload denial before
  reading bytes, quota denial, refresh after upload.
- **Follow-up edits** — a plan without production changes is refused before a
  message or build run is written.
- **Terminated subscriptions** — cancelled paid accounts fall back to Explorer;
  legacy free accounts keep their existing capability.
- **Atomic capacity** — two concurrent requests for the last custom-domain
  slot produce one hold and one `CUSTOM_DOMAIN_LIMIT`; the same for the last
  subdomain slot and for two 60-byte uploads against a 100-byte quota.
- **Reservation lifecycle** — retries reuse the same deterministic hold, a
  different hostname is refused while a change is in flight, provider failure
  releases the hold, a successful project write releases it, and expired holds
  stop counting.
- **Shared deploy path** — `startProjectDeploy` refuses before claiming when
  the slot is denied, releases the hold when the atomic claim loses, keeps it
  on success, and releases it with the credit refund on provider failure.
- **Screenshots** — a captured preview reserves real bytes, records a
  countable screenshot asset, skips the preview when storage is refused, and
  releases the hold when upload fails.
- **Acceptance matrix** — a dedicated OFF/ON suite proves plan capabilities
  fail open with the flag off, the Testing 50MB quota still denies, and ON
  denies the Starter custom domain, an exhausted subdomain and over-quota
  storage; two concurrent first-deploy claims produce one hold.
- **Hold reconciliation** — expired locks/holds, orphaned projects and
  already-realized domains/subdomains are released; dry-run reports the same
  actions without deleting; a live storage hold is kept until TTL.

Validation run:

```text
npx tsc --noEmit            # pass
npx vitest run              # 325 files, 3922 passed, 2 todo (3924 total)
npm run lint                # 0 errors, 376 pre-existing warnings
```

## 5. Acceptance checklist

- [x] Custom domains are checked against the purchased registration cap.
- [x] Existing custom domains and published subdomains remain manageable.
- [x] A new subdomain is checked before deploy; republishing an existing one is
      not charged again.
- [x] Production build checks build, database provisioning and specialist
      teams in one fresh decision.
- [x] Follow-up edits use the same production decision.
- [x] Storage uploads, visual generation and preview screenshots reserve
      capacity atomically before work starts.
- [x] Custom-domain and subdomain reservations serialize concurrent requests;
      only one can take the last slot.
- [x] Competition research checks the Growth capability before spending
      credits.
- [x] Consumed domains and subdomains are counted from live project records.
- [x] Cancelled/expired subscriptions lose paid capabilities; legacy free
      accounts are not silently capped.
- [x] The project access view exposes reasons and limits without becoming an
      authorization token.
- [x] UI disables unsupported actions and explains why.
- [x] An uninitialized project defaults to the Testing 50MB storage cap.
- [x] Expired, orphaned and already-realized holds are swept daily, with a
      dry-run mode.
- [x] Typecheck, full tests and lint pass.


## 6. A6.1 follow-up — concurrency hardening and Agent coverage

This follow-up closes the remaining M-22 gap: A6 originally checked a fresh
snapshot, but two requests could still both act on the same last unit of
capacity. The reservation layer described in §2 now makes the check and the
claim one serialized operation.

### Agent and paid-work inventory

Every path that can start paid Agent work was re-checked. There is no unguarded
background worker.

| Path | Entry point | Guard |
| --- | --- | --- |
| REST follow-up edit | `POST /api/projects/[id]/agent` → `sendProjectFollowup` | `authorizeProductionWork("buildProduction")` |
| Co-founder follow-up tool | `request_followup_edit` → `sendProjectFollowup` | Same service guard |
| REST initial build | `POST /api/projects/[id]/build` → `startProjectBuild` | Compound build/database/specialist guard |
| Co-founder build tool | `startProjectBuild` | Same service guard |
| Pipeline recovery build | `pipeline-recovery.ts` → `startProjectBuild` | Same service guard |
| REST deploy | `POST /api/projects/[id]/deploy` | `authorizeProductionWork("deploy")` + `reserveSubdomainSlot` |
| Co-founder deploy tool | `startProjectDeploy` | Same guard + reservation |
| Pipeline recovery deploy | `pipeline-recovery.ts` → `startProjectDeploy` | Same service guard + reservation |
| Follow-up stop | `POST /api/projects/[id]/agent/stop` | Stops work; starts no paid operation |
| Agent product | `authorizeAgent` / `availability.agents` | Unlaunched; the access view reports `AGENT_NOT_LAUNCHED` |

Cron/webhook jobs (subscription grants, infrastructure expiry, domain rechecks,
claim notices) do not initiate Agent runs.

### Existing-resource behavior after downgrade

Downgrades do not delete or hide what the founder already has. The access view
and the routes agree: an existing custom domain remains replaceable/removable,
an already-published project can be republished, and existing assets remain
readable. New registrations, a first deploy, new storage writes, database
provisioning and specialist work require the current plan.

### Residual notes

- A hosted image URL has no byte length at reservation time. Visual generation
  and preview screenshots reserve the 5MB ceiling and record that value as an
  estimate; an actual image above the ceiling is refused.
- Project attachments are staged before the project exists and are bounded by
  their own 2.5MB creation limit, not the infrastructure quota.
- Holds and locks are operational state. They are cleaned by TTL indexes and
  by explicit release; they are not billing evidence and must not be used as a
  ledger.

## 7. Production rollout and migration sequence

The order matters. The flag is OFF while the code deploys, migration runs
against real data, and holds are reconciled; only then is enforcement enabled.

### 7.1 Preflight

1. Take a Mongo snapshot of `subscriptions`, `projects`, `app_settings`,
   `billing_resource_locks`, `billing_resource_holds` and `business_domains`.
2. Confirm the production environment has `ENTITLEMENT_ENFORCEMENT_ENABLED=false`
   **before** deploying this build. The code default is ON.
3. Run the release gate locally/CI: `npx tsc --noEmit`, `npx vitest run`,
   `npm run lint`, `npm run build`.
4. Confirm `CRON_SECRET` is set and the cron routes are reachable.

### 7.2 Deploy with enforcement OFF

1. Deploy the build with `ENTITLEMENT_ENFORCEMENT_ENABLED=false`.
2. Verify startup created the reservation indexes:
   `billing_resource_locks_expiry_ttl`,
   `billing_resource_holds_scope_kind`,
   `billing_resource_holds_resource_kind`,
   `billing_resource_holds_expiry_ttl`.
3. Run the OFF acceptance checks: plan caps are open in the API and access
   view; the Testing 50MB storage quota still denies; credits still deny; a
   normal build/deploy still succeeds.
4. Dry-run the hold sweep:
   `GET /api/admin/billing/entitlements/resource-holds?dryRun=true`.
   It must not delete anything.

### 7.3 Migrate subscriptions

1. Dry-run: `GET /api/admin/billing/entitlements/migrate`.
   Review `scanned`, `changed`, `termsPinned`, `termsNeedsReview`, `errors`.
2. Apply: `POST /api/admin/billing/entitlements/migrate` with
   `{"mode":"apply"}`.
3. Re-run the dry-run. `changed` should be 0; remaining `termsNeedsReview`
   records stay grandfathered until an operator settles them.
4. Spot-check a Starter, Growth, Scale and one historical/annual record:
   pinned caps, monthly credits and `entitlementSource`.
5. Run the read-only finance reconciliation:
   `GET /api/admin/billing/reconciliation`.

### 7.4 Reconcile holds

1. Dry-run the hold sweep again and inspect `orphanedHolds`,
   `realizedHolds`, `expiredHolds`, `expiredLocks` and
   `remainingActiveHolds`.
2. Apply it: `POST /api/admin/billing/entitlements/resource-holds` with
   `{}`. Only genuine in-flight holds should remain.
3. Investigate any `actions` entry before enabling enforcement.

### 7.5 Enable enforcement ON

1. Set `ENTITLEMENT_ENFORCEMENT_ENABLED=true` (or remove the explicit
   `false`) and redeploy/restart every process.
2. Verify representative access views:
   Explorer planning-only; Starter no custom domain; Growth one custom domain;
   a consumed domain/subdomain shows the limit; an existing domain/URL remains
   manageable.
3. Run the ON acceptance checks: the last custom-domain and subdomain slot
   deny correctly; two concurrent claims produce one hold; storage over quota
   denies; credits still deny.

### 7.6 Monitor and rollback

Watch for 24 hours:

- 402 rate by `code` (`CUSTOM_DOMAIN_LIMIT`, `SUBDOMAIN_LIMIT`,
  `STORAGE_LIMIT_REACHED`, `INSUFFICIENT_CREDITS`);
- 409 rate (`ENTITLEMENT_BUSY`, `DOMAIN_CHANGE_IN_PROGRESS`);
- deploy/build success rate and credit refunds;
- daily hold sweep report: `orphanedHolds`, `realizedHolds`,
  `remainingActiveHolds`.

Rollback is one flag: set `ENTITLEMENT_ENFORCEMENT_ENABLED=false` and
redeploy. Plan caps fail open; the storage byte quota, credits, infrastructure
expiry and provider checks stay active. Do not delete holds as part of a
rollback; let TTL and the sweep clear them.

## 8. Operational checks

`GET|POST /api/admin/billing/entitlements/resource-holds` is the daily
maintenance endpoint (`50 3 * * *` in `vercel.json`). It:

- deletes expired locks and holds;
- releases slot holds whose project was deleted;
- releases custom-domain/subdomain holds whose real resource is already
  persisted;
- leaves storage holds for live projects until TTL, because those bytes are
  still in flight;
- returns counts and up to 100 action records, never billing evidence. In
  dry-run mode `remainingActiveHolds` is the projected count after the proposed
  actions, not the current count.

Run it with `?dryRun=true` (or POST `{"apply":false}`) before any manual
cleanup. A healthy steady state has zero orphaned/realized holds and only
short-lived in-flight holds.
