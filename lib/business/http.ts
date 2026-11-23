import "server-only"

import { AppError } from "@/lib/errors"
import { isBusinessWorkspaceEnabled } from "./flags"
import { userActor, type Actor } from "./permissions"

/**
 * Route-level gates for the connected-business API.
 *
 * Outside the rollout the surface answers 404, not 403: a business feature that
 * is not enabled for this account does not exist yet.
 */
export function requireWorkspace(userId: string): void {
  if (!isBusinessWorkspaceEnabled(userId)) throw new AppError("NOT_FOUND")
}

export function actorOf(user: { id: string }): Actor {
  return userActor(user.id)
}
