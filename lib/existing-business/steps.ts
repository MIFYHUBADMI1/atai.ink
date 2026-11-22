import type { DomainView } from "@/lib/domain/service"
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

/**
 * Addresses the founder added but has not proved. Each one reserves a hostname
 * for 72 hours, so leaving it behind is not harmless bookkeeping: nobody else
 * can connect that site while it waits. Proving one address does not settle the
 * others — the domain step is finished only when every address is proved or
 * removed.
 */
export function unresolvedDomainClaims(records: DomainView[]): DomainView[] {
  return records.filter((record) => record.status !== "verified" && record.status !== "revoked")
}

export function businessSteps(view: IntakeView): BusinessSteps {
  const unresolved = unresolvedDomainClaims(view.domain.records)
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
      requirement:
        "Add the meta tag or file Atai gives you, then press Check. Every address you add has to be proved or removed.",
      done: view.domain.verified && unresolved.length === 0,
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
