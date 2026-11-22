/**
 * Which body the "what was read" dialog shows.
 *
 * The bug this exists to prevent: an open dialog with no payload yet is NOT the
 * same thing as a read with no stored copy. Rendering the "nothing to show"
 * copy while the request is still in flight made a slow read look like a broken
 * one — the founder closed the dialog believing there was nothing there, and
 * only saw the content on a second attempt.
 */
export type ReadingPreviewState = "loading" | "error" | "empty" | "ready"

export function readingPreviewState(
  payload: { reading: unknown } | null,
  error: string | null,
): ReadingPreviewState {
  // An answer settles it, even if that answer is "we kept no copy".
  if (payload) return payload.reading ? "ready" : "empty"
  if (error) return "error"
  return "loading"
}
