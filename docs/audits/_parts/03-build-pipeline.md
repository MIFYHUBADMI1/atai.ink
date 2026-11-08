# Atai — Build Pipeline / Functional Validation (03)

## Scope & method
Read-only source audit of the plan→build→deploy→deliver pipeline at C:\Users\USER\Desktop\mirrorsiteai. Engine is external Totalum VCaaS (lib/integrations/totalum/*). No real builds/deploy calls made. Findings appended incrementally. ~26.9k LOC; focused on the 7 pipeline hops.

## Journey table
| Hop | Status | Evidence | What breaks it |
|-----|--------|----------|----------------|
| 1 Intake (/start, composer) | partially implemented (pending detail) | pipeline.ts runScratch/runWebsite entry | pending |
| 2 Analysis/planning | works-under-conditions | pipeline.ts:187-418; markPipelineFailure:49 | needs Firecrawl+OpenRouter keys; heavy mode via orchestrator |
| 3 Approval→build handoff | partially implemented / state-machine mismatch | build route accepts spec_ready; Collaborate LaunchButton only plan_ready | heavy/fork/recovered projects land in `specification_ready`, auto-navigated to Collaborate with NO build CTA |
| 4 Build execution (Totalum) | works-only-under-conditions | project-actions.ts:101; pipeline.ts:73; status route polls | needs TOTALUM_API_KEY; success/failure derived from real provider status |
| 5 Delivered artifact (URL) | partially implemented | status route, deploymentUrl | pending detail |
| 6 Runtime capabilities | mostly declared-only | (pending) | OpenRouter has no purchased credits → paid caps blocked |
| 7 Post-launch editing | works-under-conditions | project-actions.ts:203 | pending caps/credit-mid-edit |

## Confirmed findings

### PIPE-01 — `specification_ready` projects are auto-redirected to Collaborate, which has no build button (P1, launch blocker for heavy/fork/recovered flows)
Three build-entry surfaces disagree on which states they accept:
- Collaborate `LaunchButton` renders ONLY when `state === "plan_ready"` (`app/project/[projectId]/collaborate/collaborate-client.tsx:2650` `if (state !== "plan_ready") return null`), and posts to `/api/projects/[id]/launch`.
- `/launch` accepts only `["plan_ready","awaiting_build_confirmation"]` and 409s `specification_ready` (`app/api/projects/[id]/launch/route.ts:32`).
- `/build` has NO state gate beyond rejecting building/deploying (`app/api/projects/[id]/build/route.ts:47-49`), and the workspace "Start building" CTA targets `specification_ready`/`awaiting_build_confirmation`/`analysis_complete` (`lib/workspace/workspace-view-model.ts:318-330`, mutation "build" → posts `/build`, `components/workspace/operating-room.tsx:166`).

But projects DO reach `specification_ready`:
- heavy-mode planning orchestrator (`lib/planning/orchestrator.ts:338,639`),
- fork (`app/api/projects/[id]/fork/route.ts:157`),
- orphaned-build recovery: a build that lost its `totalumProjectId` is reset to `specification_ready` (`app/api/projects/[id]/status/route.ts:128-145`).

`components/workspace/operating-room.tsx:93,111` auto-navigates the founder to `/collaborate` on `plan_ready` **OR** `specification_ready` (once, on transition). So a founder whose project is in `specification_ready` is pushed onto the Collaborate page where the only build CTA is hidden → they see the plan with no "Submit & build" button. The build is still reachable by navigating back to the workspace root (`/project/{id}`), which shows "Start building". Net: not a hard dead-end, but a redirect-into-a-dead-page that strands non-technical founders mid-launch.
Fix: make Collaborate's LaunchButton + `/launch` accept `specification_ready`/`awaiting_build_confirmation` too (align the state set across all three surfaces), OR stop auto-redirecting `specification_ready` to Collaborate. Right fix: align the gate — the engine already builds fine from `specification_ready` via `/build`.

## Runtime capability reality check
(pending)

## What I could not verify
(pending)

## Areas verified sound
(pending)
