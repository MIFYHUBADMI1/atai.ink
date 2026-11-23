import "server-only"

import { AppError } from "@/lib/errors"
import {
  businessDomainsCol,
  businessMembersCol,
  businessesCol,
  connectedApplicationsCol,
  projectsCol,
} from "@/lib/db/collections"
import { requireBusinessAccess } from "@/lib/business/access"
import { userActor, type Actor, type Permission } from "@/lib/business/permissions"
import { createApplication } from "@/lib/business/applications"
import { createBusiness } from "@/lib/business/service"
import { store } from "@/lib/store/store"
import type { ConnectedApplicationDoc } from "@/lib/types/business"
import type { MirrorProject } from "@/lib/types/project"

/**
 * The business → project adapter.
 *
 * A connected business is the founder-facing identity, but credits
 * (`collaborationIdempotencyKey(userId, projectId, …)`) and runtime credentials
 * (`api_keys.projectId`) are still project-scoped. Rather than re-key both, the
 * business keeps one hidden *anchor* project and every shared engine is called
 * with that project's id. The founder never sees the project; it is an
 * implementation detail, like a row id.
 *
 * This module is the only place that knows about the link, so the independence
 * rule still holds: `lib/business` never imports a project.
 *
 * @module lib/connected-business/anchor
 */

export interface BusinessAnchor {
  businessId: string
  /** The application the founder connected, when one exists. */
  applicationId?: string
  /** The hidden project carrying credits, api keys and runtime auth. */
  projectId: string
}

const ANCHOR_PREPARING = "This business is still being prepared. Try again in a moment."

function websiteOf(project: MirrorProject): string | undefined {
  return (
    project.intake?.website?.url ??
    project.intake?.website?.reading?.finalUrl ??
    project.sourceUrl ??
    undefined
  )
}

function nameOf(project: MirrorProject): string {
  const confirmed = project.intake?.displayName?.trim()
  if (confirmed) return confirmed
  const title = project.name?.trim()
  if (title) return title
  return "Untitled business"
}

/**
 * Resolve a business to its anchor project, after authorising the actor.
 *
 * Resolution order is fixed so two readers always agree:
 *  1. `project.businessId` (the forward pointer written at creation)
 *  2. `businesses.legacyProjectId` (migrated businesses)
 *  3. `connected_applications.legacyProjectId` (a migrated application)
 *
 * More than one match is refused rather than guessed: linking the wrong
 * project would charge the wrong credits.
 */
export async function resolveBusinessAnchor(input: {
  businessId: string
  actor: Actor
  permission?: Permission
}): Promise<BusinessAnchor> {
  const access = await requireBusinessAccess({
    businessId: input.businessId,
    actor: input.actor,
    permission: input.permission ?? "business.read",
  })
  const business = access.business

  const candidates = new Set<string>()
  if (business.legacyProjectId) candidates.add(business.legacyProjectId)

  const applications = await (await connectedApplicationsCol())
    .find({ businessId: business.id, archivedAt: null })
    .toArray()
  for (const application of applications) {
    if (application.legacyProjectId) candidates.add(application.legacyProjectId)
  }

  const byForwardPointer = await (await projectsCol())
    .find({ businessId: business.id })
    .project({ id: 1 })
    .toArray()
  for (const project of byForwardPointer) {
    if (typeof project.id === "string") candidates.add(project.id)
  }

  const ids = [...candidates]
  if (ids.length === 0) throw new AppError("BUSINESS_NOT_MIGRATED", ANCHOR_PREPARING)
  if (ids.length > 1) {
    throw new AppError(
      "BUSINESS_NOT_MIGRATED",
      "This business is linked to more than one workspace. Contact support so we can resolve it.",
    )
  }

  const projectId = ids[0]
  const applicationId =
    applications.find((application) => application.legacyProjectId === projectId)?.id ??
    applications[0]?.id

  return { businessId: business.id, applicationId, projectId }
}

