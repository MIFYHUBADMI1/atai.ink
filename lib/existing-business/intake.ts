import "server-only"

/**
 * Existing-business intake orchestration (Phase 1, Parts D–H).
 *
 * One background run over the sources the founder actually supplied:
 * website → domain claim → co-founder assessment.
 *
 * Deliberate properties:
 *  - Reading a website is the only evidence gathering here. A repository is
 *    NOT read: importing code is the GitHub journey's job, and duplicating it
 *    on this path made two products look like one.
 *  - Nothing here starts a build, a plan or a mirror. Reading a business is not
 *    an instruction to rebuild it (`startProjectPipeline` is never called).
 *  - `ProjectState` is untouched. The build-oriented state machine does not
 *    describe "a business that arrived already running", and widening or
 *    re-using its states would move every unrelated screen. Progress lives on
 *    `project.intake`, which is also what makes a retry safe.
 *  - Idempotent: an atomic claim on `intake.run` plus per-stage terminal
 *    checks. Credits are charged only for a crawl that was actually paid for
 *    (a cache hit is free), so a retry cannot double-bill.
 */

import { store, cryptoId } from "@/lib/store/store"
import { projectsCol, usersCol } from "@/lib/db/collections"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import { chargeScrapeCredits, getScrapeCost, hasSufficientCredits } from "@/lib/credits/credits"
import { listProjectDomains, registerDomain } from "@/lib/domain/service"
import { businessStartingPointOf, type BusinessIntake, type BusinessObjectiveId, type IntakeStageStatus } from "@/lib/types/business-intake"
import type { FeaturePreferences } from "@/lib/types/db"
import type { MirrorProject } from "@/lib/types/project"
import { buildReadingSnapshot, buildWebsiteDigest, collectWebsiteFacts, type WebsiteFacts } from "./website-facts"
import { generateBusinessAssessment, type AssessmentEvidence } from "./assessment"
import { isBusinessObjectiveId, resolveObjectiveActions, type ResolvedAction } from "./objectives"

/** A `processing` stamp older than this belongs to a run that died quietly. */
export const STALE_RUN_MS = 10 * 60_000

export interface IntakeInput {
  displayName?: string
  description?: string
  targetCustomers?: string
  additionalContext?: string
  objectives?: BusinessObjectiveId[]
  websiteUrl?: string
}

function event(stage: string, message: string, level: "info" | "warn" | "error" = "info") {
  return { id: cryptoId(), at: Date.now(), level, stage, message }
}

/** The driver has no good answer for `undefined` in a `$set`, and an absent
 * field is exactly what "no error recorded" means — so drop those keys. */
function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => compact(item)) as unknown as T
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    // Only plain data is walkable: a Date or a driver type must pass through.
    if (prototype !== Object.prototype && prototype !== null) return value
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) out[key] = compact(item)
    }
    return out as T
  }
  return value
}

/** Seed the intake record at creation time: everything is pending, nothing is claimed. */
export function buildIntakeRecord(input: IntakeInput): BusinessIntake {
  const now = Date.now()
  const objectives = Array.isArray(input.objectives) ? [...new Set(input.objectives)] : []
  return {
    collectedAt: now,
    run: { status: "idle", at: now },
    ...(input.displayName?.trim() ? { displayName: input.displayName.trim().slice(0, 120) } : {}),
    ...(input.description?.trim() ? { description: input.description.trim().slice(0, 4_000) } : {}),
    ...(input.targetCustomers?.trim() ? { targetCustomers: input.targetCustomers.trim().slice(0, 2_000) } : {}),
    ...(input.additionalContext?.trim() ? { additionalContext: input.additionalContext.trim().slice(0, 4_000) } : {}),
    objectives,
    website: input.websiteUrl?.trim()
      ? { status: "pending", url: input.websiteUrl.trim().slice(0, 500) }
      : { status: "skipped" },
    assessment: { status: "pending" },
  }
}

/**
 * Overall progress, derived only from the stage statuses. `partially_completed`
 * is the honest answer when something was learned and something failed.
 */
