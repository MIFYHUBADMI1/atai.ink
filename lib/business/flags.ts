import "server-only"

/**
 * Connected-workspace rollout (D4).
 *
 * CONNECTED_WORKSPACE_V2 = off | internal | all, with an internal cohort kept
 * separately so a staging rollout never widens by accident. An unrecognised
 * value means `off`: a typo must not open the surface.
 *
 * @module lib/business/flags
 */

export type BusinessWorkspaceMode = "off" | "internal" | "all"

export function businessWorkspaceMode(): BusinessWorkspaceMode {
  const raw = (process.env.CONNECTED_WORKSPACE_V2 ?? "off").trim().toLowerCase()
  return raw === "internal" || raw === "all" ? raw : "off"
}

function internalCohort(): ReadonlySet<string> {
  const raw = process.env.CONNECTED_WORKSPACE_COHORT ?? ""
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
}

export function isBusinessWorkspaceEnabled(userId: string): boolean {
  const mode = businessWorkspaceMode()
  if (mode === "off") return false
  if (mode === "all") return true
  return internalCohort().has(userId)
}
