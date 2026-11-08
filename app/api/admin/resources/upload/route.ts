import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import {
  isTextUpload,
  MAX_TEXT_RESOURCE_BYTES,
  readResourceUpload,
  uploadResourceFile,
} from "@/lib/imagekit/resource-upload"

export const runtime = "nodejs"
export const maxDuration = 60

const EXTENSION_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

function inferredMime(name: string, declared: string) {
  if (declared) return declared.toLowerCase()
  const match = /\.[a-z0-9]+$/i.exec(name)
  return match ? EXTENSION_MIME[match[0].toLowerCase()] ?? "" : ""
}

/** POST /api/admin/resources/upload — one file per request.
 * Text files come back as text (stored in the resource document); images and
 * PDF/Office documents are uploaded to ImageKit and come back as URLs. */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const file = await readResourceUpload(req)
    const mimeType = inferredMime(file.name, file.type)
    if (!mimeType) throw new AppError("VALIDATION", "That file type is not supported.", 415)
    const buffer = Buffer.from(await file.arrayBuffer())

    if (isTextUpload(file.name, mimeType)) {
      if (buffer.length > MAX_TEXT_RESOURCE_BYTES) {
        throw new AppError("VALIDATION", "Text uploads must be 1MB or smaller. Paste longer content instead.", 413)
      }
      const text = buffer.toString("utf8")
      return ok({
        kind: "text",
        name: file.name,
        mimeType,
        size: buffer.length,
        text,
      })
    }

    const kind = mimeType.startsWith("image/") ? "image" : "document"
    const uploaded = await uploadResourceFile({
      file: buffer,
      fileName: file.name,
      mimeType,
      kind,
    })
    return ok({
      kind,
      name: file.name,
      mimeType: uploaded.mimeType,
      size: buffer.length,
      url: uploaded.url,
      provider: "imagekit",
    })
  } catch (error) {
    if (error instanceof AppError) return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.resources.upload", error)
  }
}
