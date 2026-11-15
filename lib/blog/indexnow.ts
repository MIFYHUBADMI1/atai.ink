import "server-only"

import { logger } from "@/lib/logging/logger"
import { SITE_URL } from "@/lib/env"
import { getBlogSettings, updateBlogSettings } from "@/lib/blog/store"

/** IndexNow integration boundary. Submission only happens when the operator
 * has configured INDEXNOW_KEY and enabled the integration in the Content
 * Studio. A submission is NOT proof of indexing — statuses stay honest:
 * "submitted" means the ping was accepted, nothing more. */

export function indexNowConfigured(): boolean {
  return Boolean(process.env.INDEXNOW_KEY?.trim())
}

interface IndexNowResult {
  status: "submitted" | "failed" | "not-configured"
  urls: string[]
  error?: string
  /** True when INDEXNOW_KEY is present in the environment. */
  keyConfigured: boolean
  /** True when the operator switched the integration on in the Content Studio. */
  enabled: boolean
}

export async function submitToIndexNow(paths: string[]): Promise<IndexNowResult> {
  const key = process.env.INDEXNOW_KEY?.trim()
  const settings = await getBlogSettings()
  const urls = paths.map((path) => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`)
  if (!key || !settings.indexNowEnabled) {
    return {
      status: "not-configured",
      urls,
      keyConfigured: Boolean(key),
      enabled: settings.indexNowEnabled,
    }
  }
  try {
    const host = new URL(SITE_URL).host
    const response = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${SITE_URL}/indexnow/${key}.txt`,
        urlList: urls.slice(0, 10_000),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      const error = `IndexNow responded ${response.status}`
      await updateBlogSettings({
        lastIndexedAt: Date.now(),
        lastIndexedUrls: urls,
        lastIndexedStatus: "failed",
        lastIndexedError: error,
      })
      return { status: "failed", urls, error, keyConfigured: true, enabled: true }
    }
    await updateBlogSettings({
      lastIndexedAt: Date.now(),
      lastIndexedUrls: urls,
      lastIndexedStatus: "submitted",
      lastIndexedError: undefined,
    })
    return { status: "submitted", urls, keyConfigured: true, enabled: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn("blog.indexnow", "IndexNow submission failed", { message })
    await updateBlogSettings({
      lastIndexedAt: Date.now(),
      lastIndexedUrls: urls,
      lastIndexedStatus: "failed",
      lastIndexedError: message,
    }).catch(() => undefined)
    return { status: "failed", urls, error: message, keyConfigured: true, enabled: true }
  }
}