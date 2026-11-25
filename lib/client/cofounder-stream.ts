"use client"

import { postNdjson } from "@/lib/client/api"
import type {
  CofounderScope,
  CofounderStreamAction,
  CofounderStreamDone,
  CofounderWorklogStep,
} from "@/lib/cofounder/workspace-types"

/**
 * Stream one co-founder turn over NDJSON.
 *
 * Thin wrapper over `postNdjson`: the transport already knows how to route
 * `delta`, `error` and `done` frames and how to turn an aborted fetch into a
 * `STOPPED` error. This file only adds the two frame kinds the workspace
 * understands — live tool steps and prepared actions.
 */
export interface SendCofounderStreamArgs {
  message: string
  conversationId?: string
  scope: CofounderScope
  signal?: AbortSignal
  onDelta: (text: string) => void
  onStep?: (step: CofounderWorklogStep) => void
  onAction?: (action: CofounderStreamAction) => void
}

export function sendCofounderStream(args: SendCofounderStreamArgs): Promise<CofounderStreamDone> {
  return postNdjson<CofounderStreamDone>(
    "/api/cofounder/stream",
    {
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      message: args.message,
      scope: args.scope,
    },
    {
      onDelta: args.onDelta,
      ...(args.signal ? { signal: args.signal } : {}),
      onMeta: (frame) => {
        const step = frame.step
        if (step && typeof step === "object") {
          args.onStep?.(step as CofounderWorklogStep)
        }
        const action = frame.pending_action
        if (action && typeof action === "object") {
          args.onAction?.(action as CofounderStreamAction)
        }
      },
    },
  )
}
