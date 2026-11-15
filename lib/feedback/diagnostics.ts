/**
 * Client-side diagnostic capture for the Atai Feedback Hub.
 *
 * Runs entirely in the browser and produces a BOUNDED, SANITISED snapshot:
 * - No cookies, tokens, auth headers, request bodies, or storage values.
 * - Query strings are stripped from URLs (they routinely carry tokens).
 * - Error entries come from a small ring buffer of window errors, promise
 *   rejections, and failed same-origin API calls — never the full console.
 * - Everything is capped so a report can never smuggle an unbounded payload.
 *
 * This module is imported by client components only; it must stay free of
 * server-only imports so it can be unit-tested under vitest/node.
 */
import type {
  FeedbackDeviceInfo,
  FeedbackDiagnostics,
  FeedbackErrorEntry,
  FeedbackPageContext,
} from "./types"
import { fingerprintText } from "./config"
import { loadPrivacyPrefs } from "./privacy"

export const DIAGNOSTICS_COLLECTOR_VERSION = 1
const MAX_ERRORS = 12
const MAX_MESSAGE = 500
const MAX_STACK_LINES = 6

// ─── Sanitisation ────────────────────────────────────────────────────────────

const SECRET_PATTERNS: RegExp[] = [
  /bearer\s+[a-z0-9._~+/=-]+/gi,
  /(?:api[_-]?key|token|secret|password|passwd|authorization|session|jwt|signature|sig|key)=([^&\s"']+)/gi,
  /sk-[a-z0-9_-]{8,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]

/** Redact anything that looks like a credential from arbitrary text. */
export function sanitizeText(input: string, maxLen = MAX_MESSAGE): string {
  let out = input
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (m) => {
      // Keep the key name for context but blank the value.
      const eq = m.indexOf("=")
      return eq > 0 ? `${m.slice(0, eq + 1)}[redacted]` : "[redacted]"
    })
  }
  // Emails in error text are user data, not secrets, but reports shouldn't
  // need them — mask them anyway for privacy.
  out = out.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]")
  out = out.replace(/\s+/g, " ").trim()
  return out.length > maxLen ? `${out.slice(0, maxLen)}…` : out
}

