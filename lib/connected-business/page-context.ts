import "server-only"

import { notFound } from "next/navigation"

import { getCurrentUser } from "@/lib/auth/session"
import { requireBusinessAccess } from "@/lib/business/access"
import { userActor, type Actor, type Permission } from "@/lib/business/permissions"
import { AppError } from "@/lib/errors"
import { store } from "@/lib/store/store"
import type { BusinessDoc } from "@/lib/types/business"
import type { MirrorProject } from "@/lib/types/project"
import { resolveBusinessAnchor, type BusinessAnchor } from "./anchor"
import { withoutMongoId } from "./client-docs"

/**
 * The one preamble every business page shares: session, surface, permission,
 * anchor and the anchor project. A page that skips it skips the gate, so the
 * authorisation-coverage rule is easier to keep when there is one helper.
 */
export interface BusinessPageContext {
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
  actor: Actor
  business: BusinessDoc
  anchor: BusinessAnchor | null
  project: MirrorProject | null
}

export async function businessPageContext(
  businessId: string,
  permission: Permission = "business.read",
): Promise<BusinessPageContext> {
  const user = await getCurrentUser()
  if (!user) notFound()

  const actor = userActor(user.id)

  let business: BusinessDoc
  try {
    const access = await requireBusinessAccess({ businessId, actor, permission })
    // Pages hand this document to Client Components (BusinessWorkspace). The
    // Mongo `_id` is an ObjectId and cannot cross that boundary.
    business = withoutMongoId(access.business)
  } catch (error) {
    if (error instanceof AppError) notFound()
    throw error
  }

  // Only "this business has no anchor yet" is a normal state. Anything else —
  // a database failure, a permission change — must surface, not silently render
  // as an unconnected business.
  let anchor: BusinessAnchor | null = null
  try {
    anchor = await resolveBusinessAnchor({ businessId, actor, permission })
  } catch (error) {
    if (error instanceof AppError && error.code === "BUSINESS_NOT_MIGRATED") anchor = null
    else throw error
  }

  const project = anchor ? await store.getProject(anchor.projectId) : null
  return { user, actor, business, anchor, project }
}
