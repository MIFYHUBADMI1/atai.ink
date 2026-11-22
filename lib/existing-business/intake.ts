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

import { after } from "next/server"
import { store, cryptoId } from "@/lib/store/store"
import { projectsCol, usersCol } from "@/lib/db/collections"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import { chargeBusinessReadCredits, getBusinessReadCost, hasSufficientCredits } from "@/lib/credits/credits"
import { getExistingBusinessCosts } from "@/lib/billing/runtime-config"
import { getAvailableCredits } from "@/lib/billing/credit-service"
import {
  BUSINESS_ALREADY_CONNECTED_MESSAGE,
  canonicalClaimFor,
  canonicalHostFromInput,
  listProjectDomains,
  registerDomain,
  reserveBusinessClaim,
} from "@/lib/domain/service"
import { isSharedHostingHost, registrableDomainOf } from "@/lib/domain/host"
import { resolveCofounderModel } from "@/lib/cofounder/model"
import {
  businessStartingPointOf,
  type BusinessDomainDoc,
  type BusinessIntake,
  type BusinessObjectiveId,
  type IntakeStageStatus,
} from "@/lib/types/business-intake"
import type { FeaturePreferences } from "@/lib/types/db"
import type { MirrorProject } from "@/lib/types/project"
import { buildReadingSnapshot, buildWebsiteDigest, collectWebsiteFacts, type WebsiteFacts } from "./website-facts"
import { generateBusinessAssessment, type AssessmentEngine, type AssessmentEvidence } from "./assessment"
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

  const scrapeCost = await getBusinessReadCost()
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
      await chargeBusinessReadCredits(project.userId, project.id)
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
  if (result.facts.redirectedFrom) {
    await store.appendEvent(
      project.id,
      event(
        "intake",
        `${hostLabel(result.facts.redirectedFrom)} redirects to ${result.facts.hostname}. We read the live site there.`,
      ),
    )
  }
  return result.facts
}

/**
 * Claim the domain for this business so verification can be offered. This never
 * blocks initialization: a taken or malformed domain is recorded and reported,
 * and the business profile still gets built.
 */
/** A refusal the run must honour, or `ok` to carry on. */
type DomainClaimOutcome = { ok: true } | { ok: false; code: string; message: string }

/** Two hosts that are the same site under another name: apex↔www, or a
 * sibling subdomain of one business. Never true across a shared hosting
 * platform, where every subdomain is a different owner. */
function isSameSite(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (isSharedHostingHost(a) || isSharedHostingHost(b)) return false
  return registrableDomainOf(a) === registrableDomainOf(b)
}

