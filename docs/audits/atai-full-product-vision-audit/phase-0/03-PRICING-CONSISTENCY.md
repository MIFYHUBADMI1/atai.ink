# 03 — Pricing consistency (R-01)

**Status: PASS — one authority, both build paths and both display surfaces read it.**

## Pricing-flow map (as verified, then as fixed)

| Flow | Displayed price | Charged price | Match? |
|---|---|---|---|
| Public pricing page (`app/pricing/page.tsx`) | **Before:** static `BUILD_TIERS` + hardcoded "500 credits" publish line. **After:** `getBuildTierCosts()` / `getDeploymentCosts()` from the billing authority (`:257-266`) | n/a | After: yes, and admin overrides now show |
| Workspace Build button (legacy mode) | `buildCost(tier, project.pipelineMode)` ← `GET /api/credit-costs` → `getTierCost(tier,"legacy")` | manual route `getTierCost(tier, mode)` | yes |
| Workspace Build button (heavy mode) | same, `getTierCost(tier,"heavy")` | same | yes — **this was the R-01 remnant** |
| Manual build route | — | `getTierCost(tier, project.pipelineMode ?? "legacy")` (`app/api/projects/[id]/build/route.ts:75-80`) | yes |
| Automatic pipeline | — | `getTierCost(tier, pipelineMode)` (`lib/analysis/pipeline.ts:134-135`) | yes |
| Reservation | reason string labels the mode (`build/route.ts:115-116`) | same number reserved | yes |
| Failed build | n/a | reservation released/refunded | unchanged, covered by existing reservation/refund tests |
| Runtime capabilities | `/api/credit-costs` | `lib/runtime/metering/resolver.ts` (admin rule → legacy → deny 503) | separate domain, left separate per §6.7 note |

## The confirmed remnant and the fix

`getBuildCost(tier)` (legacy-only) was still the charge on the **manual** build route, while the
automatic pipeline priced with `getTierCost(tier, project.pipelineMode)` and the Build button
displayed the heavy-aware number. Since new projects default to heavy
(`lib/projects/create-project.ts`), a heavy complex project showed **133,333** credits and was
charged the legacy **100,000** — an undercharge, but more importantly displayed ≠ charged, which
is exactly what §6.1 forbids.

Fix: the manual route now derives mode from the project and calls the same authority as the
pipeline, and the ledger reason names the mode so the charge is self-explaining on audit. The
client no longer imports a second cost table for this path; the numbers it shows come from
`/api/credit-costs`, which itself calls `getTierCost` (`app/api/credit-costs/route.ts:31-41`).

## Authoritative pricing source

`lib/credits/credits.ts` → `getTierCost(tier, pipelineMode)`:

1. Base = `getBuildTierCosts()` (`lib/billing/runtime-config.ts:337-340`) — the admin-configurable
   DB override layered over the `BUILD_TIERS` code defaults (50k / 75k / 100k).
2. Heavy mode scales that base by the documented default ratio from `HEAVY_TIER_COSTS` ÷
   `TIER_COSTS` = ×2 / ×1.5 / ×1.333, so an admin override moves legacy and heavy together
   instead of silently desynchronising them.
3. A client cannot send a multiplier, a tier, or a credit amount; the tier comes from the stored
   specification and the mode from the stored project.

## Heavy-mode decision (§6.4)

**Kept, explicitly priced, not silently retired.** Heavy genuinely costs more downstream (admin
console, user management, analytics capabilities in the generated app), users can see which mode
their project is in, the display includes the modifier, the reservation and the charge use the
same call, and the multiplier is server-derived. Nothing in this change alters what any existing
user is charged for a build they already started — reservations settle against the amount they
reserved.

## Credit-ledger protection

Untouched: subscription-before-permanent consumption, expiry rules, reservation idempotency keys,
refund paths. The only change to a ledger-facing string is the mode label in the reservation
reason. No second accounting mechanism was introduced and no pricing snapshot schema changed.

## Tests — `lib/credits/build-pricing.test.ts` (22)

`getTierCost` math for both modes and all tiers, override layering (admin value moves legacy and
heavy together), clamp/normalisation of bad tiers, plus **structural parity guards**: the manual
route and the pipeline must resolve cost through the same function with the same arguments, and
the pricing page must read from the billing authority rather than re-deriving numbers. A repeat
of R-01 fails the suite rather than passing code review.

## Remaining limitations

- `lib/client/build-costs.ts` keeps `FALLBACK_*` tables for the loading/unavailable window. They
  are display-only and mirror current server defaults, but they *can* drift from an admin
  override while the fetch is pending; the server always re-checks the real cost at launch.
- Naming trap worth a follow-up: `TIER_COSTS` in `credits.ts` (25k/50k/75k) is **not** the
  charging default — it exists as the heavy-mode ratio baseline. `BUILD_TIERS` is the default.
  Two similarly-named tables with different roles is how R-01 happened in the first place.
- The pricing page now performs billing-config reads during render, so prerendering requires the
  database to be reachable at build time (already the pattern for other pages, and one of the
  three CI gates).
