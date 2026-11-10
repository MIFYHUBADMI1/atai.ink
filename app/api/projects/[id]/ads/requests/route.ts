import { z } from "zod"
import { requireUser } from "@/lib/auth/session"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { checkProjectOwnership } from "@/lib/runtime/ownership"
import { createAdRequest, listAdRequests } from "@/lib/marketing/ads/requests"
import { notifyAdRequestSubmitted } from "@/lib/marketing/ads/request-notifications"
import { AD_REQUEST_BOUNDS } from "@/lib/marketing/ads/request-shared"
import { AD_REQUEST_CREATION_MODES } from "@/lib/types/ads"

/**
 * POST /api/projects/[id]/ads/requests — submit a "Promote My Business"
 * request. FREE (no credits); idempotent on the client-generated key so
 * double-clicks and network retries never create duplicates.
 * GET  — the founder's request history for this project.
 */

const B = AD_REQUEST_BOUNDS

const AssetSchema = z
  .object({
    url: z.string().max(B.assetUrl),
    label: z.string().max(B.assetLabel),
    kind: z.enum([
      "logo",
      "screenshot",
      "promo_image",
      "product_image",
      "video",
      "existing_ad",
      "brand_guidelines",
      "document",
      "other",
    ]),
  })
  .strict()

const SubmissionSchema = z
  .object({
    business: z
      .object({
        name: z.string().min(1).max(B.name),
        liveUrl: z.string().min(1).max(B.liveUrl),
        description: z.string().max(B.description).default(""),
        industry: z.string().max(B.industry).default(""),
        targetAudience: z.string().max(B.targetAudience).default(""),
        mainProduct: z.string().max(B.mainProduct).default(""),
        location: z.string().max(B.location).default(""),
        contact: z.string().max(B.contact).default(""),
        socialLinks: z.array(z.string().max(B.socialLink)).max(B.socialLinks).default([]),
        pricingInfo: z.string().max(B.pricingInfo).default(""),
        stage: z.string().max(B.stage).default(""),
      })
      .strict(),
    promote: z
      .object({
        goals: z.array(z.string().max(B.goal)).max(B.goals).default([]),
        pitch: z.string().min(1).max(B.pitch),
        context: z.string().max(B.context).default(""),
      })
      .strict(),
    audience: z
      .object({
        who: z.string().max(B.who).default(""),
        ageRange: z.string().max(B.ageRange).default(""),
        countries: z.string().max(B.countries).default(""),
        regions: z.string().max(B.regions).default(""),
        interests: z.string().max(B.interests).default(""),
        customerType: z.string().max(B.customerType).default(""),
        problems: z.string().max(B.problems).default(""),
        profile: z.string().max(B.profile).default(""),
      })
      .strict(),
    preferences: z
      .object({
        objective: z.string().max(B.objective).default(""),
        channels: z.array(z.string().max(B.channel)).max(B.channels).default([]),
        duration: z.string().max(B.duration).default(""),
        startDate: z.string().max(B.startDate).default(""),
        frequency: z.string().max(B.frequency).default(""),
        contentFormat: z.string().max(B.contentFormat).default(""),
        brandVoice: z.string().max(B.brandVoice).default(""),
        callToAction: z.string().max(B.callToAction).default(""),
        budgetNote: z.string().max(B.budgetNote).default(""),
        instructions: z.string().max(B.instructions).default(""),
      })
      .strict(),
    assets: z.array(AssetSchema).max(B.assets).default([]),
    creation: z
      .object({
        mode: z.enum(AD_REQUEST_CREATION_MODES),
        vision: z.string().max(B.vision).default(""),
      })
      .strict(),
    confirmations: z
      .object({
        urlCorrect: z.literal(true),
        infoAccurate: z.literal(true),
        assetsAuthorized: z.literal(true),
        manualExecutionUnderstood: z.literal(true),
        noGuarantees: z.literal(true),
        noAutoApproval: z.literal(true),
      })
      .strict(),
  })
  .strict()

const PostSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(120),
    submission: SubmissionSchema,
  })
  .strict()

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params

    await checkRateLimit({
      action: "ad_request_submit",
      identifier: user.id,
      limit: 10,
      windowMs: 60 * 60 * 1000,
    })

    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    const parsed = PostSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail("VALIDATION", "Check the request — a required field is missing or out of bounds.", 422)
    }

    const request = await createAdRequest({
      userId: user.id,
      projectId: id,
      idempotencyKey: parsed.data.idempotencyKey,
      submission: parsed.data.submission,
    })
    void notifyAdRequestSubmitted({
      request,
      founderEmail: user.email,
      founderName: user.name,
    })
    return ok({ request: { id: request.id, status: request.status, submittedAt: request.submittedAt } })
  } catch (e) {
    return handleRouteError("api.projects.ads.requests.post", e)
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    const requests = await listAdRequests(id)
    return ok({
      requests: requests.map((request) => ({
        id: request.id,
        status: request.status,
        businessName: request.business.name,
        submittedAt: request.submittedAt,
        updatedAt: request.updatedAt,
      })),
    })
  } catch (e) {
    return handleRouteError("api.projects.ads.requests.get", e)
  }
}
