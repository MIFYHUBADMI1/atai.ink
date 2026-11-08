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
import { generateAdsKitSlot, ADS_KIT_SLOTS } from "@/lib/marketing/studio/ads-kit"
import { clean } from "@/lib/marketing/studio/market-content"

/**
 * POST /api/projects/[id]/market/ads-kit
 *
 * The ads bench. The founder describes the offer once; each ad-relevant piece
 * (platform copy, image creatives) is drafted one at a time through the
 * studio's generation pipeline, streamed as NDJSON so the UI can show staged
 * progress:
 *
 *   {meta:{slots:[{slot,label}]}}
 *   {slot,status:"started"}
 *   {slot,status:"done",item:{id,title,body,kind,creditsCharged,createdAt,media?}}
 *   {slot,status:"failed",message}
 *   {done:true,generated,failed,creditsCharged}
 *
 * A slot failure never aborts the kit. Billing is per runtime call inside the
 * generation — no up-front kit charge. Nothing is published to any ad
 * platform; every piece is a draft to copy by hand.
 */

const PostSchema = z
  .object({
    offer: z.string().min(1).max(600),
    audience: z.string().min(1).max(300).optional(),
    slots: z.array(z.string().min(1).max(60)).max(ADS_KIT_SLOTS.length).optional(),
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

    const availability = capabilityAvailability()
    const textReady = Boolean(availability["ai.text"]?.configured)
    const imageReady = Boolean(availability["ai.image"]?.configured)
    if (!textReady && !imageReady) {
      return fail("AI_UNAVAILABLE", "AI generation isn't configured on this deployment yet.", 503)
    }

    const parsed = PostSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail("VALIDATION", "Describe the offer first — one or two sentences is enough.", 422)

    const offer = clean(parsed.data.offer, 600)
    if (!offer) return fail("VALIDATION", "Describe the offer first — one or two sentences is enough.", 422)

    const requested = new Set(parsed.data.slots ?? ADS_KIT_SLOTS.map((slot) => slot.slot))
    const slots = ADS_KIT_SLOTS.filter((slot) => requested.has(slot.slot) && (slot.kind === "image" ? imageReady : textReady))
    if (slots.length === 0) {
      return fail("VALIDATION", "None of the requested pieces can be generated on this deployment right now.", 422)
    }

    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "Project not found.", 404)
    }

    const ownerGoals = readOwnerGoals(user)
    const audience = parsed.data.audience ? clean(parsed.data.audience, 300) : undefined

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

        send({ meta: { slots: slots.map((slot) => ({ slot: slot.slot, label: slot.label, kind: slot.kind })) } })

        let generated = 0
        let failed = 0
        let creditsCharged = 0

        for (const slot of slots) {
          if (stopped) break
          send({ slot: slot.slot, status: "started" })
          try {
            const item = await generateAdsKitSlot({
              userId: user.id,
              projectId: id,
              slotId: slot.slot,
              offer,
              ...(audience ? { audience } : {}),
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
                kind: item.kind,
                creditsCharged: item.creditsCharged,
                createdAt: item.createdAt,
                ...(item.media ? { media: item.media } : {}),
              },
            })
          } catch (e) {
            failed += 1
            logger.warn("api.projects.market.adsKit", "ads slot generation failed", {
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
    return handleRouteError("api.projects.market.adsKit", e)
  }
}
