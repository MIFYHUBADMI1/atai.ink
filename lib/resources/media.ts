import type { Resource, ResourceBlock, ResourceFormat } from "@/lib/resources/types"

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
])

export function isHttpsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password
  } catch {
    return false
  }
}

/** Strictly extract an 11-character YouTube video id from common URL shapes. */
export function youTubeVideoId(value: string | undefined | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null
    if (url.hostname.endsWith("youtu.be")) {
      const id = url.pathname.split("/").filter(Boolean)[0] ?? ""
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
    }
    const fromQuery = url.searchParams.get("v")
    if (fromQuery && /^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery
    const parts = url.pathname.split("/").filter(Boolean)
    const marker = parts.findIndex((part) => part === "embed" || part === "shorts" || part === "live")
    const candidate = marker >= 0 ? parts[marker + 1] : undefined
    return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null
  } catch {
    return null
  }
}

export function youTubeEmbedUrl(value: string | undefined | null): string | null {
  const id = youTubeVideoId(value)
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
}

export function youTubeThumbnailUrl(value: string | undefined | null): string | null {
  const id = youTubeVideoId(value)
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function slugifyResource(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

export function resourceFormat(resource: Pick<Resource, "format" | "youtubeUrl" | "file">): ResourceFormat {
  if (resource.format) return resource.format
  if (resource.youtubeUrl) return "video"
  if (resource.file) return "document"
  return "article"
}

/** Serializes editorial body blocks into Markdown so admin customization can
 * prefill the content editor — the catalog stores blocks, not Markdown. */
export function resourceBlocksToMarkdown(blocks: ResourceBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "p":
          return block.text
        case "h2":
          return `## ${block.text}`
        case "ul":
          return block.items.map((item) => `- ${item}`).join("\n")
        case "ol":
          return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n")
        case "callout":
          return `> **${block.title}:** ${block.text}`
        case "faq":
          return block.items.map((item) => `**Q: ${item.q}**\n\n${item.a}`).join("\n\n")
        default:
          return ""
      }
    })
    .filter(Boolean)
    .join("\n\n")
}

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
}

export function markdownHeadings(markdown: string | undefined): { id: string; text: string }[] {
  if (!markdown) return []
  const headings: { id: string; text: string }[] = []
  const seen = new Map<string, number>()
  let fenced = false
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) continue
    const text = match[1].replace(/[*_`~]/g, "").trim()
    if (!text) continue
    const base = headingId(text) || "section"
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    headings.push({ id: count === 0 ? base : `${base}-${count + 1}`, text })
  }
  return headings
}

/** Same ids as `markdownHeadings`, keyed by 1-based source line so the
 * renderer and the table of contents always point at the same anchor. */
export function markdownHeadingIdsByLine(markdown: string | undefined): Map<number, string> {
  const ids = new Map<number, string>()
  if (!markdown) return ids
  const seen = new Map<string, number>()
  let fenced = false
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return
    }
    if (fenced) return
    const match = /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) return
    const text = match[1].replace(/[*_`~]/g, "").trim()
    if (!text) return
    const base = headingId(text) || "section"
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    ids.set(index + 1, count === 0 ? base : `${base}-${count + 1}`)
  })
  return ids
}

export function plainTextFromMarkdown(markdown: string | undefined): string {
  if (!markdown) return ""
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>#|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
