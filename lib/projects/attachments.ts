import "server-only"
import { ObjectId } from "mongodb"
import { projectAttachmentsCol } from "@/lib/db/collections"
import { cryptoId } from "@/lib/store/store"
import type { ProjectAttachmentDoc } from "@/lib/types/db"

export const MAX_PROJECT_ATTACHMENTS = 6
export const MAX_ATTACHMENT_BYTES = 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_BYTES = 2.5 * 1024 * 1024
const MAX_ATTACHMENT_NAME_CHARS = 180

export type IncomingAttachment = { name: string; content: string; size?: number }

const DATA_URI_PATTERN = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/

function decodedLength(dataUri: string): number {
  const base64 = dataUri.slice(dataUri.indexOf(";base64,") + ";base64,".length)
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

/**
 * Validates and stages composer attachments for the project's first build.
 * Returns only the accepted files; rejects silently-invalid entries so one
 * malformed attachment can't block the whole project creation.
 */
export async function saveProjectAttachments(
  projectId: string,
  userId: string,
  files: IncomingAttachment[] | undefined,
): Promise<ProjectAttachmentDoc[]> {
  if (!files?.length) return []
  const collection = await projectAttachmentsCol()
  const accepted: ProjectAttachmentDoc[] = []
  let totalBytes = 0

  for (const raw of files) {
    if (accepted.length >= MAX_PROJECT_ATTACHMENTS) break
    if (!raw || typeof raw.name !== "string" || typeof raw.content !== "string") continue
    const name = raw.name.replace(/[/\\]/g, "_").trim().slice(0, MAX_ATTACHMENT_NAME_CHARS)
    if (!name) continue
    const match = DATA_URI_PATTERN.exec(raw.content)
    if (!match) continue
    const size = decodedLength(raw.content)
    if (size === 0 || size > MAX_ATTACHMENT_BYTES) continue
    if (totalBytes + size > MAX_TOTAL_ATTACHMENT_BYTES) break
    totalBytes += size
    const doc: ProjectAttachmentDoc = {
      _id: new ObjectId(),
      id: cryptoId(),
      projectId,
      userId,
      name,
      size,
      contentType: match[1],
      content: raw.content,
      createdAt: Date.now(),
    }
    accepted.push(doc)
  }

  if (accepted.length) await collection.insertMany(accepted)
  return accepted
}

export async function getProjectAttachments(projectId: string): Promise<ProjectAttachmentDoc[]> {
  const collection = await projectAttachmentsCol()
  return collection.find({ projectId }).sort({ createdAt: 1, _id: 1 }).toArray()
}

export async function clearProjectAttachments(projectId: string): Promise<number> {
  const collection = await projectAttachmentsCol()
  const result = await collection.deleteMany({ projectId })
  return result.deletedCount
}
