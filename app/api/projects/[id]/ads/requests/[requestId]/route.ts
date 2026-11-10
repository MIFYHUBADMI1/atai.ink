import { z } from "zod"
import { requireUser } from "@/lib/auth/session"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { checkProjectOwnership } from "@/lib/runtime/ownership"
import { getAdRequest, listAdRequestEvents } from "@/lib/marketing/ads/requests"
import {
  addAdRequestNote,
  acceptProposal,
  declineProposal,
  cancelAdRequest,
} from "@/lib/marketing/ads/lifecycle"
import { chargeAdRequest } from "@/lib/marketing/ads/billing"
import { listActivities, listPerformance } from "@/lib/marketing/ads/operations"
import {
  publicActivityView,
  publicEventView,
  publicPerformanceView,
  publicRequestView,
} from "@/lib/marketing/ads/views"
import { getAvailableCredits } from "@/lib/billing/credit-service"

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("message"), body: z.string().min(1).max(4000) }).strict(),
  z.object({ action: z.literal("cancel"), reason: z.string().max(1000).optional() }).strict(),
  z.object({ action: z.literal("accept_proposal") }).strict(),
  z.object({ action: z.literal("decline_proposal"), reason: z.string().max(1000).optional() }).strict(),
  z.object({ action: z.literal("pay"), idempotencyKey: z.string().min(8).max(120) }).strict(),
])

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  try {
    const user = await requireUser()
    const { id, requestId } = await params
    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    const request = await getAdRequest(id, requestId)
    if (!request || request.userId !== user.id) {
      return fail("VALIDATION", "We couldn't find that campaign request.", 404)
    }

    const [events, activities, performance, creditsAvailable] = await Promise.all([
      listAdRequestEvents(id, requestId, { includeInternal: false }),
      listActivities(requestId),
      listPerformance(requestId),
      getAvailableCredits(user.id).catch(() => null),
    ])

    return ok({
      request: publicRequestView(request),
      events: events.map(publicEventView),
      activities: activities.map(publicActivityView),
      performance: performance.map(publicPerformanceView),
      creditsAvailable,
    })
  } catch (e) {
    return handleRouteError("api.projects.ads.request.get", e)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  try {
    const user = await requireUser()
    const { id, requestId } = await params
    await checkRateLimit({
      action: "ad_request_action",
      identifier: user.id,
      limit: 40,
      windowMs: 60 * 60 * 1000,
    })
    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    const existing = await getAdRequest(id, requestId)
    if (!existing || existing.userId !== user.id) {
      return fail("VALIDATION", "We couldn't find that campaign request.", 404)
    }

    const parsed = ActionSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail("VALIDATION", "Check the request and try again.", 422)

    let request = existing
    const action = parsed.data.action
    if (action === "message") {
      request = await addAdRequestNote({
        requestId,
        actorUserId: user.id,
        actor: "founder",
        body: parsed.data.body,
        visibility: "founder",
      })
    } else if (action === "cancel") {
      request = await cancelAdRequest({
        requestId,
        userId: user.id,
        actor: "founder",
        reason: parsed.data.reason,
      })
    } else if (action === "accept_proposal") {
      request = await acceptProposal({ requestId, userId: user.id })
    } else if (action === "decline_proposal") {
      request = await declineProposal({ requestId, userId: user.id, reason: parsed.data.reason })
    } else {
      request = await chargeAdRequest({
        requestId,
        userId: user.id,
        idempotencyKey: parsed.data.idempotencyKey,
      })
    }

    const [events, activities, performance, creditsAvailable] = await Promise.all([
      listAdRequestEvents(id, requestId, { includeInternal: false }),
      listActivities(requestId),
      listPerformance(requestId),
      getAvailableCredits(user.id).catch(() => null),
    ])

    return ok({
      request: publicRequestView(request),
      events: events.map(publicEventView),
      activities: activities.map(publicActivityView),
      performance: performance.map(publicPerformanceView),
      creditsAvailable,
    })
  } catch (e) {
    return handleRouteError("api.projects.ads.request.post", e)
  }
}
