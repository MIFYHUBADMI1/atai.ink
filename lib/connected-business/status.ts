import type { BusinessConnection, BusinessConnectionStatus } from "@/lib/types/business-intake"

/**
 * Connection status is DERIVED, never asserted.
 *
 * A connected business is only "verified" when two independent things are
 * true: the founder proved the domain is theirs, and the customer's own
 * application authenticated against Atai at least once. Either alone is a
 * half-finished connection, and saying so is the point.
 *
 * Client-safe and pure so the workspace, the list and the API all agree.
 */

/** An application that has not called for this long is reported as stale
 * rather than silently staying "verified" forever. */
export const CONNECTION_STALE_MS = 14 * 24 * 60 * 60 * 1000

export interface ConnectionFacts {
  connection?: BusinessConnection | null
  /** At least one domain for this business is verified. */
  domainVerified: boolean
  now?: number
}

export function businessConnectionStatus({
  connection,
  domainVerified,
  now = Date.now(),
}: ConnectionFacts): BusinessConnectionStatus {
  if (!connection) return "not_connected"
  if (connection.revokedAt) return "revoked"

  const seen = Boolean(connection.firstSeenAt)
  if (seen && domainVerified) {
    const lastSeen = connection.lastSeenAt ?? connection.firstSeenAt ?? 0
    return now - lastSeen > CONNECTION_STALE_MS ? "stale" : "verified"
  }
  if (seen) return "awaiting_domain"
  if (domainVerified) return "awaiting_app"
  if (connection.guideIssuedAt) return "guide_issued"
  return "not_connected"
}

/** The one status that unlocks the connected workspace and business sections. */
export function isConnectionVerified(status: BusinessConnectionStatus): boolean {
  return status === "verified"
}

export const CONNECTION_STATUS_LABEL: Record<BusinessConnectionStatus, string> = {
  not_connected: "Not connected",
  guide_issued: "Guide issued",
  awaiting_app: "Waiting for your app",
  awaiting_domain: "Waiting for domain proof",
  verified: "Connected",
  stale: "No recent calls",
  revoked: "Disconnected",
}
