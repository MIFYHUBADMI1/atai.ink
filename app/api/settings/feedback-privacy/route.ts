import { requireUser } from "@/lib/auth/session"
import { usersCol } from "@/lib/db/collections"
import { ok, fail, handleRouteError } from "@/lib/api/respond"

const KEYS = ["launcherEnabled", "collectPage", "collectDevice", "collectErrors", "autoScreenshot"] as const
type Key = (typeof KEYS)[number]

function cleanPrefs(input: unknown): Partial<Record<Key, boolean>> | null {
  if (!input || typeof input !== "object") return null
  const out: Partial<Record<Key, boolean>> = {}
  for (const key of KEYS) {
    const value = (input as Record<string, unknown>)[key]
    if (value === undefined) continue
    if (typeof value !== "boolean") return null
    out[key] = value
  }
  return out
}

export async function GET() {
  try {
    const user = await requireUser()
    const col = await usersCol()
    const doc = await col.findOne({ id: user.id }, { projection: { feedbackPrivacy: 1 } })
    return ok({ prefs: doc?.feedbackPrivacy ?? null })
  } catch (e) {
    return handleRouteError("api.settings.feedback-privacy.get", e)
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser()
    const body = await req.json().catch(() => null)
    const prefs = cleanPrefs(body?.prefs ?? body)
    if (!prefs || Object.keys(prefs).length === 0) {
      return fail("VALIDATION", "Provide at least one boolean feedback privacy preference.", 422)
    }

    const col = await usersCol()
    const current = await col.findOne({ id: user.id }, { projection: { feedbackPrivacy: 1 } })
    const next = { ...(current?.feedbackPrivacy ?? {}), ...prefs }
    await col.updateOne({ id: user.id }, { $set: { feedbackPrivacy: next, updatedAt: Date.now() } })
    return ok({ prefs: next })
  } catch (e) {
    return handleRouteError("api.settings.feedback-privacy.patch", e)
  }
}
