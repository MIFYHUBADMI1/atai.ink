import "server-only"

import type { NextRequest } from "next/server"
import { z } from "zod"

import { withAiProtection } from "@/lib/api/ai-protection"
import { aiSignal, trackAiCompletion } from "@/lib/api/ai-context"
import { fail, failInsufficientCredits, handleRouteError } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { getAvailableCredits } from "@/lib/billing/credit-service"
import { AppError } from "@/lib/errors"
import { AGENT_TURN_TIMEOUT_MS, MAX_TOOL_STEPS, prepareAgentTurn } from "@/lib/cofounder/agent"
import { streamPreparedTurn } from "@/lib/cofounder/agent-stream"
import { chargeCofounderMessage } from "@/lib/cofounder/credits"
import { resolveCofounderScope } from "@/lib/connected-business/cofounder-scope"

/**
 * POST /api/cofounder/stream — one streamed co-founder turn.
 *
 * NDJSON frames: `{ conversationId }`, `{ delta }`, `{ step }`,
 * `{ pending_action }`, then either `{ done: true, … }` or `{ error }`.
 *
 * The charge happens before the response headers are written, so an
 * insufficient balance is a real 402 the client can show a top-up for — not an
 * error frame inside a stream that already started.
 */

export const runtime = "nodejs"
export const maxDuration = 300

const ScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("project"), id: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal("business"), id: z.string().min(1).max(80) }).strict(),
])

const BodySchema = z
  .object({
    conversationId: z.string().min(1).max(80).optional(),
    message: z.string().min(1).max(8000),
    scope: ScopeSchema.optional(),
  })
  .strip()

export const POST = withAiProtection("chat", post)

async function post(req: NextRequest) {
  try {
    const user = await requireUser()
    await checkRateLimit({
      action: "cofounder_message",
      identifier: user.id,
      limit: 30,
      windowMs: 10 * 60 * 1000,
    })

    const body = BodySchema.safeParse(await req.json().catch(() => ({})))
    if (!body.success) {
      return fail("VALIDATION", "That message didn't look right.", 422)
    }

    const resolvedScope = await resolveCofounderScope(user, {
      ...(body.data.scope ? { scope: body.data.scope } : {}),
      ...(body.data.conversationId ? { conversationId: body.data.conversationId } : {}),
    })
    const conversationId = resolvedScope.conversation.id

    const agentUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    }

    const prepared = await prepareAgentTurn({
      user: agentUser,
      message: body.data.message,
      conversationId,
      history: resolvedScope.conversation.messages,
      ...(resolvedScope.activeProjectId ? { activeProjectId: resolvedScope.activeProjectId } : {}),
      ...(resolvedScope.activeBusinessId ? { activeBusinessId: resolvedScope.activeBusinessId } : {}),
      currentRoute: "/cofounder",
      currentSurface: resolvedScope.currentSurface,
    })

    let chargeKey: string | null
    try {
      chargeKey = await chargeCofounderMessage(user.id, conversationId, prepared.resolved.tier)
    } catch (e) {
      if (e instanceof AppError && e.code === "INSUFFICIENT_CREDITS") {
        const available = await getAvailableCredits(user.id).catch(() => 0)
        return failInsufficientCredits({
          required: prepared.resolved.tier.creditsPerMessage,
          available,
          meta: {
            tier: prepared.resolved.tier.id,
            engine: prepared.resolved.tier.name,
            surface: prepared.surface,
          },
        })
      }
      throw e
    }

    const signal = aiSignal(AbortSignal.timeout(AGENT_TURN_TIMEOUT_MS))
    let resolveCompletion: () => void = () => {}
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })
    trackAiCompletion(completion)

    const encoder = new TextEncoder()
    let closed = false

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (frame: Record<string, unknown>) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
          } catch {
            closed = true
          }
        }

        send({ conversationId })

        try {
          const result = await streamPreparedTurn({
            prepared,
            user: agentUser,
            message: body.data.message,
            conversationId,
            ...(resolvedScope.activeProjectId ? { activeProjectId: resolvedScope.activeProjectId } : {}),
            chargeKey,
            signal,
            emit: (event) => {
              switch (event.type) {
                case "delta":
                  send({ delta: event.text })
                  break
                case "step":
                  send({
                    step: {
                      id: event.id,
                      toolName: event.toolName,
                      status: event.status,
                      label: event.label,
                    },
                  })
                  break
                case "pending_action":
                  send({ pending_action: event.action })
                  break
                case "error":
                  send({ error: { code: event.code, message: event.message } })
                  break
              }
            },
          })

          if (!result.failed) {
            send({
              done: true,
              conversationId,
              reply: result.reply,
              messages: result.messages,
              preparedActions: result.preparedActions,
              maxToolSteps: MAX_TOOL_STEPS,
              scope: resolvedScope.scope,
            })
          }
        } catch (e) {
          send({
            error: {
              code: "STREAM_FAILED",
              message: "The co-founder's reply ended unexpectedly. Please try again.",
            },
          })
          void e
        } finally {
          resolveCompletion()
          closed = true
          try {
            controller.close()
          } catch {
            // already closed by the client
          }
        }
      },
      cancel() {
        resolveCompletion()
      },
    })

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
      },
    })
  } catch (e) {
    return handleRouteError("api.cofounder.stream.post", e)
  }
}
