import "server-only"

import { AppError } from "@/lib/errors"
import { store } from "@/lib/store/store"
import { businessWorkspaceAccess } from "@/lib/business/flags"
import { userActor } from "@/lib/business/permissions"
import { resolveBusinessAnchor } from "./anchor"
import { resolveBusinessConversation } from "./cofounder"
import {
  resolveCofounderConversation,
} from "@/lib/cofounder/conversation"
import type { CofounderConversationDoc } from "@/lib/cofounder/types"
import type { CofounderScope } from "@/lib/cofounder/workspace-types"

/**
 * The one bridge between the co-founder engine and connected businesses.
 *
 * `lib/cofounder` must not import `lib/business` (enforced by
 * `lib/business/independence.test.ts`), so the business → conversation and
 * business → anchor resolution lives here, where both sides are importable.
 *
 * A business turn is authorised by membership (`growth.read`), but the anchor
 * project is what the shared engine actually reads and charges against.
 */

export type { CofounderScope }

export interface ResolvedCofounderScope {
  scope: CofounderScope
  activeProjectId?: string
  activeBusinessId?: string
  currentSurface: "build" | "business"
  conversation: CofounderConversationDoc
}

export async function resolveCofounderScope(
  user: { id: string },
  options: { scope?: CofounderScope; conversationId?: string } = {},
): Promise<ResolvedCofounderScope> {
  const scope: CofounderScope = options.scope ?? { kind: "none" }

  if (scope.kind === "business") {
    const access = await businessWorkspaceAccess(user.id)
    if (!access.enabled) {
      throw new AppError("BUSINESS_NOT_FOUND", "We couldn't find that business.", 404)
    }
    const anchor = await resolveBusinessAnchor({
      businessId: scope.id,
      actor: userActor(user.id),
      permission: "growth.read",
    })
    const conversation = await resolveBusinessConversation(
      user.id,
      anchor.projectId,
      options.conversationId,
    )
    return {
      scope,
      activeProjectId: anchor.projectId,
      activeBusinessId: scope.id,
      currentSurface: "business",
      conversation,
    }
  }

  if (scope.kind === "project") {
    const project = await store.getProject(scope.id)
    if (!project || project.userId !== user.id) {
      throw new AppError("NOT_FOUND", "We couldn't find that project.", 404)
    }
    const conversation = await resolveCofounderConversation(user.id, {
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      activeProjectId: project.id,
    })
    return {
      scope,
      activeProjectId: project.id,
      currentSurface: "build",
      conversation,
    }
  }

  const conversation = await resolveCofounderConversation(user.id, {
    ...(options.conversationId ? { conversationId: options.conversationId } : {}),
  })
  return { scope: { kind: "none" }, currentSurface: "build", conversation }
}
