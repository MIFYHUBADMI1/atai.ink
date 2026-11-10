import { z } from "zod"
import { requireAdmin } from "@/lib/auth/session"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import {
  AD_ACTIVITY_STATUSES,
  AD_PERFORMANCE_SOURCES,
  AD_REQUEST_PRIORITIES,
  isAdRequestStatus,
} from "@/lib/types/ads"
import { getAdRequestById, listAdRequestEventsById } from "@/lib/marketing/ads/requests"
import {
  addAdRequestNote,
  assignAdRequest,
  issueProposal,
  requestMoreInfo,
  setAdRequestPriority,
  transitionAdRequest,
} from "@/lib/marketing/ads/lifecycle"
import { refundAdRequest } from "@/lib/marketing/ads/billing"
import { addActivity, addPerformance, listActivities, listPerformance, updateActivity } from "@/lib/marketing/ads/operations"
import { buildCampaignDossier } from "@/lib/marketing/ads/dossier"
import { publicPackageView } from "@/lib/marketing/ads/views"
import { listPricingPackages } from "@/lib/marketing/ads/pricing"

const PatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), status: z.string(), detail: z.string().max(2000).optional() }).strict(),
  z.object({ action: z.literal("assign") }).strict(),
  z.object({ action: z.literal("priority"), priority: z.enum(AD_REQUEST_PRIORITIES) }).strict(),
  z.object({ action: z.literal("internal_note"), body: z.string().min(1).max(4000) }).strict(),
  z.object({ action: z.literal("message"), body: z.string().min(1).max(4000) }).strict(),
  z.object({ action: z.literal("request_info"), body: z.string().min(1).max(4000) }).strict(),
  z.object({ action: z.literal("reject"), detail: z.string().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("proposal"), draft: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal("refund"), reason: z.string().max(1000).optional() }).strict(),
  z
    .object({
      action: z.literal("add_activity"),
      title: z.string().min(1).max(160),
      notes: z.string().max(2000).optional(),
      channel: z.string().max(80).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("update_activity"),
      activityId: z.string().min(1),
      status: z.enum(AD_ACTIVITY_STATUSES).optional(),
      notes: z.string().max(2000).optional(),
      channel: z.string().max(80).optional(),
      publicationUrl: z.string().max(500).optional(),
      account: z.string().max(160).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("add_performance"),
      metric: z.string().min(1).max(80),
      value: z.number().nonnegative(),
      source: z.enum(AD_PERFORMANCE_SOURCES),
      evidenceUrl: z.string().max(500).optional(),
      note: z.string().max(800).optional(),
    })
    .strict(),
])

async function payload(requestId: string) {
  const request = await getAdRequestById(requestId)
  if (!request) return null
  const [dossier, events, activities, performance, packages] = await Promise.all([
    buildCampaignDossier(request),
    listAdRequestEventsById(requestId, { includeInternal: true }),
    listActivities(requestId),
    listPerformance(requestId),
    listPricingPackages({ includeInactive: true }),
  ])
  return {
    request,
    dossier,
    events,
    activities,
    performance,
    packages: packages.map(publicPackageView),
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const data = await payload(id)
    if (!data) return fail("VALIDATION", "We couldn't find that campaign request.", 404)
    return ok(data)
  } catch (e) {
    return handleRouteError("api.admin.ads.get", e)
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const existing = await getAdRequestById(id)
    if (!existing) return fail("VALIDATION", "We couldn't find that campaign request.", 404)

    const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail("VALIDATION", "Check the request and try again.", 422)
    const body = parsed.data

    if (body.action === "status") {
      if (!isAdRequestStatus(body.status)) return fail("VALIDATION")
      await transitionAdRequest({
        requestId: id,
        to: body.status,
        actor: "admin",
        actorUserId: admin.id,
        detail: body.detail,
      })
    } else if (body.action === "assign") {
      await assignAdRequest({ requestId: id, adminId: admin.id, adminEmail: admin.email })
    } else if (body.action === "priority") {
      await setAdRequestPriority({ requestId: id, adminId: admin.id, priority: body.priority })
    } else if (body.action === "internal_note") {
      await addAdRequestNote({
        requestId: id,
        actorUserId: admin.id,
        actor: "admin",
        body: body.body,
        visibility: "internal",
      })
    } else if (body.action === "message") {
      await addAdRequestNote({
        requestId: id,
        actorUserId: admin.id,
        actor: "admin",
        body: body.body,
        visibility: "founder",
      })
    } else if (body.action === "request_info") {
      await requestMoreInfo({ requestId: id, adminId: admin.id, body: body.body })
    } else if (body.action === "reject") {
      await transitionAdRequest({
        requestId: id,
        to: "rejected",
        actor: "admin",
        actorUserId: admin.id,
        detail: body.detail,
      })
    } else if (body.action === "proposal") {
      await issueProposal({ requestId: id, adminId: admin.id, draft: body.draft })
    } else if (body.action === "refund") {
      await refundAdRequest({ requestId: id, adminId: admin.id, reason: body.reason })
    } else if (body.action === "add_activity") {
      await addActivity({
        requestId: id,
        adminId: admin.id,
        title: body.title,
        notes: body.notes,
        channel: body.channel,
      })
    } else if (body.action === "update_activity") {
      await updateActivity({
        requestId: id,
        activityId: body.activityId,
        adminId: admin.id,
        status: body.status,
        notes: body.notes,
        channel: body.channel,
        publicationUrl: body.publicationUrl,
        account: body.account,
      })
    } else {
      await addPerformance({
        requestId: id,
        adminId: admin.id,
        metric: body.metric,
        value: body.value,
        source: body.source,
        evidenceUrl: body.evidenceUrl,
        note: body.note,
      })
    }

    const data = await payload(id)
    if (!data) return fail("VALIDATION", "We couldn't find that campaign request.", 404)
    return ok(data)
  } catch (e) {
    return handleRouteError("api.admin.ads.patch", e)
  }
}
