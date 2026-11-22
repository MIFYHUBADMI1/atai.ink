import { store, cryptoId } from "@/lib/store/store"
import { fail } from "@/lib/api/respond"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { startProjectPipeline } from "@/lib/projects/pipeline-recovery"
import { saveProjectAttachments } from "@/lib/projects/attachments"
import { authorizeProjectCreation, ENTITLEMENT_ENFORCEMENT_ENABLED } from "@/lib/billing/entitlements/require"
import { normalizeUrl } from "@/lib/integrations/firecrawl/service"
import { buildIntakeRecord, sanitizeIntakeInput, startBusinessIntake, type IntakeInput } from "@/lib/existing-business/intake"
import { INTAKE_SOURCE_ERROR, hasIntakeSource } from "@/lib/existing-business/source-rule"
import {
  BUSINESS_ALREADY_CONNECTED_MESSAGE,
  releaseProjectClaims,
  reserveBusinessClaim,
} from "@/lib/domain/service"
import type { BusinessStartingPoint } from "@/lib/types/business-intake"
import type { MirrorProject, ProjectPreferences, UserPipelineMode } from "@/lib/types/project"

export type CreateProjectInput = {
  mode?: string
  name?: string
  url?: string
  idea?: string
  crawlMode?: string
  preferences?: ProjectPreferences
  pipelineMode?: UserPipelineMode
  githubRepoOwner?: string
  githubRepoName?: string
  githubBranch?: string
  githubSubMode?: "clone" | "extend"
  /** Workspace to attribute the project to (ADR-7). Optional; defaults to personal scope. */
  workspaceId?: string
  userRequest?: string
  idempotencyKey?: string
  skipAnalysis?: boolean
  attachments?: Array<{ name: string; content: string; size?: number }>
  /** "existing_business" starts the intake journey. Anything else (including
   * absent) keeps every existing creation path exactly as it was. */
  startingPoint?: string
  /** Answers from the existing-business form. Only read when `startingPoint`
   * is "existing_business". */
  intake?: IntakeInput
}

const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000

