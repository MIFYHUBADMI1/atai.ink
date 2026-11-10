import { requireUser } from "@/lib/auth/session"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { fail, failInsufficientCredits, handleRouteError, ok } from "@/lib/api/respond"
import { checkProjectOwnership } from "@/lib/runtime/ownership"
import { isLessonsEnabledForUser, isPersonalLessonsEnabledForUser } from "@/lib/marketing/feature-flags"
import { isFirecrawlConfigured } from "@/lib/integrations/firecrawl/client"
import {
  getLessonsPackAffordability,
  chargeLessonsPackCredits,
  refundLessonsPackCredits,
} from "@/lib/lessons/credits"
import { scopedIntentKey } from "@/lib/billing/operation-identity"
import { lessonContextFingerprint } from "@/lib/lessons/context"
import {
  listActiveGeneratedLessons,
  countArchivedGeneratedLessons,
} from "@/lib/lessons/generated-store"
import { generateLessonPack } from "@/lib/lessons/generate"
import type { GeneratedLessonDoc } from "@/lib/lessons/types"
import { store } from "@/lib/store/store"
import { logger } from "@/lib/logging/logger"
import { z } from "zod"

/**
 * Business lessons endpoint (per project).
 *
 * GET — the founder's active pack plus staleness against the CURRENT project
 * state, and the cost of a new pack. Free, read-only.
 *
 * POST — generate a fresh personal pack (three lessons: live web research +
 * synthesis each). Session-authenticated, ownership-gated (uniform 404),
 * rate-limited, charged only when a real run starts, refunded on failure.
 * Lessons are written only on success: a failed run leaves the previous pack
 * active and untouched.
 */

const BodySchema = z
  .object({
    requestId: z.string().max(128).optional(),
  })
  .strip()

function viewOfLesson(doc: GeneratedLessonDoc) {
  return {
    id: doc.id,
    title: doc.title,
    stage: doc.stage,
    bodyMarkdown: doc.bodyMarkdown,
    sources: doc.sources,
    videos: doc.videos,
    grounded: doc.grounded,
    createdAt: doc.createdAt,
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    if (!isLessonsEnabledForUser(user.id, user.featurePreferences)) {
      return ok({ enabled: false, lessons: [] })
    }

    const project = await store.getProject(id)
    if (!project) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    const currentFingerprint = lessonContextFingerprint(project)
    const lessons = await listActiveGeneratedLessons(id)
    const archivedCount = await countArchivedGeneratedLessons(id)
    const { cost, available } = await getLessonsPackAffordability(user.id)

    const pack = lessons[0]
      ? {
          packId: lessons[0].packId,
          version: lessons[0].version,
          generatedAt: lessons[0].createdAt,
          contextSnapshot: lessons[0].contextSnapshot,
          stale: lessons[0].contextFingerprint !== currentFingerprint,
        }
      : null

    return ok({
      enabled: true,
      personal: isPersonalLessonsEnabledForUser(user.id, user.featurePreferences),
      lessons: lessons.map(viewOfLesson),
      pack,
      archivedCount,
      cost,
      available,
    })
  } catch (e) {
    return handleRouteError("api.projects.lessons.get", e)
  }
}

import { withAiProtection } from "@/lib/api/ai-protection"

export const POST = withAiProtection("resources", post)

async function post(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let charged = false
  let chargedAmount = 0
  let intentKey: string | undefined
  let userId = ""
  let projectId = ""
  try {
    const user = await requireUser()
    userId = user.id
    const { id } = await params
    projectId = id

    await checkRateLimit({ action: "lessons_pack_run", identifier: user.id, limit: 6, windowMs: 60 * 60 * 1000 })

    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    if (!isPersonalLessonsEnabledForUser(user.id, user.featurePreferences)) {
      return fail(
        "FEATURE_DISABLED",
        "Personal AI lessons are switched off right now. The free lesson library is still available.",
        403,
      )
    }
    if (!isFirecrawlConfigured()) {
      return fail("RESEARCH_UNAVAILABLE", "The research connection isn't available right now, so lesson packs can't be written.", 503)
    }

    const project = await store.getProject(id)
    if (!project) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)
    if (!project.idea && !project.specification) {
      return fail("VALIDATION", "Add the business idea first — lessons need something to be about.", 409)
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail("VALIDATION", "Invalid request.", 422)

    intentKey = scopedIntentKey(parsed.data.requestId, { userId: user.id, operation: "lessons_pack", projectId: id })

    const { cost, available, affordable } = await getLessonsPackAffordability(user.id)
    if (!affordable)
      return failInsufficientCredits({
        required: cost,
        available,
        message: `A lesson pack costs ${cost} credits and you have ${available}.`,
      })

    charged = await chargeLessonsPackCredits(user.id, id, intentKey)
    if (!charged)
      return failInsufficientCredits({
        required: cost,
        available,
        message: "You don't have enough credits for a lesson pack.",
      })
    chargedAmount = cost

    const outcome = await generateLessonPack({ project, onboarding: user.onboarding ?? null })

    return ok({
      lessons: outcome.lessons.map(viewOfLesson),
      pack: {
        packId: outcome.lessons[0]?.packId ?? null,
        version: outcome.lessons[0]?.version ?? null,
        generatedAt: outcome.lessons[0]?.createdAt ?? Date.now(),
        contextSnapshot: {
          state: outcome.context.state,
          stage: outcome.context.stage,
          planPercent: outcome.context.planPercent,
        },
        stale: false,
      },
      creditsCharged: chargedAmount,
    })
  } catch (e) {
    if (charged && userId && projectId) {
      const refundStatus = await refundLessonsPackCredits(userId, projectId, chargedAmount, intentKey)
      logger.warn("api.projects.lessons.post", "pack failed — refund recorded", { projectId, refundStatus })
    }
    return handleRouteError("api.projects.lessons.post", e)
  }
}
