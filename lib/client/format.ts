/**
 * Shared relative-time formatting used across dashboard, projects, workspace,
 * and activity surfaces. One implementation — previously five per-component
 * copies drifted (some rounded, some floored, different thresholds).
 *
 * Intentionally NON-reactive: values are computed at render time and refresh
 * whenever the owning component re-renders (all call sites poll on intervals,
 * so timestamps stay fresh in practice).
 */
export function relativeTime(value: string | number | Date): string {
  const then = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (Number.isNaN(then)) return ""

  const min = Math.round((Date.now() - then) / 60_000)
  if (min < 1) return "Just now"
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** Compact variant for tight UI (notification lists, badges): "3m ago". */
export function relativeTimeShort(value: string | number | Date): string {
  const then = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (Number.isNaN(then)) return ""

  const min = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (min < 1) return "Just now"
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/**
 * Deterministic number formatting. `toLocaleString()` with no arguments reads
 * the runtime locale, so the server (often `en-US`) and a `de-DE` browser
 * disagree on separators and hydration fails. Every number on a server-rendered
 * surface goes through this.
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("en-US").format(value)
}

/**
 * Deterministic timestamp formatting, pinned to `en-US` + `UTC` so the server
 * HTML and the first client pass are byte-identical. A founder who wants local
 * time gets it from `<Timestamp>`/relative helpers after mount, not here.
 */
export function formatTimestamp(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  if (value === null || value === undefined) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(date)
}

/** How long until a deadline still in the future: "for 41 more hours".
 * Mirrors `relativeTime`'s thresholds so a card can say how long is left. */
export function relativeDeadline(value: string | number | Date): string {
  const then = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (Number.isNaN(then)) return ""

  const min = Math.round((then - Date.now()) / 60_000)
  if (min <= 0) return "now"
  if (min < 60) return `for ${min} more min`
  const hr = Math.round(min / 60)
  if (hr < 48) return `for ${hr} more hour${hr === 1 ? "" : "s"}`
  const day = Math.round(hr / 24)
  return `for ${day} more days`
}
