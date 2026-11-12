/**
 * Launch kit draft view-model (pure) — turns a drafted slot body into a
 * structured display without ever dropping founder content.
 *
 * The 14-day content calendar slot mandates the line shape
 * "Day N — idea — channel — call to action", so its draft can be rendered as
 * real day cards with per-day progress instead of a wall of text. Any line
 * that is not a day line is preserved as a note and rendered above the
 * calendar — nothing is silently discarded.
 *
 * NO network, DB, or environment access — unit-testable.
 */

export interface CalendarDay {
  day: number
  idea: string
  channel: string | null
  cta: string | null
  /** The original line, verbatim — used for per-day copy. */
  raw: string
}

export interface ParsedCalendar {
  days: CalendarDay[]
  /** Non-empty lines that were not day lines. Rendered, never dropped. */
  notes: string[]
}

const DAY_LINE = /^Day\s+(\d+)\s*[—–-]+\s*(.*)$/i
const WRAPPING_QUOTES = /^['"‘’“”](.*)['"‘’“”]$/

/** Drafted channels and CTAs often arrive wrapped in quotes — unwrap for display. */
function unwrapQuotes(text: string): string {
  const trimmed = text.trim()
  const match = WRAPPING_QUOTES.exec(trimmed)
  const unwrapped = (match ? match[1] : trimmed).trim()
  return unwrapped || trimmed
}

/**
 * Parse a calendar draft into day cards. Returns null when the body is not
 * calendar-shaped (fewer than 3 day lines), so the caller can fall back to
 * markdown rendering instead of showing a broken structure.
 */
export function parseCalendarDays(body: string): ParsedCalendar | null {
  const lines = body.replace(/\r\n?/g, "\n").split("\n")
  const days: CalendarDay[] = []
  const notes: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = DAY_LINE.exec(trimmed)
    if (!match) {
      notes.push(trimmed)
      continue
    }
    const rest = match[2].trim()
    // The idea text itself may contain em-dashes, so the channel is the
    // second-to-last segment and the call to action the last — anything
    // between the day number and those two is the idea, rejoined verbatim.
    const segments = rest
      .split(/\s+[—–]\s+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
    if (segments.length >= 3) {
      days.push({
        day: Number(match[1]),
        idea: segments.slice(0, -2).join(" — "),
        channel: unwrapQuotes(segments[segments.length - 2]),
        cta: unwrapQuotes(segments[segments.length - 1]),
        raw: trimmed,
      })
    } else {
      days.push({ day: Number(match[1]), idea: rest, channel: null, cta: null, raw: trimmed })
    }
  }

  if (days.length < 3) return null
  return { days, notes }
}

/** Sanitize a slot label into a safe download filename base. */
export function slotFileBase(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return base || "launch-kit-draft"
}