/** Strip query string + hash from a URL — query params routinely carry tokens. */
export function sanitizeUrl(raw: string): string {
  // Non-URL strings (already-sanitised paths, labels) just lose query/hash.
  if (!/^(https?:)?\/\//.test(raw) && !raw.startsWith("/")) {
    return raw.split(/[?#]/)[0]?.trim() ?? ""
  }
  try {
    const u = new URL(raw, "https://placeholder.local")
    return `${u.origin === "https://placeholder.local" ? "" : u.origin}${u.pathname}` || "/"
  } catch {
    return raw.split(/[?#]/)[0] ?? "/"
  }
}

// ─── Error ring buffer ───────────────────────────────────────────────────────

const errorBuffer: FeedbackErrorEntry[] = []
let listenersInstalled = false

function pushError(entry: FeedbackErrorEntry) {
  errorBuffer.push(entry)
  if (errorBuffer.length > MAX_ERRORS) errorBuffer.splice(0, errorBuffer.length - MAX_ERRORS)
}

function fingerprintOf(entry: FeedbackErrorEntry): string {
  const basis = `${entry.kind}|${entry.name ?? ""}|${entry.message}|${entry.status ?? ""}`
  return fingerprintText(basis)
}

/**
 * Install window-level capture once. Idempotent — safe to call from the
 * launcher on every mount. Captures only bounded metadata, never payloads.
 */
export function installDiagnosticsCapture(): void {
  if (listenersInstalled || typeof window === "undefined") return
  listenersInstalled = true

  window.addEventListener("error", (event) => {
    const target = event.target as { tagName?: string; src?: string } | null
    if (target && target !== window && (target.tagName === "IMG" || target.tagName === "SCRIPT" || target.tagName === "LINK")) {
      pushError({
        kind: "resource_failure",
        message: `Failed to load ${target.tagName.toLowerCase()}`,
        url: target.src ? sanitizeUrl(target.src) : undefined,
        at: Date.now(),
      })
      return
    }
    const err = event.error as Error | undefined
    const entry: FeedbackErrorEntry = {
      kind: "exception",
      name: err?.name ?? (event.message ? "Error" : undefined),
      message: sanitizeText(err?.message ?? event.message ?? "Unknown error"),
      at: Date.now(),
    }
    entry.fingerprint = fingerprintOf(entry)
    pushError(entry)
  }, true)

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { name?: string; message?: string; status?: number } | undefined
    const entry: FeedbackErrorEntry = {
      kind: "rejection",
      name: reason?.name,
      message: sanitizeText(reason?.message ?? String(reason ?? "Unhandled rejection")),
      status: typeof reason?.status === "number" ? reason.status : undefined,
      at: Date.now(),
    }
    entry.fingerprint = fingerprintOf(entry)
    pushError(entry)
  })

  // Same-origin failed API calls — status + path only, never bodies/headers.
  const originalFetch = window.fetch
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    try {
      const res = await originalFetch(input, init)
      if (!res.ok && url.startsWith("/api/")) {
        const entry: FeedbackErrorEntry = {
          kind: "api_failure",
          message: sanitizeText(`${res.status} ${res.statusText || "request failed"}`),
          status: res.status,
          url: sanitizeUrl(url),
          at: Date.now(),
        }
        entry.fingerprint = fingerprintOf(entry)
        pushError(entry)
      }
      return res
    } catch (err) {
      if (url.startsWith("/api/")) {
        const entry: FeedbackErrorEntry = {
          kind: "api_failure",
          message: sanitizeText(err instanceof Error ? err.message : "Network request failed"),
          url: sanitizeUrl(url),
          at: Date.now(),
        }
        entry.fingerprint = fingerprintOf(entry)
        pushError(entry)
      }
      throw err
    }
  }
}

export function getCapturedErrors(): FeedbackErrorEntry[] {
  return errorBuffer.map((e) => ({ ...e }))
}

// ─── Snapshot collection ─────────────────────────────────────────────────────

function parseDeviceCategory(): FeedbackDeviceInfo["deviceCategory"] {
  const w = window.innerWidth
  if (w < 640) return "mobile"
  if (w < 1024) return "tablet"
  return "desktop"
}

function parseBrowser(ua: string): { browser?: string; browserVersion?: string; os?: string } {
  const out: { browser?: string; browserVersion?: string; os?: string } = {}
  let m = /Edg\/(\d+)/.exec(ua)
  if (m) { out.browser = "Edge"; out.browserVersion = m[1]; }
  else if ((m = /Chrome\/(\d+)/.exec(ua)) && !/Chromium/.test(ua)) { out.browser = "Chrome"; out.browserVersion = m[1]; }
  else if ((m = /Firefox\/(\d+)/.exec(ua))) { out.browser = "Firefox"; out.browserVersion = m[1]; }
  else if ((m = /Version\/(\d+)[^\d]+Safari/.exec(ua))) { out.browser = "Safari"; out.browserVersion = m[1]; }
  if (/Windows/.test(ua)) out.os = "Windows"
  else if (/Android/.test(ua)) out.os = "Android"
  else if (/iPhone|iPad|iPod/.test(ua)) out.os = "iOS"
  else if (/Mac OS X|Macintosh/.test(ua)) out.os = "macOS"
  else if (/Linux/.test(ua)) out.os = "Linux"
  return out
}

/** Extract business/project context from the current pathname. */
function projectIdFromPath(pathname: string): string | undefined {
  const m = /^\/project\/([^/?#]+)/.exec(pathname)
  return m?.[1]
}

export function collectPageContext(pathname: string): FeedbackPageContext {
  const projectId = projectIdFromPath(pathname)
  const section = projectId ? pathname.slice(`/project/${projectId}`.length).replace(/^\//, "") || "overview" : undefined
  return {
    url: sanitizeUrl(window.location.href),
    route: pathname,
    title: sanitizeText(document.title || "", 200),
    ...(section ? { section } : {}),
    ...(projectId ? { projectId } : {}),
    environment: process.env.NODE_ENV ?? "production",
    release: process.env.NEXT_PUBLIC_APP_VERSION || undefined,
  }
}

export function collectDeviceInfo(): FeedbackDeviceInfo {
  const ua = navigator.userAgent || ""
  const { browser, browserVersion, os } = parseBrowser(ua)
  return {
    ...(browser ? { browser } : {}),
    ...(browserVersion ? { browserVersion } : {}),
    ...(os ? { os } : {}),
    deviceCategory: parseDeviceCategory(),
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    language: navigator.language || "en",
    online: navigator.onLine,
    userAgent: sanitizeText(ua, 300),
  }
}

/**
 * Full bounded snapshot for report submission. Errors are a copy of the ring
 * buffer — callers may pass a narrower `since` timestamp to limit relevance.
 */
export function collectDiagnostics(opts?: { since?: number }): FeedbackDiagnostics {
  // Privacy prefs gate which sections are collected — the user controls this
  // from Settings → Feedback & privacy.
  const prefs = loadPrivacyPrefs()
  const errors = prefs.collectErrors !== false ? getCapturedErrors().filter((e) => !opts?.since || e.at >= opts.since) : []
  return {
    page: prefs.collectPage !== false ? collectPageContext(window.location.pathname) : { url: "/", route: window.location.pathname, title: "", environment: process.env.NODE_ENV ?? "production" },
    device: prefs.collectDevice !== false ? collectDeviceInfo() : {
      deviceCategory: "desktop", screenWidth: 0, screenHeight: 0,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      language: navigator.language || "en", online: navigator.onLine, userAgent: "",
    },
    errors,
    collectedAt: Date.now(),
    collectorVersion: DIAGNOSTICS_COLLECTOR_VERSION,
  }
}

/** Primary fingerprint: the most recent error, else the route+category basis. */
export function primaryFingerprint(diagnostics: FeedbackDiagnostics, category: string): string | undefined {
  const latest = [...diagnostics.errors].sort((a, b) => b.at - a.at)[0]
  if (latest?.fingerprint) return latest.fingerprint
  if (diagnostics.errors.length === 0) {
    return fingerprintText(`${category}|${diagnostics.page.route}`)
  }
  return undefined
}
