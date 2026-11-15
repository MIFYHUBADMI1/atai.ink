"use client"

/**
 * Per-browser privacy preferences for the Atai Feedback Hub.
 *
 * Stored in localStorage because they describe THIS device's consent choices
 * (like theme). They gate what the diagnostics collector gathers client-side;
 * the server still requires userId/reportId for ownership and auditing — those
 * are structural, never optional.
 */

export interface FeedbackPrivacyPrefs {
  /** Show the floating launcher at all. */
  launcherEnabled: boolean
  /** Collect page context (URL, route, title, project id). */
  collectPage: boolean
  /** Collect device/browser/screen info. */
  collectDevice: boolean
  /** Collect recent client-side errors. */
  collectErrors: boolean
  /** Attach an automatic screenshot of the current page to reports. */
  autoScreenshot: boolean
}

const KEY = "atai:feedback-privacy"

export const DEFAULT_PRIVACY_PREFS: FeedbackPrivacyPrefs = {
  launcherEnabled: true,
  collectPage: true,
  collectDevice: true,
  collectErrors: true,
  autoScreenshot: false,
}

export function loadPrivacyPrefs(): FeedbackPrivacyPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_PRIVACY_PREFS }
    return { ...DEFAULT_PRIVACY_PREFS, ...(JSON.parse(raw) as Partial<FeedbackPrivacyPrefs>) }
  } catch {
    return { ...DEFAULT_PRIVACY_PREFS }
  }
}

export function savePrivacyPrefs(prefs: FeedbackPrivacyPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* quota */ }
  window.dispatchEvent(new Event("atai:feedback-privacy-changed"))
}

/** True when the launcher should render for this browser. */
export function launcherAllowed(): boolean {
  return loadPrivacyPrefs().launcherEnabled
}

/**
 * Best-effort automatic screenshot of the current page via SVG foreignObject
 * serialization. Works for simple same-origin pages; returns null on any
 * failure (cross-origin assets, canvas taint, unsupported browser) so the
 * report can still be submitted without it.
 */
export async function capturePageSnapshot(maxWidth = 1280): Promise<Blob | null> {
  try {
    const w = Math.min(document.documentElement.scrollWidth, maxWidth)
    const h = Math.min(document.documentElement.scrollHeight, 4000)
    const clone = document.documentElement.cloneNode(true) as HTMLElement
    clone.querySelectorAll("script,style,link[rel='stylesheet'],noscript").forEach((n) => n.remove())
    const xml = new XMLSerializer().serializeToString(clone)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error("snapshot failed"))
      img.src = url
    })
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.85))
    return blob && blob.size > 0 && blob.size < 8 * 1024 * 1024 ? blob : null
  } catch {
    return null
  }
}
