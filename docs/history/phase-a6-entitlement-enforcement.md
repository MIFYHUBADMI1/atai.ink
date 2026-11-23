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
  and returns `{ usedBytes, limitBytes, withinLimit }`.
- `refreshProjectStorageUsage(projectId)` — persists the observation and
  `overQuota` for the infrastructure UI.
- `checkStorageLimit(projectId)` — the existing quota helper now uses observed
  bytes.

Asset upload checks the plan, then the quota, before reading the file into
memory or taking an AI lease, and refreshes usage after a successful write.
Visual generation checks the plan and refuses when the project is already at
its limit.

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
- **Storage** — real byte sum, over-quota observation, no-infrastructure
  unlimited view, persisted usage, upload denial before reading bytes, quota
  denial, refresh after upload.
- **Follow-up edits** — a plan without production changes is refused before a
  message or build run is written.
- **Terminated subscriptions** — cancelled paid accounts fall back to Explorer;
  legacy free accounts keep their existing capability.

Validation run:

```text
npx tsc --noEmit            # pass
npx vitest run              # 319 files, 3883 passed, 2 todo (3885 total)
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
- [x] Storage uploads and visual generation check the plan and the observed
      quota before work starts.
- [x] Competition research checks the Growth capability before spending
      credits.
- [x] Consumed domains and subdomains are counted from live project records.
- [x] Cancelled/expired subscriptions lose paid capabilities; legacy free
      accounts are not silently capped.
- [x] The project access view exposes reasons and limits without becoming an
      authorization token.
- [x] UI disables unsupported actions and explains why.
- [x] Typecheck, full tests and lint pass.
