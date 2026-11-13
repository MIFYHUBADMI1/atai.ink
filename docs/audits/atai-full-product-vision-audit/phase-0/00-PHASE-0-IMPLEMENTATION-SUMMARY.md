# 00 — Phase 0 implementation summary

**Overall status: four workstreams PASS (W1–W4), W5 PARTIAL — the confirmed build-progress corpus
is fixed and guarded, but the directive's broader §8.2 user-facing copy sweep is still open.**
Engineering verification (TypeScript + production build) is recorded in
`06-PHASE-0-TEST-AND-REGRESSION-REPORT.md`, which now exists and contains the actual command
output. A production-build regression introduced by the W3 pricing change was found during that
verification and fixed.

## What was investigated

The full Phase 0 directive (payment tenant isolation, project deletion integrity, pricing
consistency, co-founder multi-turn memory, honest product messaging) was verified against the
**current working tree** before any change, per the directive's Step 1. The tree already contained
fixes landed by the main session for parts of W1 and W2, so this pass distinguished
already-fixed from confirmed-still-present rather than re-implementing blindly.

## Verification matrix (against the tree at the start of this pass)

| Workstream | Finding | State found | Action this pass |
|---|---|---|---|
| W1 — Payment isolation | S-01 | Core isolation **already fixed** (`89cdf0d`); one honesty gap remained | Fixed `pageFull` to compare against the requested page size; corrected stale payouts comment; added mapper+adapter tests |
| W2 — Deletion integrity | S-02 / D-01 | **Already fixed** (`91da59e` cascade, `fd27a30` dialogs), honest-disclosure variant | Re-verified against the tree; no re-implementation needed |
| W3 — Pricing consistency | R-01 | Authority unified, but **confirmed remnant**: manual route charged legacy while UI showed heavy | Manual route now prices with the project's pipeline mode; pricing page reads the billing authority; parity tests |
| W4 — Co-founder memory | D-02 | `/collaborate` already replayed history; **workspace surface amnesic** | Bounded, untrusted-framed history replay wired into the workspace agent; tests |
| W5 — Honest messaging | G | **Not fixed** — fabricated claims verbatim in the corpus | Rewrote every flagged bank; added honesty-guard tests; repo-wide phrase check |

## What was changed (this pass, grouped by workstream)

- **W1:** `lib/runtime/router/adapters/dodo/adapter.ts`, `mapper.ts`, `payments.test.ts`.
- **W3:** `app/api/projects/[id]/build/route.ts`, `app/pricing/page.tsx`, `lib/credits/build-pricing.test.ts` (new).
- **W4:** `app/api/cofounder/route.ts`, `lib/cofounder/agent.ts`, `lib/cofounder/conversation.ts`,
  `lib/cofounder/conversation.test.ts` (new), `lib/cofounder/agent-history.test.ts` (new).
- **W5:** `lib/build-messages.ts`, `lib/build-messages.test.ts`.
- **Reports:** `docs/audits/atai-full-product-vision-audit/phase-0/00…07`.

## Which findings were already fixed vs confirmed

- **Already fixed (verified, not re-done):** W1 core tenant isolation + payout denial + server-stamped
  attribution + deleted-project key rejection; W2 ownership-checked atomic cascade, key revocation,
  financial retention, conversation detachment, honest external-resource disclosure.
- **Confirmed and fixed this pass:** W1 `pageFull` completeness signal; W3 manual-route heavy-mode
  undercharge / displayed≠charged; W4 workspace co-founder amnesia; W5 fabricated build-progress claims.
- **Not present / no attack surface:** payment retrieval-by-ID and refund operations do not exist in
  the `atai.payments` capability, so §4.3C has nothing to bypass today.

## Workstream statuses

| Workstream | Status | Evidence |
|---|---|---|
| W1 Payment tenant isolation | **PASS** | 32 tests; report 01 |
| W2 Project deletion integrity | **PASS** | 5 deletion tests + auth/tool tests; report 02 |
| W3 Pricing consistency | **PASS** | 22 tests incl. structural parity guards; report 03 |
| W4 Co-founder multi-turn memory | **PASS** | 16 tests; report 04 |
| W5 Honest product messaging | **PARTIAL** | 19 tests incl. honesty guards; report 05 |

**Why W5 is PARTIAL, not PASS.** The confirmed build-progress corpus (finding G) is fully
remediated and guarded by tests. The directive's §8.2 also asks for a surface-by-surface sweep of
every user-facing claim — dashboard, market/growth, competition, finances, hosting, resources and
lessons, empty states, onboarding, pricing copy — and §12 makes "user-facing claims have been
reviewed" and "empty states are truthful" acceptance criteria. That sweep has **not** been done, so
W5 cannot honestly be marked PASS. It was left undone on purpose: the main session is actively
landing copy work on several of those surfaces, and a concurrent sweep would have collided with
in-flight work. The remaining sweep is recorded as open work in report 07, not hidden here.

## Verification corrections made after the first pass

Two statements in the first version of this summary were wrong and have been corrected:

1. **"Engineering verification (TypeScript + production build) recorded in `06-…`."** No such
   report existed — the file was never written. It is written now, with the actual command output.
2. **"All Phase 0 changes are uncommitted"** (report 07). They are committed: `d36bf44` (W3),
   `db2d8f3` (W4), `62affd0` (W1), `cf760df` (W5), `32e5c38` (W1–W5 reports). One further change
   was needed and is currently uncommitted — see below.

## Regression found and fixed during verification

The W3 pricing change (`d36bf44`) introduced a **production build break**: it called
`getTierCost(tier, pipelineMode)` from `lib/projects/project-actions.ts:131` without adding
`getTierCost` to the existing `@/lib/credits/credits` import, so the file no longer type-checked
(`error TS2304: Cannot find name 'getTierCost'`) and `next build` failed at the TypeCheck stage.
The pricing change itself was correct; only the import was missing. Fixed by adding `getTierCost`
to the import on line 6 — a one-line change, now uncommitted in the shared worktree. Full detail,
including the exact commands and before/after output, is in report 06.


## Database changes

**None.** No migrations, no backfills, no schema changes. The pricing authority reads existing
admin-configurable overrides; the deletion cascade and conversation store already existed. The only
ledger-facing change is a mode label in the build reservation reason string (W3).

## Remaining risks (summary — full detail in report 07)

- W1: no cursor — attributed payments older than the first raw account-wide page are unreachable
  from a project key (fails closed, disclosed via `pageFull`).
- W2: Totalum has no app-delete capability — external teardown is incomplete by design and labelled
  as such; founder must shut down hosted app/domain/subscriptions manually.
- W3: display-only client fallback tables can drift during the cost-fetch window; `TIER_COSTS` vs
  `BUILD_TIERS` naming trap; pricing page prerender needs DB reachability at build time.
- W4: history bound is character-based (not tokenizer-exact); no long-term summarization (out of scope).
- W5: the broader §8.2 every-surface copy sweep is **not done** — this is why the workstream is
  PARTIAL, not PASS. The confirmed build-progress corpus is remediated and guarded.
- Full-suite failures observed are **not** Phase 0 regressions (classification in report 06).
- Phase 0 code is **committed** (`d36bf44`, `db2d8f3`, `62affd0`, `cf760df`, `32e5c38`). The
  one-line build fix to `lib/projects/project-actions.ts` is **uncommitted** in the shared worktree
  alongside the main session's in-flight ads/market-studio work; the commit decision is left to the
  founder.