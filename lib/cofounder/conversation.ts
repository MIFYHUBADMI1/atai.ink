import "server-only"
import { ObjectId } from "mongodb"
import { cofounderConversationsCol } from "@/lib/db/collections"
import { cryptoId } from "@/lib/store/id"
import type { CofounderConversationDoc, CofounderConversationMessage } from "./types"

/**
 * Workspace-level Co-founder conversation persistence (spec section 27).
 *
 * The conversation belongs to the USER, not to a project — it survives
 * navigation between surfaces. Message shape reuses the existing
 * `ConversationMessage` conventions (id/role/content/at) plus an optional
 * structured action payload for action cards.
 *
 * The messages array is capped to keep documents small (performance, spec
 * section 77); older context is handled by the prompt layer, not by
 * unbounded history.
 */

const MAX_MESSAGES = 200

export async function getCofounderConversation(id: string, userId: string): Promise<CofounderConversationDoc | null> {
  const col = await cofounderConversationsCol()
  const doc = await col.findOne({ id, userId })
  if (!doc) return null
  return {
    id: doc.id,
    userId: doc.userId,
    messages: doc.messages ?? [],
    activeProjectId: doc.activeProjectId,
    projectContextReferences: doc.projectContextReferences ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

/** Load the user's most recent conversation, or null. */
export async function getLatestCofounderConversation(userId: string): Promise<CofounderConversationDoc | null> {
  const col = await cofounderConversationsCol()
  const doc = await col.find({ userId }).sort({ updatedAt: -1 }).limit(1).next()
  if (!doc) return null
  return {
    id: doc.id,
    userId: doc.userId,
    messages: doc.messages ?? [],
    activeProjectId: doc.activeProjectId,
    projectContextReferences: doc.projectContextReferences ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export async function createCofounderConversation(userId: string, activeProjectId?: string): Promise<CofounderConversationDoc> {
  const now = Date.now()
  const doc: CofounderConversationDoc = {
    id: `cc_${cryptoId()}`,
    userId,
    messages: [],
    activeProjectId,
    projectContextReferences: activeProjectId ? [activeProjectId] : [],
    createdAt: now,
    updatedAt: now,
  }
  const col = await cofounderConversationsCol()
  await col.insertOne({ ...doc, _id: new ObjectId() })
  return doc
}

/** Append messages and update the conversation's project context in one write. */
export async function appendCofounderMessages(
  conversationId: string,
  userId: string,
  messages: CofounderConversationMessage[],
  context?: { activeProjectId?: string },
): Promise<void> {
  const col = await cofounderConversationsCol()
  const set: Record<string, unknown> = {
    updatedAt: Date.now(),
  }
  if (messages.length) {
    // Push capped: slice client-side before $push to keep the doc bounded.
    for (const m of messages) {
      await col.updateOne(
        { id: conversationId, userId },
        {
          $push: { messages: { $each: [m], $slice: -MAX_MESSAGES } },
          $set: set,
        },
      )
    }
  } else {
    await col.updateOne({ id: conversationId, userId }, { $set: set })
  }
  if (context?.activeProjectId !== undefined) {
    await col.updateOne(
      { id: conversationId, userId },
      {
        $set: { activeProjectId: context.activeProjectId, updatedAt: Date.now() },
        ...(context.activeProjectId
          ? { $addToSet: { projectContextReferences: context.activeProjectId } }
          : {}),
      },
    )
  }
}

/** Build a conversation message record with the shared shape. */
export function cofounderMessage(
  role: CofounderConversationMessage["role"],
  content: string,
  action?: CofounderConversationMessage["action"],
): CofounderConversationMessage {
  return { id: cryptoId(), role, content, at: Date.now(), ...(action ? { action } : {}) }
}

/** Bounded multi-turn memory for the workspace agent (Phase 0 W4 / D-02).
 * At most this many recent whole messages are replayed into a turn. */
export const MAX_HISTORY_MESSAGES = 12
/** Soft character ceiling for the replayed transcript. Older whole messages
 * are trimmed to stay under it; the most recent turn always survives. */
export const MAX_HISTORY_CHARS = 12_000

/**
 * Render prior conversation turns into a compact, role-labelled transcript for
 * replay into the agent prompt. The caller passes ONLY earlier turns (the
 * current founder message is persisted after the model call, so it is never in
 * this list) — this helper does not deduplicate the current message.
 *
 * Each message is flattened to a single line so a prior turn cannot pose as a
 * structural prompt delimiter; the prompt layer wraps the result as untrusted
 * content. Bounds trim the OLDEST messages first, keeping recent continuity.
 */
export function buildHistoryBlock(messages: CofounderConversationMessage[]): string {
  if (!messages?.length) return ""
  const recent = messages.slice(-MAX_HISTORY_MESSAGES)
  const lines: string[] = []
  let used = 0
  // Walk newest → oldest so the most recent context always survives the bound.
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i]
    const content = (m.content ?? "").replace(/\s+/g, " ").trim()
    if (!content) continue
    const role = m.role === "user" ? "Founder" : m.role === "assistant" ? "You" : "System"
    const line = `${role}: ${content}`
    if (lines.length && used + line.length > MAX_HISTORY_CHARS) break
    lines.unshift(line)
    used += line.length
  }
  return lines.join("\n")
}
