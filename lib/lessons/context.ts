import { createHash } from "crypto"
import type { MirrorProject } from "@/lib/types/project"
import type { UserOnboarding } from "@/lib/types/db"
import { computePlanHealth, readCombinedMarketingPlan, readMarketPositioningText } from "@/lib/analysis/plan-sections"
import { deriveBusinessStage, getStageNextSteps, type NextStep } from "@/lib/resources/business-intelligence"
import type { ApplicationSpecification } from "@/lib/types/specification"
import type { GeneratedLessonSnapshot, LessonStage } from "@/lib/lessons/types"

/**
 * Lesson context assembly — everything the generator and the position header
 * need, derived FREE from observed project state. No AI calls, no guesses:
 * every field is read off the project document or computed deterministically.
 */

export interface LessonContext {
  stage: LessonStage
  state: string
  businessName: string
  hasSpec: boolean
  planPercent: number | null
  businessType: string
  description: string
  targetUsers: string[]
  businessModel: string
  revenueModel: string
  positioning: string
  marketingPlan: string
  idea: string
  onboarding: {
    businessGoal?: string
    revenueTarget?: string
    targetUsers?: string
    intent?: string
  }
  nextSteps: NextStep[]
  /** Bounded prompt-ready summary of the context (the generator's input). */
  fingerprint: string
}

/** Prompt budget for the combined marketing plan — context, not a copy source. */
const MARKETING_PLAN_PROMPT_MAX = 2400

/**
 * Stable fingerprint of everything the lessons were written against: the
 * project state plus the FULL specification. Any plan edit or state change
 * produces a different fingerprint, which is what marks a pack stale. Never
 * stored anywhere but on the generated lessons themselves.
 */
export function lessonContextFingerprint(project: Pick<MirrorProject, "state" | "specification">): string {
  return createHash("sha256")
    .update(`${project.state}::${JSON.stringify(project.specification ?? null)}`)
    .digest("hex")
}

export function lessonSnapshot(project: MirrorProject): GeneratedLessonSnapshot {
  const spec = project.specification
  return {
    state: project.state,
    stage: deriveBusinessStage(project.state),
    planPercent: spec ? computePlanHealth(spec).percent : null,
  }
}

export function assembleLessonContext(
  project: MirrorProject,
  onboarding?: UserOnboarding | null,
): LessonContext {
  const spec: ApplicationSpecification | undefined = project.specification
  const stage = deriveBusinessStage(project.state)
  const planPercent = spec ? computePlanHealth(spec).percent : null

  const marketingPlan = spec ? readCombinedMarketingPlan(spec).slice(0, MARKETING_PLAN_PROMPT_MAX) : ""
  const positioning = spec ? readMarketPositioningText(spec) : ""

  const nextSteps = getStageNextSteps(project.state, spec).slice(0, 4)

  return {
    stage,
    state: project.state,
    businessName: spec?.title || project.name,
    hasSpec: Boolean(spec),
    planPercent,
    businessType: spec?.applicationType || "",
    description: spec?.description || spec?.purpose || project.idea || "",
    targetUsers: spec?.targetUsers ?? [],
    businessModel: spec?.businessModel || "",
    revenueModel: spec?.revenueModel || "",
    positioning,
    marketingPlan,
    idea: project.idea || "",
    onboarding: {
      businessGoal: onboarding?.businessGoal,
      revenueTarget: onboarding?.revenueTarget,
      targetUsers: onboarding?.targetUsers,
      intent: onboarding?.intent,
    },
    nextSteps,
    fingerprint: lessonContextFingerprint(project),
  }
}