export function intakeProgress(intake?: BusinessIntake): {
  status: IntakeStageStatus
  pending: number
  processing: number
  completed: number
  failed: number
  skipped: number
} {
  const stages: Array<IntakeStageStatus | undefined> = [intake?.website?.status, intake?.assessment?.status]
  const active = stages.filter((status): status is IntakeStageStatus => Boolean(status))
  const count = (status: IntakeStageStatus) => active.filter((s) => s === status).length

  const processing = count("processing")
  const failed = count("failed")
  const completed = count("completed") + count("partially_completed")
  const skipped = count("skipped")
  const pending = count("pending")

  let status: IntakeStageStatus
  if (processing > 0 || pending > 0) status = completed > 0 ? "processing" : "pending"
  else if (completed > 0 && failed > 0) status = "partially_completed"
  else if (completed > 0) status = "completed"
  else if (failed > 0) status = "failed"
  else status = skipped > 0 ? "skipped" : "pending"

  return { status, pending, processing, completed, failed, skipped }
}

/** Atomic single-writer claim. Returns false when another run holds a fresh stamp. */
export async function claimIntakeRun(projectId: string, now = Date.now()): Promise<boolean> {
  const col = await projectsCol()
  const claimed = await col.findOneAndUpdate(
    {
      id: projectId,
      $or: [
        { "intake.run.status": { $ne: "processing" } },
        { "intake.run.at": { $lt: now - STALE_RUN_MS } },
        { "intake.run": { $exists: false } },
      ],
    },
    { $set: { "intake.run": { status: "processing", at: now }, updatedAt: now } },
    { returnDocument: "after" },
  )
  return Boolean(claimed)
}

async function releaseIntakeRun(projectId: string, status: "completed" | "failed" | "cancelled"): Promise<void> {
  const col = await projectsCol()
  const now = Date.now()
  await col.updateOne({ id: projectId }, { $set: { "intake.run": { status, at: now }, updatedAt: now } })
}

/**
 * The founder asked to stop. Only a live run can be stopped, and the flag is
 * read at the next stage boundary — a call already in flight still finishes,
 * and whatever it learned is kept.
 */
export async function requestIntakeStop(projectId: string): Promise<boolean> {
  const col = await projectsCol()
  const now = Date.now()
  const result = await col.updateOne(
    { id: projectId, "intake.run.status": "processing" },
    { $set: { "intake.run.cancelRequestedAt": now, updatedAt: now } },
  )
  return result.modifiedCount > 0
}

async function stopRequested(projectId: string): Promise<boolean> {
  const col = await projectsCol()
  const doc = (await col.findOne(
    { id: projectId },
    { projection: { "intake.run.cancelRequestedAt": 1 } },
  )) as { intake?: { run?: { cancelRequestedAt?: number } } } | null
  return doc?.intake?.run?.cancelRequestedAt !== undefined
}

async function abandonIntakeRun(projectId: string): Promise<void> {
  await releaseIntakeRun(projectId, "cancelled")
  await store.appendEvent(
    projectId,
    event("intake", "You stopped the reading. What had already been collected is kept, and nothing further was read."),
  )
}

/** Returns a finished result when the founder asked to stop, else null. */
async function stopGate(projectId: string): Promise<IntakeRunResult | null> {
  if (!(await stopRequested(projectId))) return null
  await abandonIntakeRun(projectId)
  const status = intakeProgress((await store.getProject(projectId))?.intake).status
  return { ok: true, projectId, status, assessmentCompleted: false, stopped: true }
}

/** Dotted-path patch so concurrent stage writes cannot clobber each other. */
async function patchIntake(projectId: string, fields: Record<string, unknown>): Promise<void> {
  const col = await projectsCol()
  await col.updateOne({ id: projectId }, { $set: compact({ ...fields, updatedAt: Date.now() }) })
}

function websiteStageFields(intake: BusinessIntake, patch: Record<string, unknown>): Record<string, unknown> {
  const existing = (intake.website ?? {}) as Record<string, unknown>
  return { "intake.website": compact({ ...existing, ...patch }) }
}

/**
 * Website evidence, or the reason we could not get it. Credits are charged only
 * for a crawl that was not served from the 7-day cache, so a retry of a failed
 * assessment does not pay for the same pages twice.
 */
