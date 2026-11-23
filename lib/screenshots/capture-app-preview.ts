import "server-only"
import { ObjectId } from "mongodb"
import { scrapeUrl } from "@/lib/integrations/firecrawl/client"
import { uploadImageToImageKit } from "@/lib/imagekit/upload"
import { projectAssetsCol } from "@/lib/db/collections"
import { authorizeStorage, entitlementDenial } from "@/lib/billing/entitlements/require"
import { releaseProjectStorage, reserveProjectStorage } from "@/lib/infrastructure/storage-reservations"
import { store, cryptoId } from "@/lib/store/store"
import { logger } from "@/lib/logging/logger"

/** A hosted screenshot has no local byte count; reserve the upload ceiling. */
const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024

/**
 * Captures a screenshot of the built/deployed app URL and stores it as
 * the project's preview image (prepended to understanding.screenshots).
 *
 * Reuses the existing Firecrawl scrapeUrl client (v2) — same infrastructure
 * already used for source-URL screenshots. No new dependencies needed.
 *
 * Always called fire-and-forget. Never throws in a way that blocks callers.
 */
export async function captureAppPreview(projectId: string, appUrl: string): Promise<void> {
  let storageHoldId: string | undefined
  try {
    logger.info("capture-app-preview", "starting", { projectId, appUrl })

    if (!process.env.FIRECRAWL_API_KEY) {
      logger.warn("capture-app-preview", "FIRECRAWL_API_KEY not set — skipping", { projectId })
      return
    }

    const project = await store.getProject(projectId)
    if (!project) return

    const storageDenied = entitlementDenial(await authorizeStorage(project.userId))
    if (storageDenied) {
      logger.warn("capture-app-preview", "storage capability unavailable — skipping preview", {
        projectId,
        code: storageDenied.code,
      })
      return
    }

    // Use the existing Firecrawl v2 scrape client with screenshot=true
    // 45s timeout — the built app may be cold-starting
    const result = await scrapeUrl(appUrl, true, 45_000)
    const screenshot = result?.data?.screenshot as string | undefined

    if (!screenshot) {
      logger.warn("capture-app-preview", "no screenshot returned — app may not be publicly reachable yet", { projectId, appUrl })
      return
    }

    let imageUrl: string
    let storedBytes = SCREENSHOT_MAX_BYTES

    if (screenshot.startsWith("data:")) {
      // Base64 data URI — decode and upload to ImageKit
      const [meta, b64] = screenshot.split(",")
      const mimeMatch = meta?.match(/data:(image\/\w+);base64/)
      const mimeType = mimeMatch?.[1] ?? "image/png"
      const buffer = Buffer.from(b64 ?? "", "base64")
      storedBytes = buffer.byteLength

      const reservation = await reserveProjectStorage({
        userId: project.userId,
        projectId,
        bytes: storedBytes,
        operationId: `screenshot_${cryptoId()}`,
      })
      if (reservation.denial || reservation.busy) {
        logger.warn("capture-app-preview", "storage reservation refused — skipping preview", {
          projectId,
          code: reservation.denial?.code ?? reservation.busy?.code,
        })
        return
      }
      storageHoldId = reservation.holdId

      const uploaded = await uploadImageToImageKit({
        file: buffer,
        fileName: `app-preview-${Date.now()}.png`,
        mimeType,
        folder: `/Atai/projects/${projectId}/screenshots`,
      })
      imageUrl = uploaded.url
    } else {
      // Firecrawl returned a hosted URL — use directly, but reserve the
      // conservative ceiling because its byte length is not available here.
      const reservation = await reserveProjectStorage({
        userId: project.userId,
        projectId,
        bytes: storedBytes,
        operationId: `screenshot_${cryptoId()}`,
      })
      if (reservation.denial || reservation.busy) {
        logger.warn("capture-app-preview", "storage reservation refused — skipping preview", {
          projectId,
          code: reservation.denial?.code ?? reservation.busy?.code,
        })
        return
      }
      storageHoldId = reservation.holdId
      imageUrl = screenshot
    }

    logger.info("capture-app-preview", "screenshot captured", { projectId, imageUrl })

    const existing = project.understanding?.screenshots ?? []
    if (existing.includes(imageUrl)) return // already saved — idempotent

    await (await projectAssetsCol()).insertOne({
      _id: new ObjectId(),
      id: `screenshot_${cryptoId()}`,
      userId: project.userId,
      projectId,
      kind: "screenshot",
      fileId: `screenshot_${cryptoId()}`,
      filePath: imageUrl,
      fileName: `app-preview-${Date.now()}.png`,
      url: imageUrl,
      mimeType: "image/png",
      size: storedBytes,
      createdAt: Date.now(),
      metadata: { source: "capture-app-preview", sizeEstimated: !screenshot.startsWith("data:") },
    })

    // Prepend to understanding.screenshots so it becomes thumbnailUrl everywhere
    await store.updateProject(projectId, {
      understanding: {
        ...(project.understanding ?? {}),
        screenshots: [imageUrl, ...existing],
      } as typeof project.understanding,
    })

    logger.info("capture-app-preview", "screenshot saved as thumbnail", { projectId })
  } catch (err) {
    // Never block the caller
    logger.error("capture-app-preview", "failed (non-fatal)", {
      projectId,
      error: (err as Error).message,
    })
  } finally {
    await releaseProjectStorage(storageHoldId)
  }
}
