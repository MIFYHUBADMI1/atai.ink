import "server-only"

import { resolveObjectiveActions } from "@/lib/existing-business/objectives"
import type { BusinessObjectiveId } from "@/lib/types/business-intake"
import type { MirrorProject } from "@/lib/types/project"
import { businessBase } from "./surface"

/**
 * Growth recommendations, re-addressed to the business surface.
 *
 * The objectives engine already knows where each objective is worked on; it
 * just speaks in project routes. Rewriting the prefix is the whole adapter —
 * no second copy of the table, so a new objective automatically appears here.
 */

export interface BusinessNextMove {
  title: string
  detail: string
  href: string
  executableNow: boolean
  objective: BusinessObjectiveId
}

function segmentOf(href: string, projectId: string): string {
  const prefix = `/project/${projectId}/`
  return href.startsWith(prefix) ? href.slice(prefix.length) : ""
}

export function businessNextMoves(input: {
  project: MirrorProject
  userId: string
  businessId: string
}): BusinessNextMove[] {
  const base = businessBase(input.businessId)
  const objectives = input.project.intake?.objectives ?? []
  const actions = resolveObjectiveActions({
    projectId: input.project.id,
    userId: input.userId,
    objectives,
  })

  return actions.map((action) => ({
    title: action.label,
    detail: action.detail,
    href: base.segment(segmentOf(action.href, input.project.id)),
    executableNow: action.executableNow,
    objective: action.objective,
  }))
}

export interface BusinessPriority {
  title: string
  explanation: string
  whyItMatters: string
  expectedOutcome: string
  priority: "immediate" | "short_term" | "later"
  ataiSection: string
  /** Business-addressed target, or "" when Atai has no surface for it yet. */
  href: string
  executableNow: boolean
  needs?: string
}

/**
 * A stored horizon the current parser would not have written — a row from
 * before `priority` existed, or a hand-edited assessment. It reads as the
 * neutral horizon rather than crashing the page or claiming urgency.
 */
function horizonOf(value: unknown): BusinessPriority["priority"] {
  return value === "immediate" || value === "later" ? value : "short_term"
}

export function businessPriorities(input: { project: MirrorProject; businessId: string }): BusinessPriority[] {
  const base = businessBase(input.businessId)
  const priorities = input.project.intake?.assessment?.result?.priorities ?? []

  return priorities.map((priority) => ({
    title: priority.title,
    explanation: priority.explanation,
    whyItMatters: priority.whyItMatters,
    expectedOutcome: priority.expectedOutcome,
    priority: horizonOf(priority.priority),
    ataiSection: priority.ataiSection,
    href: priority.route ? base.segment(segmentOf(priority.route, input.project.id)) : "",
    executableNow: priority.executableNow,
    needs: priority.needs,
  }))
}
