import "server-only"

import { checkRateLimit } from "@/lib/auth/rate-limit"
import { AppError } from "@/lib/errors"
import { isBusinessWorkspaceEnabled } from "./flags"
import { userActor, type Actor } from "./permissions"

/**
 * Route-level gates for the connected-business API.
 *
 * Outside the rollout the surface answers 404, not 403: a business feature that
 * is not enabled for this account does not exist yet.
 *
 * The rollout check runs before the limiter on purpose. A user outside the
 * cohort gets a plain 404 whether or not they are hammering the endpoint, so the
 * limiter cannot be used to probe whether an account has access.
 */
export const BUSINESS_RATE_LIMITS = {
  read: { limit: 240, windowMs: 60_000 },
  write: { limit: 60, windowMs: 60_000 },
} as const

export type BusinessRequestKind = keyof typeof BUSINESS_RATE_LIMITS

export async function requireWorkspace(userId: string, kind: BusinessRequestKind = "read"): Promise<void> {
  if (!(await isBusinessWorkspaceEnabled(userId))) throw new AppError("NOT_FOUND")

  const { limit, windowMs } = BUSINESS_RATE_LIMITS[kind]
  await checkRateLimit({ action: `business.${kind}`, identifier: userId, limit, windowMs })
}

export function actorOf(user: { id: string }): Actor {
  return userActor(user.id)
}