async function readWebsite(project: MirrorProject, intake: BusinessIntake): Promise<WebsiteFacts | null> {
  const url = intake.website?.url
  if (!url || intake.website?.status === "skipped") return null

  const scrapeCost = await getScrapeCost(project.pipelineMode)
  const affordable = await hasSufficientCredits(project.userId, scrapeCost)
  if (!affordable) {
    await patchIntake(project.id, websiteStageFields(intake, {
      status: "failed",
      attemptedAt: Date.now(),
      errorCode: "INSUFFICIENT_CREDITS",
      errorMessage: "Not enough Atai credits to read your website right now. Your description is still enough for the co-founder to work from.",
    }))
    await store.appendEvent(project.id, event("intake", "Website reading skipped — not enough credits.", "warn"))
    return null
  }

  await patchIntake(project.id, websiteStageFields(intake, { status: "processing", attemptedAt: Date.now() }))
  const result = await collectWebsiteFacts(url)
  const refreshed = await store.getProject(project.id)
  const current = refreshed?.intake ?? intake

  if ("failure" in result) {
    await patchIntake(project.id, websiteStageFields(current, {
      status: "failed",
      completedAt: Date.now(),
      errorCode: result.failure.code,
      errorMessage: result.failure.message,
    }))
    await store.appendEvent(project.id, event("intake", `Could not read the website (${result.failure.code}). Continuing with what you told us.`, "warn"))
    return null
  }

  if (!result.facts.fromCache) {
    try {
      await chargeScrapeCredits(project.userId, project.id, project.pipelineMode)
    } catch (error) {
      // A failed ledger write must not discard evidence the founder paid for.
      logger.error("intake.credits", "scrape charge failed", {
        projectId: project.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await patchIntake(project.id, websiteStageFields(current, {
    status: "completed",
    completedAt: Date.now(),
    pagesCrawled: result.facts.pagesCrawled,
    fromCache: result.facts.fromCache,
    // Kept so the founder can inspect the read on the profile page instead of
    // taking "1 page read" on faith.
    reading: buildReadingSnapshot(result.facts, result.evidence),
    errorCode: null,
    errorMessage: null,
  }))
  await store.appendEvent(
    project.id,
    event("intake", `Read ${result.facts.pagesCrawled} page(s) of ${result.facts.hostname || "your website"}.`),
  )
  return result.facts
}

/**
 * Claim the domain for this business so verification can be offered. This never
 * blocks initialization: a taken or malformed domain is recorded and reported,
 * and the business profile still gets built.
 */
async function registerIntakeDomain(project: MirrorProject, intake: BusinessIntake, facts: WebsiteFacts | null) {
  const candidate = facts?.normalizedUrl || intake.website?.url
  if (!candidate || intake.website?.status !== "completed") return

  let hostname: string
  try {
    const registered = await registerDomain({ userId: project.userId, projectId: project.id, rawUrl: candidate })
    hostname = registered.doc.hostname
    const verified = registered.doc.status === "verified"
    // A projection only — the domain records collection stays authoritative.
    await patchIntake(project.id, {
      "intake.domain": {
        hostname,
        verificationStatus: registered.doc.status,
        ...(registered.doc.method ? { method: registered.doc.method } : {}),
        ...(registered.doc.verifiedAt ? { verifiedAt: registered.doc.verifiedAt } : {}),
      },
    })
    await store.appendEvent(
      project.id,
      event(
        "intake",
        verified
          ? `Domain ${hostname} is verified as yours.`
          : `Domain ${hostname} is registered. Verify ownership when you want domain-level features to use it.`,
      ),
    )
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "DOMAIN_UNAVAILABLE"
    // An address we cannot claim is not a reason to lose the business profile.
    await store.appendEvent(project.id, event("intake", `Domain registration unavailable (${code}).`, "warn"))
    logger.info("intake.domain", "registration skipped", { projectId: project.id, code })
  }
}

async function runAssessment(
  project: MirrorProject,
  intake: BusinessIntake,
  evidence: AssessmentEvidence,
  actions: ResolvedAction[],
): Promise<boolean> {
  await patchIntake(project.id, { "intake.assessment": { status: "processing", attemptedAt: Date.now() } })
  const outcome = await generateBusinessAssessment(
    { projectId: project.id, userId: project.userId, displayName: intake.displayName || project.name, evidence },
    { actions },
  )

  if (!outcome.ok) {
    await patchIntake(project.id, {
      "intake.assessment": compact({
        ...intake.assessment,
        status: "failed",
        attemptedAt: Date.now(),
        errorCode: outcome.code,
        errorMessage: outcome.message,
      }),
    })
    await store.appendEvent(project.id, event("intake", outcome.message, "warn"))
    return false
  }

  await patchIntake(project.id, {
    "intake.assessment": {
      status: "completed",
      attemptedAt: intake.assessment?.attemptedAt ?? Date.now(),
      completedAt: Date.now(),
      generatedAt: outcome.assessment.generatedAt,
      result: outcome.assessment,
      errorCode: null,
      errorMessage: null,
    },
  })
  await store.appendEvent(project.id, event("intake", "Your co-founder's initial read of the business is ready."))
  return true
}

export type IntakeRunResult =
  | { ok: true; projectId: string; status: IntakeStageStatus; assessmentCompleted: boolean; stopped?: boolean }
  | { ok: false; code: string; message: string }

/** What a caller learns about a run it asked for: accepted, already done, or refused. */
export type IntakeStartResult =
  | { ok: true; projectId: string; started: boolean; status: IntakeStageStatus; assessmentCompleted: boolean }
  | { ok: false; code: string; message: string }

type PreparedRun =
  | { ok: true; project: MirrorProject; intake: BusinessIntake; alreadyDone: boolean }
  | { ok: false; code: string; message: string }

/**
 * Everything that can refuse a run, decided before any work starts: access,
 * eligibility, a run that is already finished, the rate limit, and the
 * single-writer claim. Callers use this to answer "did it start?" honestly —
 * the previous fire-and-forget POST could not, so a refused retry looked
 * exactly like a working one.
 */
async function prepareIntakeRun(
  projectId: string,
  options: { userId?: string; allowReassessment?: boolean },
): Promise<PreparedRun> {
  const project = await store.getProject(projectId)
  if (!project) return { ok: false, code: "NOT_FOUND", message: "That business could not be found." }
  if (options.userId && project.userId !== options.userId) {
    return { ok: false, code: "FORBIDDEN", message: "You do not have access to this business." }
  }
  if (businessStartingPointOf(project) !== "existing_business") {
    return { ok: false, code: "NOT_ELIGIBLE", message: "This business was not initialized as an existing business." }
  }

  const intake = project.intake ?? buildIntakeRecord({})
  if (intakeProgress(intake).status === "completed" && !options.allowReassessment) {
    return { ok: true, project, intake, alreadyDone: true }
  }

  try {
    await checkRateLimit({ action: "business_intake_run", identifier: project.userId, limit: 6, windowMs: 60 * 60_000 })
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMITED") {
      return { ok: false, code: "RATE_LIMITED", message: "Too many attempts. Please wait a little and try again." }
    }
    throw error
  }

  if (!(await claimIntakeRun(projectId))) {
    return {
      ok: false,
      code: "INTAKE_IN_PROGRESS",
      message: "This business is already being read. Please wait for that to finish.",
    }
  }

  return { ok: true, project, intake, alreadyDone: false }
}

/** The work itself. The claim is already held by the caller. */
async function executeIntakeRun(project: MirrorProject, intake: BusinessIntake): Promise<IntakeRunResult> {
  const projectId = project.id
  try {
    const stopBeforeWebsite = await stopGate(projectId)
    if (stopBeforeWebsite) return stopBeforeWebsite

    const websiteFacts = await readWebsite(project, intake)

    const stopBeforeAssessment = await stopGate(projectId)
    if (stopBeforeAssessment) return stopBeforeAssessment

    // Refresh BEFORE the domain claim: the stage statuses that decide whether
    // a domain can be claimed were just written by the source reads.
    const refreshed = await store.getProject(projectId)
    const current = refreshed?.intake ?? intake
    await registerIntakeDomain(project, current, websiteFacts)

    const evidence: AssessmentEvidence = {
      ownerDescription: current.description ?? "",
      ...(current.targetCustomers ? { targetCustomers: current.targetCustomers } : {}),
      ...(current.additionalContext ? { additionalContext: current.additionalContext } : {}),
      objectives: current.objectives,
      domainVerified: (await listProjectDomains(projectId)).some((doc) => doc.status === "verified"),
      ...(websiteFacts ? { website: {
        hostname: websiteFacts.hostname || "their website",
        pagesCrawled: websiteFacts.pagesCrawled,
        // Fenced as untrusted inside the assessment prompt, never here.
        digest: buildWebsiteDigest(websiteFacts),
      } } : {}),
    }

    const actions = resolveObjectiveActions({
      projectId,
      userId: project.userId,
      prefs: await loadFeaturePreferences(project.userId),
      objectives: current.objectives,
    })
    const assessmentCompleted = await runAssessment(project, current, evidence, actions)
    const status = intakeProgress((await store.getProject(projectId))?.intake).status

    await releaseIntakeRun(projectId, status === "failed" ? "failed" : "completed")
    return { ok: true, projectId, status, assessmentCompleted }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error("intake.run", "unhandled failure", { projectId, message })
    await releaseIntakeRun(projectId, "failed")
    return {
      ok: false,
      code: "INTAKE_FAILED",
      message: "We could not finish reading your business this time. Nothing was invented for you — open the business and try again.",
    }
  }
}

/**
 * Runs (or resumes) the intake for one project and waits for it. Safe to call
 * twice, safe to call after a partial failure, never calls the build pipeline.
 */
export async function runBusinessIntake(
  projectId: string,
  options: { userId?: string; allowReassessment?: boolean } = {},
): Promise<IntakeRunResult> {
  const prepared = await prepareIntakeRun(projectId, options)
  if (!prepared.ok) return prepared
  if (prepared.alreadyDone) {
    return {
      ok: true,
      projectId,
      status: "completed",
      assessmentCompleted: prepared.intake.assessment?.status === "completed",
    }
  }
  return executeIntakeRun(prepared.project, prepared.intake)
}

/**
 * Accepts a run and returns as soon as it is genuinely accepted, so a route can
 * tell "started" from "refused" without holding the request open for the whole
 * crawl and model call.
 */
export async function startIntakeRun(
  projectId: string,
  options: { userId?: string; allowReassessment?: boolean } = {},
): Promise<IntakeStartResult> {
  const prepared = await prepareIntakeRun(projectId, options)
  if (!prepared.ok) return prepared
  if (prepared.alreadyDone) {
    return {
      ok: true,
      projectId,
      started: false,
      status: "completed",
      assessmentCompleted: prepared.intake.assessment?.status === "completed",
    }
  }
  void executeIntakeRun(prepared.project, prepared.intake).catch((error) => {
    logger.error("intake.start", "background run threw", {
      projectId,
      message: error instanceof Error ? error.message : String(error),
    })
  })
  return { ok: true, projectId, started: true, status: "processing", assessmentCompleted: false }
}

/**
 * Kick off intake for a project created with `skipAnalysis`. Fire-and-forget in
 * the house style: the client polls the intake view for honest progress.
 */
export function startBusinessIntake(projectId: string): void {
  void runBusinessIntake(projectId).catch((error) => {
    logger.error("intake.start", "background run threw", {
      projectId,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

/** The founder's own feature switches, so an action plan can only ever point
 * at a screen they can actually open. Reading them is best-effort: no
 * preferences means the env/rollout defaults apply. */
export async function loadFeaturePreferences(userId: string): Promise<FeaturePreferences | undefined> {
  try {
    const doc = await (await usersCol()).findOne({ id: userId }, { projection: { featurePreferences: 1 } })
    return (doc as { featurePreferences?: FeaturePreferences } | null)?.featurePreferences ?? undefined
  } catch (error) {
    logger.warn("intake.flags", "feature preferences unreadable", {
      message: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/** Validate + normalize the intake form before a project is created. */
export function sanitizeIntakeInput(body: Record<string, unknown>): IntakeInput {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")
  // Unknown objective ids are dropped, not trusted: the objective set is a
  // closed list that decides which screens we later link to.
  const objectives = Array.isArray(body.objectives)
    ? (body.objectives.filter(isBusinessObjectiveId) as BusinessObjectiveId[])
    : []
  const websiteUrl = text(body.websiteUrl)
  return {
    displayName: text(body.displayName) || undefined,
    description: text(body.description) || undefined,
    targetCustomers: text(body.targetCustomers) || undefined,
    additionalContext: text(body.additionalContext) || undefined,
    objectives: objectives.length ? [...new Set(objectives)].slice(0, 10) : [],
    websiteUrl: websiteUrl || undefined,
  }
}
