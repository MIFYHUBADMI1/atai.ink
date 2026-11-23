import "server-only"

import {
  createCofounderConversation,
  getCofounderConversation,
  getLatestCofounderConversation,
} from "@/lib/cofounder/conversation"
import type { CofounderConversationDoc } from "@/lib/cofounder/types"

/**
 * A connected business gets its own co-founder conversation.
 *
 * Conversations are user-scoped and reused across navigation, so without this
 * a business plan page would replay the build conversation — the exact leak the
 * two-surface rule exists to prevent. A conversation is "this business's" when
 * its `activeProjectId` is the business's anchor project.
 */
export async function findBusinessConversation(
  userId: string,
  projectId: string,
): Promise<CofounderConversationDoc | null> {
  const latest = await getLatestCofounderConversation(userId)
  return latest && latest.activeProjectId === projectId ? latest : null
}

export async function resolveBusinessConversation(
  userId: string,
  projectId: string,
  conversationId?: string,
): Promise<CofounderConversationDoc> {
  if (conversationId) {
    const found = await getCofounderConversation(conversationId, userId)
    if (found && found.activeProjectId === projectId) return found
  }
  return (await findBusinessConversation(userId, projectId)) ?? createCofounderConversation(userId, projectId)
}
