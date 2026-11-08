import "server-only"

import { AppError } from "@/lib/errors"
import { getImageKitConfig } from "@/lib/env"
import { logger } from "@/lib/logging/logger"
import { validateImage } from "@/lib/imagekit/validate-image"

export const MAX_RESOURCE_BYTES = 25 * 1024 * 1024
export const MAX_TEXT_RESOURCE_BYTES = 1024 * 1024

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv"]
const TEXT_MIME = new Set(["text/plain", "text/markdown", "text/csv", "text/x-markdown"])

type DocumentKind = {
  kind: "document"
  mimeType: string
  extension: string
}

const DOCUMENT_TYPES: Record<string, { extensions: string[]; magic?: "pdf" | "zip" }> = {
  "application/pdf": { extensions: [".pdf"], magic: "pdf" },
  "application/msword": { extensions: [".doc"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { extensions: [".docx"], magic: "zip" },
  "application/vnd.ms-powerpoint": { extensions: [".ppt"] },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { extensions: [".pptx"], magic: "zip" },
  "application/vnd.ms-excel": { extensions: [".xls"] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { extensions: [".xlsx"], magic: "zip" },
}

function extensionOf(name: string) {
  const match = /\.[a-z0-9]+$/i.exec(name)
  return match ? match[0].toLowerCase() : ""
}

function startsWith(buffer: Buffer, bytes: number[]) {
  return bytes.every((byte, index) => buffer[index] === byte)
}

export function validateDocument(file: Buffer, declaredMime: string, name: string): DocumentKind {
  if (!file.length || file.length > MAX_RESOURCE_BYTES) {
    throw new AppError("VALIDATION", "Choose a non-empty file no larger than 25MB.", 422)
  }
  const extension = extensionOf(name)
  const rule = DOCUMENT_TYPES[declaredMime]
  if (!rule || !rule.extensions.includes(extension)) {
    throw new AppError("VALIDATION", "Upload a PDF, Word, PowerPoint, or Excel document.", 415)
  }
  if (rule.magic === "pdf" && !file.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new AppError("VALIDATION", "That file is not a valid PDF.", 422)
  }
  if (rule.magic === "zip" && !startsWith(file, [0x50, 0x4b, 0x03, 0x04])) {
    throw new AppError("VALIDATION", "That file is not a valid Office document.", 422)
  }
  return { kind: "document", mimeType: declaredMime, extension }
}

export function isTextUpload(name: string, mimeType: string) {
  return TEXT_MIME.has(mimeType) || TEXT_EXTENSIONS.includes(extensionOf(name))
}

async function uploadBinary(params: {
  file: Buffer
  fileName: string
  mimeType: string
  folder: string
}) {
  const config = getImageKitConfig()
  const stem = params.fileName.replace(/\.[^.]*$/, "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 150) || "resource"
  const extension = extensionOf(params.fileName)
  const fileName = `${stem}${extension}`
  const form = new FormData()
  form.append("file", new Blob([new Uint8Array(params.file)], { type: params.mimeType }), fileName)
  form.append("fileName", fileName)
  form.append("folder", params.folder)
  form.append("useUniqueFileName", "true")
  form.append("overwriteFile", "false")

  const auth = Buffer.from(`${config.privateKey}:`).toString("base64")
  let response: Response
  try {
    response = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    logger.error("imagekit.resource_upload_network", "Resource upload network error")
    throw new AppError("IMAGE_UPLOAD_FAILED", "The file could not be uploaded. Try again.", 503)
  }
  if (!response.ok) {
    logger.error("imagekit.resource_upload_failed", "ImageKit rejected resource upload", { status: response.status })
    throw new AppError("IMAGE_UPLOAD_FAILED", "The file could not be uploaded. Try again.", 503)
  }
  const data = (await response.json()) as { fileId?: string; url?: string; filePath?: string }
  try {
    const url = new URL(data.url ?? "")
    const endpoint = new URL(config.urlEndpoint)
    if (!data.fileId || typeof data.filePath !== "string" || !data.filePath.startsWith(`${params.folder}/`)) throw new Error()
    if (url.protocol !== "https:" || url.origin !== endpoint.origin || url.username || url.password) throw new Error()
    return { url: url.toString(), fileId: data.fileId }
  } catch {
    throw new AppError("IMAGE_UPLOAD_FAILED", "The upload response was not valid.", 502)
  }
}

export async function uploadResourceFile(params: {
  file: Buffer
  fileName: string
  mimeType: string
  kind: "image" | "document"
}) {
  if (params.kind === "image") {
    const image = await validateImage(params.file, params.mimeType)
    const uploaded = await uploadBinary({
      file: image.file,
      fileName: `${params.fileName.replace(/\.[^.]*$/, "")}.${image.extension}`,
      mimeType: image.mimeType,
      folder: "/Atai/resources",
    })
    return { ...uploaded, mimeType: image.mimeType }
  }
  const document = validateDocument(params.file, params.mimeType, params.fileName)
  const uploaded = await uploadBinary({
    file: params.file,
    fileName: params.fileName,
    mimeType: document.mimeType,
    folder: "/Atai/resources",
  })
  return { ...uploaded, mimeType: document.mimeType }
}

/** Read one admin upload from a multipart request, with the same hard size
 * limit the ImageKit helpers enforce. Images reuse the image-specific reader. */
export async function readResourceUpload(request: Request): Promise<File> {
  const limit = MAX_RESOURCE_BYTES + 64 * 1024
  const length = Number(request.headers.get("content-length"))
  if (length > limit || !request.body) {
    throw new AppError("VALIDATION", "Upload is too large or empty.", 413)
  }
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.includes("multipart/form-data")) {
    throw new AppError("VALIDATION", "Please submit one file.")
  }
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new AppError("VALIDATION", "Please submit one file.")
  }
  const values = [...form.values()]
  const file = values.find((value): value is File => value instanceof File)
  if (!file || values.filter((value) => value instanceof File).length !== 1 || file.name.length > 180) {
    throw new AppError("VALIDATION", "Please submit one file with a filename of at most 180 characters.")
  }
  if (!file.size || file.size > MAX_RESOURCE_BYTES) {
    throw new AppError("VALIDATION", "Choose a non-empty file no larger than 25MB.", 413)
  }
  return file
}
