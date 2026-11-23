import "server-only"

import { z } from "zod"

import { withAiProtection } from "@/lib/api/ai-protection"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { MAX_TOOL_STEPS, runAgentTurn } from "@/lib/cofounder/agent"
import { resolveBusinessAnchor } from "@/lib/connected-business/anchor"
import { resolveBusinessConversation } from "@/lib/connected-business/cofounder"

/**
 * POST /api/businesses/[businessId]/cofounder — one planning turn.
 *
 * The same agent as `/api/cofounder`, pinned to the operate surface
 * (`currentSurface: "business"`), which removes every build, deploy and
 * plan-at-build tool. A business planning turn therefore cannot propose work
 * that belongs to the build workspace, and it keeps its own conversation so the
 * build transcript is never replayed here.
 */
const BodySchema = z
  .object({
    conversationId: z.string().min(1).max(80).optional(),
    message: z.string().min(1).max(8000),
  })
  .strip()

export const POST = withAiProtection("chat", post)

async function post(req: Request, context: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")

    const { businessId } = await context.params

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail("VALIDATION", "That message didn't look right.", 422)

    const anchor = await resolveBusinessAnchor({
      businessId,
      actor: actorOf(user),
      permission: "growth.read",
    })
    const conversation = await resolveBusinessConversation(
      user.id,
      anchor.projectId,
      parsed.data.conversationId,
    )

    const turn = await runAgentTurn({
      user: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified },
      message: parsed.data.message,
      conversationId: conversation.id,
      history: conversation.messages,
      activeProjectId: anchor.projectId,
      activeBusinessId: businessId,
      currentRoute: `/business/${businessId}/plan`,
      currentSurface: "business",
    })

    return ok({
      conversationId: conversation.id,
      reply: turn.reply,
      messages: turn.messages,
      preparedActions: turn.preparedActions,
      maxToolSteps: MAX_TOOL_STEPS,
    })
  } catch (error) {
    return handleRouteError("api.businesses.cofounder.post", error)
  }
}
