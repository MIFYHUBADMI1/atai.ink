import { NextRequest } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/auth/session"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { readJsonBody } from "@/lib/api/request-body"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import {
  LESSON_ACTIVITY_ACTIONS,
  isLessonActivityAction,
  isLibraryLessonRef,
} from "@/lib/lessons/activity"
import { applyLessonActivity, loadLessonActivity } from "@/lib/lessons/activity-store"
import { isPublishedLessonRef } from "@/lib/lessons/store"

const BodySchema = z.object({
  lessonRef: z.string().trim().max(120),
  action: z.enum(LESSON_ACTIVITY_ACTIONS),
})

/**
 * Current saved/completed state for one lesson. The resource reader is a
 * static page, so its activity controls hydrate from here instead of turning
 * the whole article into a per-user render.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    const lessonRef = (req.nextUrl.searchParams.get("lessonRef") ?? "").trim()
    if (!isLibraryLessonRef(lessonRef)) {
      return fail("VALIDATION", "Invalid lesson reference.", 422)
    }
    if (!(await isPublishedLessonRef(lessonRef))) {
      return fail("NOT_FOUND", "That lesson is not available.", 404)
    }
    const activity = await loadLessonActivity(user.id, [lessonRef])
    return ok({ lessonRef, state: activity[lessonRef] ?? null })
  } catch (error) {
    return handleRouteError("api.lessons.activity", error)
  }
}

/**
 * Save / unsave / mark complete / mark opened for a library lesson. The lesson
 * ref is re-validated against the published library, so a caller cannot write
 * progress rows for arbitrary IDs. Activity is scoped to the signed-in user.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    await checkRateLimit({
      action: "lesson_activity",
      identifier: user.id,
      limit: 240,
      windowMs: 60 * 60 * 1000,
    })

    const parsed = BodySchema.safeParse(await readJsonBody(req, 2048))
    if (!parsed.success) return fail("VALIDATION", "Invalid lesson activity update.", 422)

    const { lessonRef, action } = parsed.data
    if (!isLessonActivityAction(action) || !isLibraryLessonRef(lessonRef)) {
      return fail("VALIDATION", "Invalid lesson activity update.", 422)
    }
    if (!(await isPublishedLessonRef(lessonRef))) {
      return fail("NOT_FOUND", "That lesson is not available.", 404)
    }

    const state = await applyLessonActivity(user.id, lessonRef, action)
    return ok({ lessonRef, state })
  } catch (error) {
    return handleRouteError("api.lessons.activity", error)
  }
}