// Last-resort naming for callers that arrive without a user-confirmed title
// (legacy/API paths). The composer funnel always sends an explicit `name`, so
// a project is never silently named from a sentence fragment on the main path.
function titleFromIntent(text: string | undefined, fallback: string): string {
  const cleaned = (text ?? "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (cleaned.length < 8) return fallback
  const words = cleaned.split(" ").slice(0, 6).join(" ")
  const titled = words.replace(/\b\w/g, (c) => c.toUpperCase())
  return titled.length > 60 ? `${titled.slice(0, 57)}…` : titled
}

function newProject(
  userId: string,
  partial: Partial<MirrorProject> & Pick<MirrorProject, "mode" | "name">,
): MirrorProject {
  const now = Date.now()
  return {
    id: partial.id ?? cryptoId(),
    userId,
    workspaceId: partial.workspaceId,
    mode: partial.mode,
    name: partial.name,
    state: "created",
    sourceUrl: partial.sourceUrl,
    crawlMode: partial.crawlMode,
    pipelineMode: partial.pipelineMode,
    idea: partial.idea,
    preferences: partial.preferences,
    startingPoint: partial.startingPoint,
    intake: partial.intake,
    events: [{ id: cryptoId(), at: now, level: "info", stage: "create", message: "Project created" }],
    conversation: [],
    deployment: { id: cryptoId(), status: "idle", updatedAt: now },
    deploymentHistory: [],
    createdAt: now,
    updatedAt: now,
  }
}

async function findRecentDuplicate(userId: string, match: { idea?: string; sourceUrl?: string; github?: string }) {
  const projects = await store.listProjects(userId, 20)
  const cutoff = Date.now() - IDEMPOTENCY_WINDOW_MS
  return projects.find((p) => {
    if (p.createdAt < cutoff) return false
    if (match.sourceUrl && p.sourceUrl === match.sourceUrl) return true
    if (match.idea && p.idea && p.idea.trim() === match.idea.trim()) return true
    if (match.github && p.name === match.github) return true
    return false
  })
}

// Stage composer attachments for the project's first build. clear-then-insert
// keeps a double-submit from doubling the file set.
async function stageAttachments(projectId: string, userId: string, attachments: CreateProjectInput["attachments"]) {
  if (!attachments?.length) return
  const { clearProjectAttachments } = await import("@/lib/projects/attachments")
  await clearProjectAttachments(projectId).catch(() => undefined)
  const saved = await saveProjectAttachments(projectId, userId, attachments)
  if (saved.length) {
    await store.appendEvent(projectId, {
      id: cryptoId(),
      at: Date.now(),
      level: "info",
      stage: "create",
      message: `${saved.length} attached file${saved.length === 1 ? "" : "s"} will be shared with the builder when the build starts.`,
    })
  }
}

/**
 * Heavy mode is the crawl-and-rebuild rate. An existing business is only ever
 * read — a handful of pages, capped in `readWebsite` — so it must not inherit
 * that rate from a client that defaults to "heavy".
 */
export function resolvePipelineMode(
  startingPoint: BusinessStartingPoint | undefined,
  requested: unknown,
): UserPipelineMode {
  if (startingPoint === "existing_business") return "legacy"
  return requested === "heavy" ? "heavy" : requested === "legacy" ? "legacy" : "heavy"
}

export async function createUserProject(userId: string, body: CreateProjectInput) {
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim().slice(0, 80) : ""
  if (idempotencyKey) {
    const { findCreateIdempotency } = await import("@/lib/start/pending-store")
    const existingKey = await findCreateIdempotency(userId, idempotencyKey)
    if (existingKey?.projectId) {
      const existingProject = await store.getProject(existingKey.projectId)
      if (existingProject && existingProject.userId === userId) {
        return { project: existingProject, reused: true }
      }
    }
  }

  await checkRateLimit({
    action: "project_create",
    identifier: userId,
    limit: 10,
    windowMs: 60 * 60 * 1000,
  })

  // Phase 3 entitlement gate (fail-open when flag is off — existing flows untouched).
  if (ENTITLEMENT_ENFORCEMENT_ENABLED) {
    try {
      const auth = await authorizeProjectCreation(userId)
      if (!auth.allowed) {
        return { error: fail(auth.code ?? "PLAN_LIMIT", auth.reason ?? "Your plan does not allow this.", 402) }
      }
    } catch {
      // Resolution failure must not break creation while enforcement is rolling out.
    }
  }

  const startingPoint: BusinessStartingPoint | undefined =
    body.startingPoint === "existing_business" ? "existing_business" : undefined
  // An existing business is read, never mirrored: regardless of what the
  // client sent, the intake journey always uses the one mode that cannot
  // trigger a crawl-and-rebuild pipeline.
  const mode = startingPoint === "existing_business"
    ? "scratch"
    : body.mode === "scratch" ? "scratch" : body.mode === "github" ? "github" : "website"
  const crawlMode = body.crawlMode === "deep" ? "deep" : "relevant"
  const pipelineMode = resolvePipelineMode(startingPoint, body.pipelineMode)
  const originalIntent = (body.idea ?? body.userRequest ?? "").trim() || undefined

  if (mode === "github") {
    if (!body.githubRepoOwner || !body.githubRepoName) {
      return { error: fail("VALIDATION", "GitHub repo owner and name are required.", 422) }
    }
    const githubSubMode = body.githubSubMode || "clone"
    if (githubSubMode === "extend" && (!body.userRequest || body.userRequest.trim().length === 0)) {
      return { error: fail("VALIDATION", "Extend mode requires a description of what you want to add or change.", 422) }
    }
    const repoLabel = `${body.githubRepoOwner}/${body.githubRepoName}`
    const existing = await findRecentDuplicate(userId, { github: repoLabel, idea: originalIntent })
    if (existing) return { project: existing, reused: true }

    const preferences = body.preferences
    const projectName = body.name?.trim() || preferences?.appName || titleFromIntent(originalIntent, repoLabel)
    const project = newProject(userId, {
      mode,
      name: projectName,
      preferences,
      pipelineMode,
      idea: originalIntent,
      workspaceId: body.workspaceId,
    })
    await store.createProject(project)
    if (idempotencyKey) {
      const { saveCreateIdempotency } = await import("@/lib/start/pending-store")
      const saved = await saveCreateIdempotency(userId, idempotencyKey, project.id)
      if (!saved) {
        const { findCreateIdempotency } = await import("@/lib/start/pending-store")
        const raced = await findCreateIdempotency(userId, idempotencyKey)
        if (raced?.projectId && raced.projectId !== project.id) {
          const winner = await store.getProject(raced.projectId)
          if (winner) return { project: winner, reused: true }
        }
      }
    }
    const { projectGitHubCol } = await import("@/lib/db/collections")
    const { cryptoId: cid } = await import("@/lib/store/store")
    const { ObjectId } = await import("mongodb")
    const ghCol = await projectGitHubCol()
    await ghCol.insertOne({
      _id: new ObjectId(),
      id: cid(),
      projectId: project.id,
      userId,
      mode: "build-from",
      githubSubMode,
      userRequest: githubSubMode === "extend" ? body.userRequest?.trim() : originalIntent,
      repoOwner: body.githubRepoOwner,
      repoName: body.githubRepoName,
      branch: body.githubBranch || "main",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await stageAttachments(project.id, userId, body.attachments)
    if (!body.skipAnalysis) void startProjectPipeline(project.id)
    return { project, reused: false }
  }

  if (mode === "website") {
    if (!body.url || typeof body.url !== "string") {
      return { error: fail("VALIDATION", "A website URL is required.", 422) }
    }
    let sourceUrl: string
    try {
      sourceUrl = normalizeUrl(body.url)
    } catch {
      return { error: fail("VALIDATION", "Please enter a valid website URL.", 422) }
    }
    const existing = await findRecentDuplicate(userId, { sourceUrl, idea: originalIntent })
    if (existing) return { project: existing, reused: true }

    const preferences = body.preferences
    const host = new URL(sourceUrl).host
    const projectName = body.name?.trim() || preferences?.appName || titleFromIntent(originalIntent, host)
    const project = newProject(userId, {
      mode,
      sourceUrl,
      name: projectName,
      preferences,
      crawlMode,
      pipelineMode,
      idea: originalIntent,
      workspaceId: body.workspaceId,
    })
    await store.createProject(project)
    if (idempotencyKey) {
      const { saveCreateIdempotency } = await import("@/lib/start/pending-store")
      await saveCreateIdempotency(userId, idempotencyKey, project.id)
    }
    await stageAttachments(project.id, userId, body.attachments)
    if (!body.skipAnalysis) void startProjectPipeline(project.id)
    return { project, reused: false }
  }

  // ── Existing-business intake (Phase 1) ──────────────────────────────────
  // Still `mode: "scratch"`, because that is the one mode that never makes
  // anything assume this website should be mirrored or rebuilt. What makes it
  // an existing business is `startingPoint` + the intake record, both additive.
  const isExistingBusiness = startingPoint === "existing_business"
  const intake = isExistingBusiness ? sanitizeIntakeInput((body.intake ?? {}) as Record<string, unknown>) : undefined
  const idea = isExistingBusiness
    ? (intake?.description ?? "").trim()
    : (body.idea ?? "").trim()

  if (isExistingBusiness) {
    // The live application address is the entry point of this journey, so it
    // is required — not merely one of several accepted sources. Validated with
    // the same rule the wizard uses.
    if (!hasIntakeSource({ websiteUrl: intake?.websiteUrl })) {
      return { error: fail("VALIDATION", INTAKE_SOURCE_ERROR, 422) }
    }
  } else if (idea.length < 8) {
    return { error: fail("VALIDATION", "Please describe your app idea in a bit more detail.", 422) }
  }
  // A business belongs to exactly one account. The claim is taken before the
  // project row exists and before any credits are spent, so a second attempt
  // either lands on the business the founder already has or is refused.
  let reservedProjectId: string | undefined
  if (isExistingBusiness) {
    const projectId = cryptoId()
    const claim = await reserveBusinessClaim({ userId, projectId, rawUrl: intake?.websiteUrl ?? "" })
    if (claim.state === "refused") return { error: fail(claim.code, claim.message, claim.status) }
    if (claim.state === "reuse") {
      const owned = await store.getProject(claim.projectId)
      if (owned && owned.userId === userId) return { project: owned, reused: true }
      // The claim points at a project that is gone: free it and reserve again.
      await releaseProjectClaims(claim.projectId, "orphaned claim reclaimed at creation")
      const retry = await reserveBusinessClaim({ userId, projectId, rawUrl: intake?.websiteUrl ?? "" })
      if (retry.state !== "reserved") {
        return { error: fail("BUSINESS_ALREADY_CONNECTED", BUSINESS_ALREADY_CONNECTED_MESSAGE, 409) }
      }
    }
    reservedProjectId = projectId
  }

  // The claim is the duplicate check for an existing business; the prose
  // comparison only makes sense for the build-from-idea journey.
  if (!isExistingBusiness) {
    const existing = await findRecentDuplicate(userId, { idea })
    if (existing) return { project: existing, reused: true }
  }

  const preferences = body.preferences
  const projectName =
    body.name?.trim() ||
    intake?.displayName ||
    preferences?.appName ||
    titleFromIntent(idea, isExistingBusiness ? "Existing business" : "New app")
  const project = newProject(userId, {
    ...(reservedProjectId ? { id: reservedProjectId } : {}),
    mode,
    idea: idea || undefined,
    name: projectName,
    preferences,
    pipelineMode,
    workspaceId: body.workspaceId,
    ...(isExistingBusiness
      ? {
          startingPoint: startingPoint as BusinessStartingPoint,
          intake: buildIntakeRecord(intake ?? {}),
        }
      : {}),
  })
  try {
    await store.createProject(project)
  } catch (error) {
    // Never leave a business reserved for a project that does not exist.
    if (reservedProjectId) await releaseProjectClaims(reservedProjectId, "project creation failed")
    throw error
  }
  if (idempotencyKey) {
    const { saveCreateIdempotency } = await import("@/lib/start/pending-store")
    await saveCreateIdempotency(userId, idempotencyKey, project.id)
  }
  await stageAttachments(project.id, userId, body.attachments)
  if (isExistingBusiness) {
    // Reading the business is not building an application: the pipeline that
    // produces a plan and a site is deliberately never started here.
    void startBusinessIntake(project.id)
    return { project, reused: false }
  }
  if (!body.skipAnalysis) void startProjectPipeline(project.id)
  return { project, reused: false }
}
