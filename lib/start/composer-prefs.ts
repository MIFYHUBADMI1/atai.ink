import type { StartMode } from "@/lib/start/detect-input"

export const COMPOSER_PREFS_KEY = "atai:landing-composer"
/** Attachment contents live under their own key: the prefs save runs on every
 * keystroke and must never re-serialize megabytes of base64. */
export const COMPOSER_FILE_CONTENTS_KEY = "atai:landing-composer-file-contents"

export const MAX_ATTACHMENTS = 6
/** Per-file raw size cap (base64 inflates ~33% on the way to the builder). */
export const MAX_ATTACHMENT_BYTES = 1024 * 1024
/** Combined raw size cap — keeps the sessionStorage draft inside quota. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 2.5 * 1024 * 1024

export type ComposerAttachment = {
  id: string
  name: string
  size: number
  /** data: URI of the file content; persisted under COMPOSER_FILE_CONTENTS_KEY. */
  content?: string
}

export type ComposerPrefs = {
  prompt: string
  /** User-confirmed project name; required before the request can be sent. */
  title: string
  mode: StartMode
  agents: string[]
  tool: string | null
  auto: string
  files: ComposerAttachment[]
}

export const DEFAULT_COMPOSER_PREFS: ComposerPrefs = {
  prompt: "",
  title: "",
  mode: "idea",
  agents: ["atai"],
  tool: null,
  auto: "auto",
  files: [],
}

function readJson<T>(key: string): Partial<T> | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Partial<T>) : null
  } catch {
    return null
  }
}

export function loadComposerPrefs(): ComposerPrefs {
  if (typeof window === "undefined") return DEFAULT_COMPOSER_PREFS
  const parsed = readJson<ComposerPrefs>(COMPOSER_PREFS_KEY) ?? {}
  const contents = readJson<Record<string, string>>(COMPOSER_FILE_CONTENTS_KEY) ?? {}
  const files = (Array.isArray(parsed.files) ? parsed.files : []).map((file) => ({
    ...file,
    ...(typeof contents[file.id] === "string" ? { content: contents[file.id] } : {}),
  }))
  return {
    ...DEFAULT_COMPOSER_PREFS,
    ...parsed,
    prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
    title: typeof parsed.title === "string" ? parsed.title : "",
    agents: Array.isArray(parsed.agents) && parsed.agents.length > 0 ? parsed.agents : ["atai"],
    files,
  }
}

export function saveComposerPrefs(prefs: ComposerPrefs) {
  if (typeof window === "undefined") return
  // Strip content — the per-keystroke save carries metadata only.
  const files = prefs.files.map(({ content: _content, ...file }) => file)
  sessionStorage.setItem(COMPOSER_PREFS_KEY, JSON.stringify({ ...prefs, files }))
}

/** Persist attachment contents (data URIs) under their own key. */
export function saveComposerFileContents(files: ComposerAttachment[]) {
  if (typeof window === "undefined") return
  try {
    const contents: Record<string, string> = {}
    for (const file of files) {
      if (file.content) contents[file.id] = file.content
    }
    sessionStorage.setItem(COMPOSER_FILE_CONTENTS_KEY, JSON.stringify(contents))
  } catch {
    // Quota exceeded — metadata chips survive; submit-time caps keep the
    // pending-start copy small.
  }
}

export function clearComposerFileContents() {
  if (typeof window === "undefined") return
  sessionStorage.removeItem(COMPOSER_FILE_CONTENTS_KEY)
}