/** Reverse lookup: which business owns this project, if any. */
export async function businessIdForProject(projectId: string): Promise<string | null> {
  const project = await (await projectsCol()).findOne(
    { id: projectId },
    { projection: { businessId: 1, startingPoint: 1 } },
  )
  if (project && typeof project.businessId === "string") return project.businessId

  const business = await (await businessesCol()).findOne(
    { legacyProjectId: projectId, releasedAt: { $exists: false } },
    { projection: { id: 1 } },
  )
  if (business && typeof business.id === "string") return business.id

  const application = await (await connectedApplicationsCol()).findOne(
    { legacyProjectId: projectId },
    { projection: { businessId: 1 } },
  )
  if (application && typeof application.businessId === "string") return application.businessId

  return null
}

/**
 * Idempotent creator + linker. Safe to call from creation, a page render, or a
 * job: the second caller always gets the first caller's ids.
 *
 * Only an existing business is connected this way. A build project is never
 * given a business row, so `/projects` can never show one twice.
 */
export async function ensureBusinessForProject(input: {
  projectId: string
  userId: string
}): Promise<{ businessId: string; applicationId?: string; created: boolean }> {
  const actor = userActor(input.userId)

  const project = await store.getProject(input.projectId)
  if (!project || project.userId !== input.userId) throw new AppError("NOT_FOUND")
  if (project.startingPoint !== "existing_business") {
    throw new AppError("VALIDATION", "Only an existing business is connected this way.")
  }

  const existingId = await businessIdForProject(project.id)
  if (existingId) {
    const anchor = await resolveBusinessAnchor({
      businessId: existingId,
      actor,
      permission: "business.read",
    })
    return { businessId: anchor.businessId, applicationId: anchor.applicationId, created: false }
  }

  const business = await createBusiness({ actor, name: nameOf(project) })

  // Claim the project for this business atomically. Two concurrent callers can
  // both pass the check above; the conditional update decides the winner, and
  // the loser leaves its own draft business behind rather than re-pointing a
  // project that already has an owner. A draft with no anchor is inert.
  const claim = await (await projectsCol()).updateOne(
    { id: project.id, businessId: { $exists: false } },
    { $set: { businessId: business.id } },
  )
  if (claim.modifiedCount === 0) {
    const winner = await businessIdForProject(project.id)
    if (winner && winner !== business.id) {
      const anchor = await resolveBusinessAnchor({
        businessId: winner,
        actor,
        permission: "business.read",
      })
      return { businessId: anchor.businessId, applicationId: anchor.applicationId, created: false }
    }
  }

  let application: ConnectedApplicationDoc | undefined
  const url = websiteOf(project)
  if (url) {
    try {
      application = await createApplication({
        businessId: business.id,
        actor,
        name: business.name,
        kind: "marketing_site",
        url,
      })
    } catch {
      // An unparseable address must not block the business from existing; the
      // onboarding stepper still owns the address and will register it there.
      application = undefined
    }
  }

  await linkClaimToBusiness({
    projectId: project.id,
    businessId: business.id,
    applicationId: application?.id,
  })

  return { businessId: business.id, applicationId: application?.id, created: true }
}

/**
 * Stamp the reserved domain claims with the business that now owns them, so a
 * business-addressed read can find its verified hostname. Only unstamped,
 * unreleased rows are touched — a released claim is history and stays as it is.
 */
export async function linkClaimToBusiness(input: {
  projectId: string
  businessId: string
  applicationId?: string
}): Promise<number> {
  const patch: Record<string, unknown> = { businessId: input.businessId }
  if (input.applicationId) patch.applicationId = input.applicationId

  const result = await (await businessDomainsCol()).updateMany(
    { projectId: input.projectId, businessId: { $exists: false }, releasedAt: { $exists: false } },
    { $set: patch },
  )
  return result.modifiedCount ?? 0
}

/** The verified, unreleased hostname a business may be read at, if any. */
export async function verifiedHostnameForBusiness(businessId: string): Promise<string | null> {
  const domain = await (await businessDomainsCol()).findOne({
    businessId,
    verifiedAt: { $exists: true },
    releasedAt: { $exists: false },
  })
  if (!domain || typeof domain.verifiedAt !== "number") return null
  return typeof domain.hostname === "string" ? domain.hostname : null
}

/** True when the account has an active membership in at least one business. */
export async function userHasBusinessMembership(userId: string): Promise<boolean> {
  const member = await (await businessMembersCol()).findOne(
    { userId, status: "active" },
    { projection: { _id: 1 } },
  )
  return Boolean(member)
}
