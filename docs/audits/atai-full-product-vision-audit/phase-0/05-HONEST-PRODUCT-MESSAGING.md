# 05 — Honest product messaging (G)

**Status: PASS for the confirmed build-progress corpus — fabricated claims removed, honesty guards added, tested.**

## Unsupported claims discovered (audit finding G)

The build-progress commentary (`lib/build-messages.ts`, surfaced live by
`components/build/build-stage-overlay.tsx`) narrated work as completed fact that the platform never
performed. The audit-named claims, verified verbatim in the tree before this pass:

| Former claim | Bank | Why it was false |
|---|---|---|
| "tested … with **200 real users**" | RESEARCH_INSIGHTS | No real users were recruited or tested. |
| "modeled … **unit economics — profitable at scale**" | BUSINESS_STRATEGY | No unit-economics model was run; a profit outcome was guaranteed. |
| "**war-gamed** … against every known competitor" | BUSINESS_STRATEGY | No competitor war-gaming was performed. |
| "validated" demand / completed market validation | RESEARCH_INSIGHTS / TEAM_COORDINATION | Validation was asserted, not executed. |
| fake usability-study counts, "exceeds every category" | PRODUCT_CRAFT | Invented study and a categorical superiority guarantee. |
| fabricated uptime SLA, measured load-time gain | ENGINEERING_EXCELLENCE | Numbers presented as measured results that were never measured. |
| scalability guarantee, achieved Lighthouse result, live-testing claim, "zero single points of failure" | DEPLOY | Outcomes asserted before any deployment/monitoring existed. |
| fake edge-case counts, achieved "zero warnings", comparative benchmark, absolute chaos-recovery | TESTING | Completed-test claims for tests not run. |
| three made-up statistics presented as fact | FUN_FACTS | Invented figures. |
| competitive-pricing research claim, live card-testing guarantee, fake leak count | MONETIZATION | Research/live-testing/security outcomes never performed. |

## Changes made

Every bank above was rewritten in place. The replacement philosophy follows §8.3/§8.4: describe the
**actual operation in progress** or an explicitly-labelled hypothesis/estimate, never a completed
measurement or a guaranteed outcome. Examples of the new framing:

- RESEARCH_INSIGHTS: "assumptions written down, not guessed"; "real interviews come after launch,
  not before"; "hypotheses to test, not numbers to promise"; "a direction to explore, not a forecast
  to bank on".
- BUSINESS_STRATEGY: "sketching … unit economics — a model to test with real sales, not a profit
  promise"; "scenarios to explore, not a revenue forecast"; "a direction, not a guarantee".
- PRODUCT_CRAFT: "real user testing follows once it is live"; "holding the bar high, category by
  category" (no categorical superiority claim).
- ENGINEERING_EXCELLENCE: "defense in depth, not a breach promise"; "every millisecond earned, not
  assumed".
- DEPLOY: "being configured to scale gracefully"; "Lighthouse scores are being chased into the
  green"; "fewer single points of failure" (was "zero").
- TESTING: "Working toward zero critical warnings"; "the goal is better than most shipped apps";
  "building the recovery paths that matter" (no achieved/absolute claim).
- MONETIZATION: "a plan to test against the market once live"; "test mode first, live cards only
  once you say so" (no live-card guarantee, no leak count).

**Voice preserved.** The playful, named-squad craft voice stays (Research/Product/Engineering/
Launch squads, never "the AI" or a first-person "we"). Corpus size is preserved — the existing
guards still require >3,000 distinct messages and >5,000 words so a long build never repeats. No
fabricated claim was replaced with a more polished fabricated claim.

## New messaging principles applied

- Verified activity → only when the operation genuinely occurs.
- Recommendation / hypothesis → labelled as something to test, not a done deal.
- Estimate / projection → labelled as a scenario or direction, not a forecast to bank on.
- Not-yet-available → "after launch", "once it is live", "test mode first" instead of invented results.

## Tests and verification

`lib/build-messages.test.ts` — **19 tests, all green**:
- Existing corpus guards: size (>3,000 messages), word floor (>5,000), named-squad voice (no
  "the AI"/"we"/"our"/"us"/"I"), per-stage vocabulary, wrap-around, project naming, stage resolution.
- **New honesty guards** (the audit's §8.8 static checks): 10 forbidden-pattern guards covering
  fabricated user/test/interview counts, invented research speed and throughput, competitor
  war-gaming, profit/revenue outcome guarantees, invented market sizing (TAM/$B), invented uptime/SLA
  figures and "zero single points of failure", claimed completed live testing, unrun benchmarks, and
  the specific unverifiable phrases ("200 real users", "closed two leaks", "47 times", "3 days on").
  Plus a guard keeping the three audit-named sentences out of the corpus for good.

**Repo-wide manual review:** a grep across all `*.ts`/`*.tsx` for the audit-named phrases
(`200 real users`, `war-gamed`, `profitable at scale`, `unit economics — profitable`,
`exceeds every category`, `zero single points of failure`) returns matches **only inside the test
guard's forbidden-pattern list** — zero occurrences in product copy.

## Scope honesty / remaining unsupported claims

This pass remediated the **confirmed G finding**: the build-progress corpus. The directive's §8.2
also asks for a sweep of every user-facing surface (dashboard, market/growth, competition, finances,
hosting, resources/lessons, empty states, onboarding, pricing copy). That broader sweep is **not
claimed as complete here**. Relevant context:

- The main session has been landing honest-messaging work on other surfaces separately (e.g.
  `82adea6` market-page guide with "honest limits", `c718948` sidebar "Soon" only for genuinely
  soon items). Those are outside this side chat's additive Phase 0 scope and were left untouched.
- The pricing page's hardcoded "500 credits" publish copy was addressed under W3 (report 03) by
  reading the billing authority instead of static numbers.

A full §8.2 surface-by-surface copy audit is recorded as remaining work in
`07-PHASE-0-REMAINING-RISKS.md` rather than hidden inside this PASS.