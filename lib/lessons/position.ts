import type { MirrorProject } from "@/lib/types/project"
import { computePlanHealth } from "@/lib/analysis/plan-sections"
import { deriveBusinessStage, getStageNextSteps, type NextStep } from "@/lib/resources/business-intelligence"
import { LESSON_STAGE_META, type LessonStage } from "@/lib/lessons/types"

/**
 * The lessons position header — an honest, deterministic summary of where the
 * business stands, derived only from OBSERVED project state (never fabricated
 * and never from AI). Powers the "what you have done / where you are / what
 * remains" strip at the top of the lessons page.
 */

export interface LessonsPosition {
  stage: LessonStage
  stageLabel: string
  stageFocus: string
  /** Observed milestones already reached, in journey order. */
  done: string[]
  /** What the journey still holds after the current position. */
  remaining: string[]
  /** Top deterministic next steps for this exact state. */
  nextSteps: NextStep[]
  planPercent: number | null
  isLive: boolean
}

function observedMilestones(project: MirrorProject): { done: string[]; remaining: string[] } {
  const done: string[] = []
  const remaining: string[] = []
  const state = project.state

  if (project.idea || project.specification) done.push("Your business idea is captured.")
  else remaining.push("Capture the business idea so every lesson can be specific to it.")

  if (project.specification) {
    done.push("Your application plan is written.")
  } else if (state !== "created") {
    remaining.push("Write the plan — every lesson gets sharper with one.")
  } else {
    remaining.push("Write the plan when you are ready.")
  }

  const builtStates = new Set(["build_complete", "ready", "deploying", "deployed", "deployment_failed"])
  if (builtStates.has(state)) done.push("The first version of your product is built.")

  if (state === "deployed") {
    done.push("Your app is live in production.")
    remaining.push("Turn the live app into a business: users, feedback, revenue, growth.")
  } else if (builtStates.has(state)) {
    remaining.push("Deploy so real people can reach your product.")
  } else if (state !== "created") {
    remaining.push("Build and launch the product.")
  }

  return { done, remaining }
}

export function buildLessonsPosition(project: MirrorProject): LessonsPosition {
  const stage = deriveBusinessStage(project.state)
  const meta = LESSON_STAGE_META[stage]
  const { done, remaining } = observedMilestones(project)
  return {
    stage,
    stageLabel: meta.label,
    stageFocus: meta.focus,
    done,
    remaining,
    nextSteps: getStageNextSteps(project.state, project.specification).slice(0, 3),
    planPercent: project.specification ? computePlanHealth(project.specification).percent : null,
    isLive: project.state === "deployed",
  }
}
