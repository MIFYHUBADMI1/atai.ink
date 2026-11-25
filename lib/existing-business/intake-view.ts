import type { IntakeView } from "./view"
import type {
  AssessmentFailureReason,
  BusinessAssessment,
  BusinessConnectionStatus,
  IntakeStageStatus,
} from "@/lib/types/business-intake"

/**
 * Coerce whatever the browser was handed into a complete `IntakeView`.
 *
 * The server builds a full view (`buildIntakeView`), but the client also accepts
 * views from a poll and from a start response. A partial or older payload must
 * not replace a good view and crash the next render — every `setView` therefore
 * runs through here. Missing arrays become `[]`, an unknown status becomes the
 * neutral one, and a partial assessment result is filled out so `AssessmentReport`
 * never reads `undefined.length`.
 *
 * This module is imported by a Client Component, so it must stay free of
 * `server-only` and of runtime imports from server modules.
 *
 * @module lib/existing-business/intake-view
 */

const STAGE_STATUSES: readonly IntakeStageStatus[] = [
  "pending",
  "processing",
  "completed",
  "partially_completed",
  "failed",
  "skipped",
]

const CONNECTION_STATUSES: readonly BusinessConnectionStatus[] = [
  "not_connected",
  "guide_issued",
  "awaiting_app",
  "awaiting_domain",
  "verified",
  "stale",
  "revoked",
]

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function stageStatus(value: unknown, fallback: IntakeStageStatus = "pending"): IntakeStageStatus {
  return typeof value === "string" && (STAGE_STATUSES as readonly string[]).includes(value)
    ? (value as IntakeStageStatus)
    : fallback
}

function connectionStatus(value: unknown): BusinessConnectionStatus {
  return typeof value === "string" && (CONNECTION_STATUSES as readonly string[]).includes(value)
    ? (value as BusinessConnectionStatus)
    : "not_connected"
}

function stageError(value: unknown): IntakeView["assessment"]["error"] | undefined {
  const error = record(value)
  if (typeof error.code !== "string" || typeof error.message !== "string") return undefined
  return {
    code: error.code,
    message: error.message,
    ...(typeof error.detail === "string" ? { detail: error.detail } : {}),
    ...(typeof error.reason === "string" ? { reason: error.reason as AssessmentFailureReason } : {}),
  }
}

/** Fill a stored (possibly older or partial) assessment result into the shape
 * the report renders, without inventing findings. `undefined` means the value
 * was not an object at all. */
export function completeAssessmentResult(value: unknown): BusinessAssessment | undefined {
  if (!value || typeof value !== "object") return undefined
  const result = record(value)
  const evidence = record(result.evidence)
  return {
    generatedAt: typeof result.generatedAt === "number" ? result.generatedAt : 0,
    evidence: {
      websiteAnalysed: evidence.websiteAnalysed === true,
      pagesCrawled: typeof evidence.pagesCrawled === "number" ? evidence.pagesCrawled : 0,
      ownerDescription: evidence.ownerDescription === true,
      domainVerified: evidence.domainVerified === true,
    },
    understanding: typeof result.understanding === "string" ? result.understanding : "",
    currentPosition: typeof result.currentPosition === "string" ? result.currentPosition : "",
    strengths: list(result.strengths),
    challenges: list(result.challenges),
    growthOpportunities: list(result.growthOpportunities),
    technicalOpportunities: list(result.technicalOpportunities),
    marketingOpportunities: list(result.marketingOpportunities),
    priorities: list(result.priorities),
    actionPlan: list(result.actionPlan),
    openQuestions: list(result.openQuestions),
  }
}

function completeAssessment(value: unknown): IntakeView["assessment"] {
  const assessment = record(value)
  const result = completeAssessmentResult(assessment.result)
  const error = stageError(assessment.error)
  return {
    status: stageStatus(assessment.status),
    ...(typeof assessment.generatedAt === "number" ? { generatedAt: assessment.generatedAt } : {}),
    ...(assessment.engine && typeof assessment.engine === "object"
      ? { engine: assessment.engine as IntakeView["assessment"]["engine"] }
      : {}),
    ...(error ? { error } : {}),
    ...(result ? { result } : {}),
  }
}

export function completeIntakeView(value: unknown): IntakeView {
  const view = record(value)
  const website = record(view.website)
  const claim = record(view.claim)
  const domain = record(view.domain)
  const connection = record(view.connection)
  const websiteError = stageError(website.error)

  return {
    startingPoint: view.startingPoint === "existing_business" ? "existing_business" : "from_scratch",
    ...(typeof view.displayName === "string" ? { displayName: view.displayName } : {}),
    ...(typeof view.description === "string" ? { description: view.description } : {}),
    ...(typeof view.targetCustomers === "string" ? { targetCustomers: view.targetCustomers } : {}),
    ...(typeof view.additionalContext === "string" ? { additionalContext: view.additionalContext } : {}),
    objectives: list<Record<string, unknown>>(view.objectives)
      .filter((objective) => typeof objective?.id === "string")
      .map((objective) => ({
        id: String(objective.id),
        label: typeof objective.label === "string" ? objective.label : String(objective.id),
      })),
    overall: stageStatus(view.overall),
    website: {
      submitted: website.submitted === true,
      analyzed: website.analyzed === true,
      ...(typeof website.url === "string" ? { url: website.url } : {}),
      ...(typeof website.pagesCrawled === "number" ? { pagesCrawled: website.pagesCrawled } : {}),
      ...(typeof website.fromCache === "boolean" ? { fromCache: website.fromCache } : {}),
      status: stageStatus(website.status, "skipped"),
      ...(websiteError ? { error: websiteError } : {}),
    },
    claim: {
      ...(typeof claim.hostname === "string" ? { hostname: claim.hostname } : {}),
      state: claim.state === "yours" || claim.state === "held_by_other" ? claim.state : "unclaimed",
    },
    domain: {
      ...(typeof domain.hostname === "string" ? { hostname: domain.hostname } : {}),
      records: list<IntakeView["domain"]["records"][number]>(domain.records).filter(
        (row) => row && typeof row === "object" && typeof row.id === "string",
      ),
      verified: domain.verified === true,
    },
    connection: {
      status: connectionStatus(connection.status),
      label: typeof connection.label === "string" ? connection.label : "Not connected",
      ...(typeof connection.firstSeenAt === "number" ? { firstSeenAt: connection.firstSeenAt } : {}),
      ...(typeof connection.lastSeenAt === "number" ? { lastSeenAt: connection.lastSeenAt } : {}),
      ...(typeof connection.guideIssuedAt === "number" ? { guideIssuedAt: connection.guideIssuedAt } : {}),
    },
    assessment: completeAssessment(view.assessment),
  }
}
