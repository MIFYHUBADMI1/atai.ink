import { z } from "zod"
import { requireUser } from "@/lib/auth/session"
import { fail, handleRouteError } from "@/lib/api/respond"
import { checkProjectOwnership } from "@/lib/runtime/ownership"
import { isMarketStudioEnabled } from "@/lib/marketing/feature-flags"
import { capabilityAvailability } from "@/lib/runtime/router/adapters/availability"
import { store } from "@/lib/store/store"
import { logger } from "@/lib/logging/logger"
import { AppError } from "@/lib/errors"
import { withAiProtection } from "@/lib/api/ai-protection"
import { readOwnerGoals } from "@/lib/marketing/growth-overview"
import { generateLaunchKitSlot, LAUNCH_KIT_SLOTS } from "@/lib/marketing/studio/launch-kit"

/**
 * POST /api/projects/[id]/market/launch-kit
 *
 * The "Market my app for me" pass. Generates the founder's launch package one
 * piece at a time through the studio's generation pipeline, streaming NDJSON
 * frames so the UI can show staged progress:
 *
 *   {meta:{slots:[{slot,label}]}}
 *   {slot,status:"started"}
 *   {slot,status:"done",item:{id,title,body,creditsCharged,createdAt}}
 *   {slot,status:"failed",message}
 *   {done:true,generated,failed,creditsCharged}
 *
 * A slot failure never aborts the kit: the remaining pieces still generate,
 * and the failed slot can be retried on its own. Billing is per runtime call
 * inside the generation (the studio's normal path) — no up-front kit charge.
 */

const PostSchema = z
  .object({
    slots: z.array(z.string().min(1).max(60)).max(LAUNCH_KIT_SLOTS.length).optional(),
  })
  .strict()

export const POST = withAiProtection("studio", post)

async function post(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params

    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    if (!isMarketStudioEnabled()) {
      return fail("FEATURE_DISABLED", "The AI content studio isn't available right now.", 403)
    }

    const textReady = Boolean(capabilityAvailability()["ai.text"]?.configured)
    if (!textReady) {
      return fail("AI_UNAVAILABLE", "Text generation isn't configured on this deployment yet.", 503)
    }

    const parsed = PostSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail("VALIDATION", "Check the requested pieces and try again.", 422)

    const requested = new Set(parsed.data.slots ?? LAUNCH_KIT_SLOTS.map((slot) => slot.slot))
    const slots = LAUNCH_KIT_SLOTS.filter((slot) => requested.has(slot.slot))
    if (slots.length === 0) return fail("VALIDATION", "No known kit pieces were requested.", 422)

    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "Project not found.", 404)
    }
    if (!project.specification) {
      return fail("VALIDATION", "The launch kit writes from your plan — this project has no plan yet.", 409)
    }

    const ownerGoals = readOwnerGoals(user)

    const encoder = new TextEncoder()
    let stopped = false

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (value: unknown) => {
          if (stopped) return
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
          } catch {
            // The response is gone; keep working, just stop talking.
            stopped = true
          }
        }

        send({ meta: { slots: slots.map((slot) => ({ slot: slot.slot, label: slot.label })) } })

        let generated = 0
        let failed = 0
        let creditsCharged = 0

        for (const slot of slots) {
          if (stopped) break
          send({ slot: slot.slot, status: "started" })
          try {
            const item = await generateLaunchKitSlot({
              userId: user.id,
              projectId: id,
              slotId: slot.slot,
              project,
              ownerGoals,
            })
            generated += 1
            creditsCharged += item.creditsCharged
            send({
              slot: slot.slot,
              status: "done",
              item: {
                id: item.id,
                title: item.title,
                body: item.body,
                creditsCharged: item.creditsCharged,
                createdAt: item.createdAt,
              },
            })
          } catch (e) {
            failed += 1
            logger.warn("api.projects.market.launchKit", "kit slot generation failed", {
              projectId: id,
              slot: slot.slot,
              message: e instanceof Error ? e.message : String(e),
            })
            send({
              slot: slot.slot,
              status: "failed",
              message:
                e instanceof AppError && e.message
                  ? e.message
                  : "This piece didn't generate — you can retry just this piece.",
            })
          }
        }

        send({ done: true, generated, failed, creditsCharged })
        try {
          controller.close()
        } catch {
          // Already closed by the cancel path.
        }
      },
      cancel() {
        stopped = true
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
    return handleRouteError("api.projects.market.launchKit", e)
  }
}
