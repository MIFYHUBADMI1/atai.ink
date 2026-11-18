import { z } from "zod"
import { requireUser } from "@/lib/auth/session"
import { usersCol } from "@/lib/db/collections"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { getTour } from "@/lib/tour/registry"
import { tourContextForUser, tourProgressForUser } from "@/lib/tour/server"
import type { TourProgressRecord } from "@/lib/types/db"

/**
 * GET  /api/settings/tours — the founder's stored tour progress plus the
 *        server-resolved context (feature switches, business count) that
 *        decides which tours and steps are honest to offer.
 * POST /api/settings/tours — record progress for ONE tour.
 *
 * Ownership: every read and write is keyed on the authenticated user's own id.
 * Tour ids are validated against the registry before they are ever used as an
 * object key, so no caller can write arbitrary fields into their user document.
 */

const PostSchema = z
  .object({
    tourId: z.string().min(1).max(64),
    step: z.number().int().min(0).max(200),
    status: z.enum(["in-progress", "completed", "dismissed"]),
    paused: z.boolean().optional(),
    skipped: z.array(z.string().min(1).max(64)).max(200).optional(),
  })
  .strict()

async function readProgress(userId: string): Promise<Record<string, TourProgressRecord>> {
  return tourProgressForUser(userId)
}

export async function GET() {
  try {
    const user = await requireUser()
    const [progress, context] = await Promise.all([readProgress(user.id), tourContextForUser(user.id)])
    return ok({ progress, context })
  } catch (e) {
    return handleRouteError("api.settings.tours.get", e)
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser()
    const parsed = PostSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return fail("VALIDATION", "Send a known tour id, its step number and its status.", 422)
    }
    const tour = getTour(parsed.data.tourId)
    if (!tour) return fail("VALIDATION", "That tour is not available.", 422)

    // A completed tour cannot claim a step beyond its own list.
    const step = Math.min(parsed.data.step, Math.max(0, tour.steps.length - 1))
    const entry: TourProgressRecord = {
      step,
      status: parsed.data.status,
      updatedAt: Date.now(),
      ...(parsed.data.paused ? { paused: true } : {}),
      ...(parsed.data.skipped?.length ? { skipped: parsed.data.skipped } : {}),
    }

    const col = await usersCol()
    // Read-modify-write instead of a dotted $set path: the key never reaches
    // the query language, so a crafted tour id cannot address another field.
    const progress = await readProgress(user.id)
    const next = { ...progress, [tour.id]: entry }
    await col.updateOne({ id: user.id }, { $set: { tourProgress: next, updatedAt: Date.now() } })

    const context = await tourContextForUser(user.id)
    return ok({ progress: next, context })
  } catch (e) {
    return handleRouteError("api.settings.tours.post", e)
  }
}
