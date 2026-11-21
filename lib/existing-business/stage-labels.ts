import type { IntakeStageStatus } from "@/lib/types/business-intake"

/**
 * A short, honest status sentence for a processing panel. The wording follows
 * the real stage outcomes — a partially completed run says which part failed
 * instead of claiming the whole business was read.
 */
export function intakeStatusLabel(status: IntakeStageStatus): string {
  switch (status) {
    case "pending":
      return "Waiting to start"
    case "processing":
      return "Reading your business"
    case "completed":
      return "Done"
    case "partially_completed":
      return "Done, with gaps"
    case "failed":
      return "Could not complete"
    case "skipped":
      return "Not applicable"
    default:
      return "Waiting to start"
  }
}