/** A URL reduced to its host, for a sentence a founder reads. */
function hostLabel(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function claimRecord(hostname: string | undefined, state: "yours" | "held_by_other") {
  return {
    ...(hostname ? { hostname } : {}),
    state,
    at: Date.now(),
  }
}

/** Register one exact host. A business held elsewhere is reported separately so
 * the caller can decide whether it blocks the run. */
async function claimOneDomain(
  project: MirrorProject,
  rawUrl: string,
): Promise<{ ok: true; doc: BusinessDomainDoc } | { ok: false; code: string; message: string }> {
  try {
    const { doc } = await registerDomain({ userId: project.userId, projectId: project.id, rawUrl })
    return { ok: true, doc }
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "DOMAIN_UNAVAILABLE"
    if (code === "BUSINESS_ALREADY_CONNECTED" || code === "DOMAIN_TAKEN") {
      return { ok: false, code: "BUSINESS_ALREADY_CONNECTED", message: BUSINESS_ALREADY_CONNECTED_MESSAGE }
    }
    return { ok: false, code, message: `Domain registration unavailable (${code}).` }
  }
}

/**
 * Claim the address the founder submitted, and only then the redirect target.
 *
 * A business held by another account is the one failure that stops the run:
 * reading it would disclose someone else's business and end with a business
 * that can never be verified. A redirect target held elsewhere is only a
 * missing extra alias — never a reason to drop a business the founder holds.
 * Everything else (malformed host, network) stays non-blocking too.
 */
async function registerIntakeDomain(
  project: MirrorProject,
  intake: BusinessIntake,
  facts: WebsiteFacts | null,
): Promise<DomainClaimOutcome> {
  const submitted = intake.website?.url
  const target = facts?.normalizedUrl
  const primaryUrl = submitted || target
  if (!primaryUrl || intake.website?.status !== "completed") return { ok: true }

  const primary = await claimOneDomain(project, primaryUrl)
  if (!primary.ok) {
    if (primary.code === "BUSINESS_ALREADY_CONNECTED") {
      await patchIntake(project.id, {
        "intake.claim": claimRecord(canonicalHostFromInput(primaryUrl), "held_by_other"),
      })
      await store.appendEvent(project.id, event("intake", BUSINESS_ALREADY_CONNECTED_MESSAGE, "error"))
      logger.info("intake.domain", "claim refused", { projectId: project.id, code: primary.code })
      return { ok: false, code: "BUSINESS_ALREADY_CONNECTED", message: BUSINESS_ALREADY_CONNECTED_MESSAGE }
    }
    // An address we cannot claim is not a reason to lose the business profile.
    await store.appendEvent(project.id, event("intake", primary.message, "warn"))
    logger.info("intake.domain", "registration skipped", { projectId: project.id, code: primary.code })
    return { ok: true }
  }

  const hostname = primary.doc.hostname
  const verified = primary.doc.status === "verified"
  // A projection only — the domain records collection stays authoritative.
  await patchIntake(project.id, {
    "intake.domain": {
      hostname,
      verificationStatus: primary.doc.status,
      ...(primary.doc.method ? { method: primary.doc.method } : {}),
      ...(primary.doc.verifiedAt ? { verifiedAt: primary.doc.verifiedAt } : {}),
    },
    "intake.claim": claimRecord(primary.doc.canonicalHostname ?? canonicalHostFromInput(primaryUrl), "yours"),
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

  // The site redirected to another host. Claim it as an alias ONLY when it is
  // the same site under another name (apex↔www, a sibling subdomain). A
  // redirect to a different domain is not evidence that the founder owns that
  // domain — claiming it would squat a host they never proved control of.
  const primaryHost = primary.doc.hostname
  const targetHost = target ? canonicalHostFromInput(target) : null
  if (
    target &&
    targetHost &&
    targetHost !== (primary.doc.canonicalHostname ?? canonicalHostFromInput(primaryUrl)) &&
    isSameSite(primaryHost, targetHost)
  ) {
    const alias = await claimOneDomain(project, target)
    if (!alias.ok) {
      logger.info("intake.domain", "redirect target not claimed", { projectId: project.id, code: alias.code })
    }
  } else if (target && targetHost && !isSameSite(primaryHost, targetHost)) {
    logger.info("intake.domain", "cross-site redirect left unclaimed", { projectId: project.id, primaryHost, targetHost })
  }
  return { ok: true }
}

/**
 * The engine this read runs on: the founder's own /settings/ai pick, the same
 * one that answers their co-founder chat. Fail-soft — an unreadable tier
 * catalog falls back to the shared analysis model rather than refusing a read
 * the founder has already paid for.
 */
async function resolveAssessmentEngine(userId: string): Promise<AssessmentEngine | undefined> {
  try {
    const resolved = await resolveCofounderModel(userId)
    return {
      tierId: resolved.tier.id,
      tierName: resolved.tier.name,
      modelId: resolved.modelId,
      creditsPerMessage: resolved.tier.creditsPerMessage,
      model: resolved.model,
    }
  } catch (error) {
    logger.warn("intake.assessment", "engine resolution failed; using the shared model", {
      userId,
      message: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

async function runAssessment(
  project: MirrorProject,
  intake: BusinessIntake,
  evidence: AssessmentEvidence,
  actions: ResolvedAction[],
): Promise<boolean> {
  const engine = await resolveAssessmentEngine(project.userId)
  const engineRef = engine
    ? {
        tierId: engine.tierId,
        tierName: engine.tierName,
        modelId: engine.modelId,
        creditsPerMessage: engine.creditsPerMessage,
      }
    : undefined
  // One attempt id for the record and the charge: a retry must bill again,
  // because the failed attempt's charge was refunded.
  const attemptedAt = Date.now()
  await patchIntake(project.id, {
    "intake.assessment": compact({
      ...intake.assessment,
      status: "processing",
      attemptedAt,
      ...(engineRef ? { engine: engineRef } : {}),
    }),
  })
  const outcome = await generateBusinessAssessment(
    {
      projectId: project.id,
      userId: project.userId,
      displayName: intake.displayName || project.name,
      evidence,
      ...(engine ? { engine } : {}),
      attemptId: String(attemptedAt),
    },
    { actions },
  )

  if (!outcome.ok) {
    await patchIntake(project.id, {
      "intake.assessment": compact({
        ...intake.assessment,
        status: "failed",
        attemptedAt,
        errorCode: outcome.code,
        errorMessage: outcome.message,
        errorDetail: outcome.detail ?? null,
        errorReason: outcome.reason ?? null,
        ...(engineRef ? { engine: engineRef } : {}),
      }),
    })
    await store.appendEvent(project.id, event("intake", outcome.message, "warn"))
    return false
  }

  await patchIntake(project.id, {
    "intake.assessment": compact({
      status: "completed",
      // The attempt that was actually billed — never a fresh clock reading, or
      // the stored record and the ledger entry describe different attempts.
      attemptedAt,
      completedAt: Date.now(),
      generatedAt: outcome.assessment.generatedAt,
      result: outcome.assessment,
      errorCode: null,
      errorMessage: null,
      errorDetail: null,
      errorReason: null,
      ...(engineRef ? { engine: engineRef } : {}),
    }),
  })
  await store.appendEvent(project.id, event("intake", "Your co-founder's initial read of the business is ready."))
  return true
}

export type IntakeRunResult =
  | { ok: true; projectId: string; status: IntakeStageStatus; assessmentCompleted: boolean; stopped?: boolean }
  | { ok: false; code: string; message: string }

/** What a caller learns about a run it asked for: accepted, already done, or refused. */
export interface BusinessJourneyCost {
  /** Credits the read alone costs. */
  readCost: number
  /** The flat price of the co-founder's write. */
  assessmentCost: number
  /** The chosen engine's price per turn, added to the write. */
  engineCost: number
  /** That engine's name, for the breakdown. Null when the default is used. */
  engineName: string | null
  /** What is still unpaid from here — a finished stage is never charged twice. */
  required: number
  /** Credits the founder can spend right now. */
  available: number
  /** How many credits are missing before the journey can finish. */
  shortfall: number
}

export type IntakeStartResult =
  | { ok: true; projectId: string; started: boolean; status: IntakeStageStatus; assessmentCompleted: boolean }
  | { ok: false; code: string; message: string; meta?: Record<string, unknown> }

type PreparedRun =
  | { ok: true; project: MirrorProject; intake: BusinessIntake; alreadyDone: boolean }
  | { ok: false; code: string; message: string; meta?: Record<string, unknown> }

/**
 * What finishing this business still costs, and whether the founder can pay.
 * Both stages are priced up front so the founder is told the whole number
 * before a single credit leaves the account, not one failure at a time.
 */
export async function businessJourneyCost(project: MirrorProject, intake: BusinessIntake): Promise<BusinessJourneyCost> {
  const costs = await getExistingBusinessCosts()
  const websitePending =
    Boolean(intake.website?.url) && intake.website?.status !== "skipped" && intake.website?.status !== "completed"
  const assessmentPending = intake.assessment?.status !== "completed"
  const surcharge = assessmentPending
    ? await assessmentEngineSurcharge(project.userId)
    : { cost: 0, name: null }
  const required =
    (websitePending ? costs.readCost : 0) + (assessmentPending ? costs.assessmentCost + surcharge.cost : 0)
  const available = await getAvailableCredits(project.userId)
  return {
    readCost: costs.readCost,
    assessmentCost: costs.assessmentCost,
    engineCost: surcharge.cost,
    engineName: surcharge.name,
    required,
    available,
    shortfall: Math.max(0, required - available),
  }
}

/**
 * The engine's surcharge on the write, resolved exactly the way the run will
 * resolve it — a quote the charge does not match is a billing bug, not a
 * rounding error.
 */
export async function assessmentEngineSurcharge(
  userId: string,
): Promise<{ cost: number; name: string | null }> {
  const engine = await resolveAssessmentEngine(userId)
  return engine ? { cost: Math.max(0, engine.creditsPerMessage ?? 0), name: engine.tierName } : { cost: 0, name: null }
}

/**
 * Everything that can refuse a run, decided before any work starts: access,
 * eligibility, a run that is already finished, the rate limit, and the
 * single-writer claim. Callers use this to answer "did it start?" honestly —
 * the previous fire-and-forget POST could not, so a refused retry looked
 * exactly like a working one.
 */
/**
 * A business is readable only by the account that holds it. This runs before
 * the credit check, the rate limit and the crawl, so a taken business costs the
 * founder nothing and the refusal is persisted for the profile to show.
 */
async function ensureBusinessClaim(
  project: MirrorProject,
  intake: BusinessIntake,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const websiteUrl = intake.website?.url
  if (!websiteUrl) return { ok: true }

  const held = await canonicalClaimFor(websiteUrl)
  if (held && held.doc.userId !== project.userId) {
    await patchIntake(project.id, { "intake.claim": claimRecord(held.canonicalHostname, "held_by_other") })
    await store.appendEvent(project.id, event("intake", BUSINESS_ALREADY_CONNECTED_MESSAGE, "error"))
    logger.info("business.claim", "intake refused", {
      projectId: project.id,
      userId: project.userId,
      hostname: held.canonicalHostname,
    })
    return { ok: false, code: "BUSINESS_ALREADY_CONNECTED", message: BUSINESS_ALREADY_CONNECTED_MESSAGE }
  }

  if (!held) {
    // A project created before claims existed reserves on its first run.
    const reserved = await reserveBusinessClaim({ userId: project.userId, projectId: project.id, rawUrl: websiteUrl })
    if (reserved.state === "refused") {
      await patchIntake(project.id, { "intake.claim": claimRecord(canonicalHostFromInput(websiteUrl), "held_by_other") })
      await store.appendEvent(project.id, event("intake", reserved.message, "error"))
      return { ok: false, code: reserved.code, message: reserved.message }
    }
    const hostname = reserved.state === "reserved" ? reserved.canonicalHostname : canonicalHostFromInput(websiteUrl)
    await patchIntake(project.id, { "intake.claim": claimRecord(hostname, "yours") })
    return { ok: true }
  }

  await patchIntake(project.id, { "intake.claim": claimRecord(held.canonicalHostname, "yours") })
  return { ok: true }
}

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

  const claim = await ensureBusinessClaim(project, intake)
  if (!claim.ok) return claim

  const cost = await businessJourneyCost(project, intake)
  if (cost.shortfall > 0) {
    return {
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      message: `Finishing this business costs ${cost.required} credits. You have ${cost.available}, so you are ${cost.shortfall} short.`,
      meta: { ...cost },
    }
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
    const domainClaim = await registerIntakeDomain(project, current, websiteFacts)
    if (!domainClaim.ok) {
      // Stop before the assessment: no credits for a business that cannot be
      // connected, and no assessment that would describe someone else's site.
      await releaseIntakeRun(projectId, "failed")
      return { ok: false, code: domainClaim.code, message: domainClaim.message }
    }

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
/**
 * Keep a fire-and-forget run alive past the response. Serverless platforms
 * freeze an idle function the moment it answers, which killed the crawl and
 * the model call halfway and left the stage stuck or failed. `after` extends
 * the function to its `maxDuration`; outside a request scope (tests, scripts)
 * there is nothing to attach to and the promise simply runs.
 */
function keepAlive(work: Promise<unknown>) {
  try {
    after(() => work)
  } catch {
    // Not in a request scope — the caller owns the promise.
  }
}

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
  const run = executeIntakeRun(prepared.project, prepared.intake).catch((error) => {
    logger.error("intake.start", "background run threw", {
      projectId,
      message: error instanceof Error ? error.message : String(error),
    })
  })
  void run
  keepAlive(run)
  return { ok: true, projectId, started: true, status: "processing", assessmentCompleted: false }
}

/**
 * Kick off intake for a project created with `skipAnalysis`. Fire-and-forget in
 * the house style: the client polls the intake view for honest progress.
 */
export function startBusinessIntake(projectId: string): void {
  const run = runBusinessIntake(projectId).catch((error) => {
    logger.error("intake.start", "background run threw", {
      projectId,
      message: error instanceof Error ? error.message : String(error),
    })
  })
  void run
  keepAlive(run)
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
