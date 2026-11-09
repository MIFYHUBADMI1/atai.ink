import { describe, expect, it } from "vitest"
import type { Project } from "@/lib/types/project"
import {
  buildJourneySteps,
  buildWorkspaceView,
  failedJourneyStep,
  journeyPhase,
  workspaceBrief,
  workspaceIsLive,
  workspaceNextStep,
} from "./workspace-view-model"

function project(partial: Partial<Project>): Project {
  return {
    id: "p1",
    userId: "u1",
    mode: "scratch",
    name: "MarketFlow",
    state: "created",
    events: [],
    conversation: [],
    deployment: { id: "d", status: "idle", updatedAt: 0 },
    deploymentHistory: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

describe("workspace view model", () => {
  it("maps persisted states onto founder journey phases", () => {
    expect(journeyPhase("analyzing")).toBe("understand")
    expect(journeyPhase("plan_ready")).toBe("plan")
    expect(journeyPhase("building")).toBe("build")
    expect(journeyPhase("ready")).toBe("validate")
    expect(journeyPhase("deployed")).toBe("launch")
    expect(journeyPhase("build_failed")).toBe("build")
  })

  it("marks analysis, build, and deploy as live work", () => {
    expect(workspaceIsLive("analyzing")).toBe(true)
    expect(workspaceIsLive("building")).toBe(true)
    expect(workspaceIsLive("deploying")).toBe(true)
    expect(workspaceIsLive("ready")).toBe(false)
  })

  it("uses mode-aware research copy", () => {
    expect(workspaceBrief("analyzing", "scratch").headline).toMatch(/idea/i)
    expect(workspaceBrief("analyzing", "github").headline).toMatch(/codebase/i)
    expect(workspaceBrief("analyzing", "website").headline).toMatch(/reference site/i)
  })

  it("asks the founder to review the plan without implying a redirect", () => {
    const next = workspaceNextStep("plan_ready", "p1", false)
    expect(next.needsYou).toBe(true)
    expect(next.href).toBe("/project/p1/collaborate")
    expect(next.mutation).toBeNull()
  })

  it("offers one start-build mutation before the first build", () => {
    const next = workspaceNextStep("specification_ready", "p1", false)
    expect(next.mutation).toBe("build")
    expect(next.actionLabel).toBe("Start building")
  })

  it("does not treat optional GitHub as a blocker", () => {
    const view = buildWorkspaceView(project({ state: "ready", totalumProjectId: "t1", developmentUrl: "https://app.example" }))
    const github = view.capabilities.find((c) => c.id === "github")
    expect(github?.status).toBe("optional")
    expect(github?.detail).toBe("Not connected")
    expect(view.next.kind).toBe("launch")
  })

  it("does not ask to launch when production is already live", () => {
    const view = buildWorkspaceView(project({
      state: "ready",
      totalumProjectId: "t1",
      developmentUrl: "https://preview.example",
      deployment: { id: "d", status: "success", productionUrl: "https://live.example", updatedAt: 1 },
      deploymentHistory: [{ id: "h1", startedAt: 1, status: "success", productionUrl: "https://live.example" }],
    }))
    expect(view.next.kind).toBe("grow")
    expect(view.next.kicker).not.toMatch(/launch/i)
    expect(view.canLaunch).toBe(false)
    expect(view.productionUrl).toBe("https://live.example")
    expect(view.phase).toBe("launch")
    expect(view.brief.headline).toMatch(/live/i)
  })

  it("attributes each failure to the step that failed", () => {
    expect(failedJourneyStep("analysis_failed")).toBe("understand")
    expect(failedJourneyStep("plan_failed")).toBe("plan")
    expect(failedJourneyStep("build_failed")).toBe("build")
    expect(failedJourneyStep("deployment_failed")).toBe("launch")
    expect(failedJourneyStep("plan_ready")).toBeNull()

    expect(workspaceNextStep("analysis_failed", "p1", false).mutation).toBe("retry_analysis")
    expect(workspaceNextStep("plan_failed", "p1", false).mutation).toBe("retry_plan")
  })

  it("treats pending_plan as the planning step", () => {
    expect(journeyPhase("pending_plan")).toBe("plan")
  })

  it("keeps analysis_complete in the plan step while it is still working", () => {
    expect(journeyPhase("analysis_complete")).toBe("plan")
    expect(workspaceIsLive("analysis_complete")).toBe(true)
    const steps = buildJourneySteps(
      project({
        mode: "website",
        state: "analysis_complete",
        updatedAt: 1_000,
        events: [{ id: "e1", at: 1_000, level: "info", stage: "understand", message: "Understood" }],
      }),
      30_000,
    )
    expect(steps.find((step) => step.id === "understand")!.status).toBe("completed")
    expect(steps.find((step) => step.id === "plan")!.status).toBe("at_work")
  })

  it("marks the failed step as needing attention with its own retry", () => {
    const steps = buildJourneySteps(
      project({
        state: "plan_failed",
        error: "We couldn't finish your plan.",
        updatedAt: 10,
        events: [],
      }),
      20,
    )
    const plan = steps.find((step) => step.id === "plan")!
    expect(plan.status).toBe("needs_attention")
    expect(plan.action).toEqual({ label: "Retry planning", mutation: "retry_plan", restart: false })
    expect(plan.detail).toMatch(/plan/i)
    expect(steps.find((step) => step.id === "understand")!.status).toBe("completed")
  })

  it("flags a running step that has gone quiet past its window", () => {
    const now = 60 * 60_000
    const lastActivity = now - 30 * 60_000
    const steps = buildJourneySteps(
      project({
        mode: "website",
        state: "analyzing",
        updatedAt: lastActivity,
        pipelineRecovery: { phase: "understand", attempts: 1, lastAttemptAt: lastActivity },
        events: [
          { id: "e1", at: lastActivity, level: "info", stage: "analyze", message: "Reading pages" },
        ],
      }),
      now,
    )
    const understand = steps.find((step) => step.id === "understand")!
    expect(understand.status).toBe("at_work")
    expect(understand.detail).toBe("Reading pages")
    expect(understand.elapsedMs).toBe(30 * 60_000)
    expect(understand.stalled).toBe(true)
    expect(understand.action).toEqual({ label: "Restart this step", mutation: "retry_analysis", restart: true })
    expect(understand.attempts).toBe(1)
  })

  it("does not flag a freshly started step as stalled", () => {
    const now = 60_000
    const steps = buildJourneySteps(
      project({
        mode: "website",
        state: "analyzing",
        updatedAt: now - 5_000,
        events: [{ id: "e1", at: now - 5_000, level: "info", stage: "analyze", message: "Crawling" }],
      }),
      now,
    )
    const understand = steps.find((step) => step.id === "understand")!
    expect(understand.stalled).toBe(false)
    expect(understand.action).toBeNull()
  })

  it("treats idea-only analysis as plan work", () => {
    const now = 120_000
    const steps = buildJourneySteps(
      project({
        mode: "scratch",
        state: "analyzing",
        updatedAt: now - 1_000,
        events: [{ id: "e1", at: now - 1_000, level: "info", stage: "specify", message: "Drafting the plan" }],
      }),
      now,
    )
    expect(steps.find((step) => step.id === "understand")!.status).toBe("completed")
    expect(steps.find((step) => step.id === "plan")!.status).toBe("at_work")
    expect(steps.find((step) => step.id === "plan")!.detail).toBe("Drafting the plan")
  })
})
