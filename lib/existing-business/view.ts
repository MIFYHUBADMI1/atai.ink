import "server-only"

/**
 * The founder-facing shape of an existing-business profile (Phase 1 Part G,
 * Phase 1.5 Part 10). Kept in one place so the intake screen, the workspace
 * panel and the co-founder all report the same three distinct states:
 *
 *   website submitted  ≠  website analyzed  ≠  domain verified
 *
 * Nothing in here invents a status: a stage that has not run reports as
 * pending/skipped/failed with the message the run actually recorded.
 */

import { toDomainView, type DomainView } from "@/lib/domain/service"
import {
  businessStartingPointOf,
  type BusinessAssessment,
  type BusinessConnectionStatus,
  type BusinessDomainDoc,
  type IntakeStageStatus,
} from "@/lib/types/business-intake"
import { CONNECTION_STATUS_LABEL, businessConnectionStatus } from "@/lib/connected-business/status"
import type { MirrorProject } from "@/lib/types/project"
import { objectiveLabel } from "./objectives"
import { intakeProgress } from "./intake"

export { intakeStatusLabel } from "./stage-labels"

export interface IntakeView {
  startingPoint: "from_scratch" | "existing_business"
  displayName?: string
  description?: string
  targetCustomers?: string
  additionalContext?: string
  objectives: Array<{ id: string; label: string }>
  overall: IntakeStageStatus
  /** The three states the spec insists stay separate. */
  website: {
    submitted: boolean
    analyzed: boolean
    url?: string
    pagesCrawled?: number
    fromCache?: boolean
    status: IntakeStageStatus
    error?: { code: string; message: string; detail?: string }
  }
  domain: {
    hostname?: string
    /** Only the domains belonging to this business, tokens included because
     * every caller of this view is session-authenticated and ownership-checked. */
    records: DomainView[]
    verified: boolean
  }
  /** Whether the founder's own application has actually reached Atai. Derived
   * from recorded calls plus domain proof — never assumed from a submitted URL. */
  connection: {
    status: BusinessConnectionStatus
    label: string
    firstSeenAt?: number
    lastSeenAt?: number
    guideIssuedAt?: number
  }
  assessment: {
    status: IntakeStageStatus
    generatedAt?: number
    error?: { code: string; message: string; detail?: string }
    /** The assessment itself, or null when it has not been produced. */
    result?: BusinessAssessment
  }
}

/** Only a failure worth showing, and only while the stage is in a failed state. */
function stageError(stage?: {
  status: IntakeStageStatus
  errorCode?: string | null
  errorMessage?: string | null
  errorDetail?: string | null
}) {
  if (!stage || (stage.status !== "failed" && stage.status !== "partially_completed")) return undefined
  if (!stage.errorCode || !stage.errorMessage) return undefined
  return {
    code: stage.errorCode,
    message: stage.errorMessage,
    ...(stage.errorDetail ? { detail: stage.errorDetail } : {}),
  }
}

export function buildIntakeView(project: MirrorProject, domains: BusinessDomainDoc[] = []): IntakeView {
  const intake = project.intake
  const startingPoint = businessStartingPointOf(project)
  const views = domains.map((doc) => toDomainView(doc, { includeToken: true }))
  const verifiedRecord = views.find((view) => view.status === "verified")
  const connectionStatus = businessConnectionStatus({
    connection: project.connection,
    domainVerified: Boolean(verifiedRecord),
  })

  return {
    startingPoint,
    ...(intake?.displayName ? { displayName: intake.displayName } : {}),
    ...(intake?.description ? { description: intake.description } : {}),
    ...(intake?.targetCustomers ? { targetCustomers: intake.targetCustomers } : {}),
    ...(intake?.additionalContext ? { additionalContext: intake.additionalContext } : {}),
    objectives: (intake?.objectives ?? []).map((id) => ({ id, label: objectiveLabel(id) })),
    overall: intakeProgress(intake).status,
    website: {
      submitted: Boolean(intake?.website?.url),
      analyzed: intake?.website?.status === "completed",
      ...(intake?.website?.url ? { url: intake.website.url } : {}),
      ...(intake?.website?.pagesCrawled !== undefined ? { pagesCrawled: intake.website.pagesCrawled } : {}),
      ...(intake?.website?.fromCache !== undefined ? { fromCache: intake.website.fromCache } : {}),
      status: intake?.website?.status ?? "skipped",
      ...(stageError(intake?.website) ? { error: stageError(intake?.website) } : {}),
    },
    connection: {
      status: connectionStatus,
      label: CONNECTION_STATUS_LABEL[connectionStatus],
      ...(project.connection?.firstSeenAt ? { firstSeenAt: project.connection.firstSeenAt } : {}),
      ...(project.connection?.lastSeenAt ? { lastSeenAt: project.connection.lastSeenAt } : {}),
      ...(project.connection?.guideIssuedAt ? { guideIssuedAt: project.connection.guideIssuedAt } : {}),
    },
    domain: {
      ...(intake?.domain?.hostname ? { hostname: intake.domain.hostname } : verifiedRecord ? { hostname: verifiedRecord.hostname } : {}),
      records: views,
      verified: Boolean(verifiedRecord),
    },
    assessment: {
      status: intake?.assessment?.status ?? "pending",
      ...(intake?.assessment?.generatedAt ? { generatedAt: intake.assessment.generatedAt } : {}),
      ...(stageError(intake?.assessment) ? { error: stageError(intake?.assessment) } : {}),
      ...(intake?.assessment?.result ? { result: intake.assessment.result } : {}),
    },
  }
}
