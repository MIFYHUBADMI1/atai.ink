import "server-only"

import { stepCountIs, streamText } from "ai"

import { logger } from "@/lib/logging/logger"
import { appendCofounderMessages, cofounderMessage } from "./conversation"
import { refundCofounderMessage } from "./credits"
import { MAX_TOOL_STEPS, type AgentTurnInput, type PreparedAgentTurn } from "./agent"
import type { CofounderConversationMessage } from "./types"

/**
 * The streaming co-founder turn.
 *
 * Same prepared turn as the blocking loop (same settings, same tools, same
 * model), but the reply is written as it arrives and tool steps are reported
 * live. Two rules keep the money honest:
 *
 *  - Charge happens before this function is called (the route does it, so a
 *    402 is a real response, not an error frame).
 *  - Refund happens only when NO text arrived. A founder pressing Stop keeps
 *    the partial reply and pays for it; a provider failure before the first
 *    token costs nothing.
 */

export type CofounderStreamEvent =
  | { type: "delta"; text: string }
  | { type: "step"; id: string; toolName: string; status: "running" | "done" | "error"; label: string }
  | { type: "pending_action"; action: PreparedStreamingAction }
  | { type: "error"; code: string; message: string }

export interface PreparedStreamingAction {
  id: string
  toolName: string
  description: string
}

export interface StreamPreparedTurnArgs {
  prepared: PreparedAgentTurn
  user: AgentTurnInput["user"]
  message: string
  conversationId: string
  activeProjectId?: string
  /** Ledger key from the charge that preceded this turn; null for free tiers. */
  chargeKey: string | null
  signal: AbortSignal
  emit: (event: CofounderStreamEvent) => void
}

export interface StreamTurnResult {
  reply: string
  messages: CofounderConversationMessage[]
  preparedActions: PreparedStreamingAction[]
  failed: boolean
}

/** Human labels for the live worklog. Unknown tools fall back to their name. */
const STEP_LABELS: Record<string, string> = {
  prepare_request: "Preparing an action for your approval",
  get_workspace_overview: "Reading your workspace",
  list_projects: "Listing your businesses",
  get_project: "Reading the project",
  get_project_activity: "Reading recent activity",
  get_plan: "Reading the plan",
  analyze_plan: "Analysing the plan",
  get_build_status: "Checking the build",
  get_build_logs: "Reading build logs",
  get_build_conversation: "Reading the build conversation",
  navigate: "Preparing a link",
  get_account_summary: "Reading your account",
  get_credit_costs: "Reading credit costs",
  get_growth_overview: "Reading growth",
  get_product_analytics: "Reading product analytics",
  get_business_assessment: "Reading the business assessment",
  list_growth_tasks: "Reading growth tasks",
  list_campaigns: "Reading campaigns",
  search_marketing_content: "Searching your marketing library",
}

function labelFor(toolName: string): string {
  return STEP_LABELS[toolName] ?? `Running ${toolName.replace(/_/g, " ")}`
}

function readPendingAction(output: unknown): PreparedStreamingAction | null {
  if (!output || typeof output !== "object") return null
  const record = output as Record<string, unknown>
  const data = (record.data && typeof record.data === "object" ? record.data : record) as Record<string, unknown>
  if (typeof data.pendingActionId !== "string") return null
  return {
    id: data.pendingActionId,
    toolName: String(data.toolName ?? ""),
    description: String(data.description ?? ""),
  }
}

export async function streamPreparedTurn(args: StreamPreparedTurnArgs): Promise<StreamTurnResult> {
  const { prepared, user, message, conversationId, activeProjectId, chargeKey, signal, emit } = args
  const { system, prompt, tools, resolved } = prepared

  const userMsg = cofounderMessage("user", message)
  let text = ""
  const preparedActions: PreparedStreamingAction[] = []
  const actionMessages: CofounderConversationMessage[] = []

  const persist = async (): Promise<CofounderConversationMessage[]> => {
    const assistantMsg = cofounderMessage("assistant", text)
    for (const action of preparedActions) {
      actionMessages.push(
        cofounderMessage("assistant", action.description, {
          kind: "pending_action",
          actionId: action.id,
          toolName: action.toolName,
          risk: "CONFIRM",
          description: action.description,
          expiresAt: Date.now() + 15 * 60 * 1000,
        }),
      )
    }
    const messages = [userMsg, assistantMsg, ...actionMessages]
    try {
      await appendCofounderMessages(conversationId, user.id, messages, {
        ...(activeProjectId ? { activeProjectId } : {}),
      })
    } catch (e) {
      // A storage failure must not turn a delivered reply into an error frame.
      logger.error("cofounder.stream", "failed to persist a streamed turn", {
        userId: user.id,
        conversationId,
        message: e instanceof Error ? e.message : String(e),
      })
    }
    return messages
  }

  try {
    const result = streamText({
      model: resolved.model,
      system,
      prompt,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      maxOutputTokens: 4096,
      maxRetries: 1,
      abortSignal: signal,
    })

    let finished = false
    for await (const part of result.fullStream) {
      if (finished) break
      switch (part.type) {
        case "text-delta":
          text += part.text
          emit({ type: "delta", text: part.text })
          break
        case "tool-call":
          emit({
            type: "step",
            id: part.toolCallId,
            toolName: part.toolName,
            status: "running",
            label: labelFor(part.toolName),
          })
          break
        case "tool-result": {
          emit({
            type: "step",
            id: part.toolCallId,
            toolName: part.toolName,
            status: "done",
            label: labelFor(part.toolName),
          })
          if (part.toolName === "prepare_request") {
            const action = readPendingAction(part.output)
            if (action) {
              preparedActions.push(action)
              emit({ type: "pending_action", action })
            }
          }
          break
        }
        case "tool-error":
          emit({
            type: "step",
            id: part.toolCallId,
            toolName: part.toolName,
            status: "error",
            label: labelFor(part.toolName),
          })
          break
        case "error":
          throw part.error
        case "abort":
          throw new Error("The co-founder's reply was stopped.")
        case "finish":
          finished = true
          break
        default:
          break
      }
    }
  } catch (e) {
    const stopped = signal.aborted
    if (!text.trim()) {
      if (chargeKey) {
        await refundCofounderMessage(user.id, conversationId, resolved.tier, chargeKey)
      }
      if (!stopped) {
        logger.warn("cofounder.stream", "turn failed before any text", {
          userId: user.id,
          conversationId,
          message: e instanceof Error ? e.message : String(e),
        })
      }
      emit({
        type: "error",
        code: stopped ? "STOPPED" : "STREAM_FAILED",
        message: stopped ? "Stopped." : "I hit a problem reaching my tools. Please try again in a moment.",
      })
      return { reply: "", messages: [], preparedActions, failed: true }
    }
    // Partial text: keep what the founder already read, and keep it paid for.
    logger.warn("cofounder.stream", "turn ended with partial text", {
      userId: user.id,
      conversationId,
      chars: text.length,
      message: e instanceof Error ? e.message : String(e),
    })
    const messages = await persist()
    return { reply: text, messages, preparedActions, failed: false }
  }

  const messages = await persist()
  return { reply: text, messages, preparedActions, failed: false }
}
