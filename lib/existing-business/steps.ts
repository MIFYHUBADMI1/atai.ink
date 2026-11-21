import type { TourTargetId } from "@/lib/tour/targets"
import type { IntakeView } from "./view"

/**
 * The business profile is walked one step at a time: the founder only sees the
 * step they are on, and the next one appears once the current one is finished
 * and verified. Ordering is the real dependency chain — the connection cannot
 * count as verified without domain proof, and both build on the assessment the
 * intake already produced.
 */

export type BusinessStepId = "assessment" | "domain" | "connection"

export interface BusinessStep {
  id: BusinessStepId
  title: string
  /** What finishing this step actually requires — one sentence. */
  requirement: string
  done: boolean
  tour: TourTargetId
}

export interface BusinessSteps {
  steps: BusinessStep[]
  /** Index of the first unfinished step, or -1 when every step is done. */
  current: number
}

export function businessSteps(view: IntakeView): BusinessSteps {
  const steps: BusinessStep[] = [
    {
      id: "assessment",
      title: "Your co-founder's first read",
      requirement: "Atai reads your website, then your co-founder writes the first assessment.",
      done: Boolean(view.assessment.result),
      tour: "existing-business-assessment",
    },
    {
      id: "domain",
      title: "Prove the website is yours",
      requirement: "Add the meta tag or file Atai gives you, then press Check.",
      done: view.domain.verified,
      tour: "existing-business-domains",
    },
    {
      id: "connection",
      title: "Connect your application",
      requirement: "Issue a connection key, then let your app call Atai once.",
      done: view.connection.status === "verified",
      tour: "existing-business-connection",
    },
  ]

  return { steps, current: steps.findIndex((step) => !step.done) }
}
