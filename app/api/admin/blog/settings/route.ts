import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { blogSettingsInputSchema } from "@/lib/blog/admin-schema"
import { getBlogSettings, publicArticles, updateBlogSettings } from "@/lib/blog/store"
import { indexNowConfigured, submitToIndexNow } from "@/lib/blog/indexnow"
import { searchConsoleConfigured } from "@/lib/blog/search-console"

export const dynamic = "force-dynamic"

/** Reads the request body when one was sent. The submission endpoint is
 * callable with no body, which is the common case. */
async function optionalJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return await readJsonBody(req, 10_000)
  } catch {
    return {}
  }
}

export async function GET() {
  try {
    await requireAdmin()
    const settings = await getBlogSettings()
    return ok({
      settings,
      // Honest integration state: configured ≠ connected ≠ indexed.
      integrations: {
        indexNow: {
          keyConfigured: indexNowConfigured(),
          enabled: settings.indexNowEnabled,
          lastStatus: settings.lastIndexedStatus ?? "not-configured",
          lastError: settings.lastIndexedError,
          lastAt: settings.lastIndexedAt,
        },
        searchConsole: {
          connected: searchConsoleConfigured(),
          verification: settings.gscVerification ? "set" : "missing",
        },
        bingWebmaster: { connected: Boolean(settings.bingVerification), verification: settings.bingVerification ? "set" : "missing" },
      },
    })
  } catch (error) {
    return handleRouteError("api.admin.blog.settings.get", error)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await readJsonBody(req, 50_000)
    const parsed = blogSettingsInputSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the settings.", 422)
    }
    const updated = await updateBlogSettings(parsed.data)
    return ok({ settings: updated })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.blog.settings.update", error)
  }
}

/**
 * Send an IndexNow submission ping for the published article URLs.
 *
 * A submission is not proof of indexing, so the reply reports exactly what
 * happened: "submitted" (the endpoint accepted the ping), "failed" (it did
 * not) or "not-configured" (the key or the toggle is missing).
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await optionalJsonBody(req)
    const requested = Array.isArray(body.paths)
      ? body.paths.filter((value): value is string => typeof value === "string").slice(0, 500)
      : []
    const paths = requested.length
      ? requested
      : (await publicArticles()).map((article) => `/blog/${article.slug}`)
    const result = await submitToIndexNow(paths)
    return ok({
      status: result.status,
      urls: result.urls,
      error: result.error,
      keyConfigured: result.keyConfigured,
      enabled: result.enabled,
      submittedCount: result.status === "submitted" ? result.urls.length : 0,
    })
  } catch (error) {
    return handleRouteError("api.admin.blog.settings.indexnow", error)
  }
}
