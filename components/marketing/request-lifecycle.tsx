import { AlertTriangle, Check, Circle, Loader2, PauseCircle, RotateCcw, XCircle } from "lucide-react"
import {
  LIFECYCLE_STAGES,
  lifecyclePosition,
  requestStatusGroup,
  type RequestStatusGroup,
} from "@/lib/marketing/ads/center-model"
import { AD_REQUEST_STATUS_LABELS } from "@/lib/marketing/ads/request-shared"
import type { AdRequestStatus } from "@/lib/types/ads"
import { cn } from "@/lib/utils"

/**
 * Promotion-request lifecycle visuals, derived purely from the request status
 * (see center-model.lifecyclePosition). The eight stages mirror the manual
 * execution pipeline Atai's team actually walks — nothing here implies automatic
 * publishing. Terminal side-states (rejected / cancelled / refunded) and pauses
 * are surfaced honestly rather than hidden behind a green progress bar.
 */

export const GROUP_BADGE_STYLES: Record<RequestStatusGroup, string> = {
  needs_action: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  in_review: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  running: "bg-primary/10 text-primary",
  completed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  closed: "bg-muted text-muted-foreground",
}

export function StatusGroupBadge({ status }: { status: AdRequestStatus }) {
  const group = requestStatusGroup(status)
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", GROUP_BADGE_STYLES[group])}>
      {AD_REQUEST_STATUS_LABELS[status]}
    </span>
  )
}

const SIDE_BANNER: Record<
  Exclude<ReturnType<typeof lifecyclePosition>["side"], "none">,
  { tone: string; icon: typeof AlertTriangle; text: string }
> = {
  needs_info: {
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    icon: AlertTriangle,
    text: "Atai's team needs more information before continuing. Reply below to keep things moving.",
  },
  paused: {
    tone: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
    icon: PauseCircle,
    text: "This promotion is paused. Atai's team will resume it and record results when it continues.",
  },
  rejected: {
    tone: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: XCircle,
    text: "This request was declined. Nothing was charged. You can submit a new request any time.",
  },
  cancelled: {
    tone: "border-border bg-muted text-muted-foreground",
    icon: XCircle,
    text: "This request was cancelled. No further work is scheduled.",
  },
  refunded: {
    tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    icon: RotateCcw,
    text: "Credits for this request were refunded to your balance.",
  },
}

/** Full eight-stage vertical stepper for the request detail view. */
export function LifecycleStepper({ status }: { status: AdRequestStatus }) {
  const position = lifecyclePosition(status)
  const allComplete = position.index === LIFECYCLE_STAGES.length
  const banner = position.side !== "none" ? SIDE_BANNER[position.side] : null

  return (
    <div className="flex flex-col gap-4">
      {banner ? (
        <p className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-5", banner.tone)}>
          <banner.icon className="mt-0.5 size-4 shrink-0" aria-hidden /> {banner.text}
        </p>
      ) : null}
      <ol className="flex flex-col gap-0">
        {LIFECYCLE_STAGES.map((stage, i) => {
          const complete = allComplete || i < position.index
          const current = !allComplete && i === position.index && position.side !== "rejected" && position.side !== "cancelled" && position.side !== "refunded"
          return (
            <li key={stage.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border",
                    complete
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : current
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {complete ? <Check className="size-3.5" aria-hidden /> : current ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Circle className="size-3" aria-hidden />}
                </span>
                {i < LIFECYCLE_STAGES.length - 1 ? (
                  <span className={cn("my-0.5 w-px flex-1", complete ? "bg-emerald-500/40" : "bg-border")} aria-hidden />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 pb-4">
                <p className={cn("text-sm font-medium", complete || current ? "text-foreground" : "text-muted-foreground")}>
                  {stage.label}
                </p>
                {current ? <p className="mt-0.5 text-xs text-primary">Current stage</p> : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Compact segmented progress for a request card. */
export function LifecycleMini({ status }: { status: AdRequestStatus }) {
  const position = lifecyclePosition(status)
  const group = requestStatusGroup(status)
  const allComplete = position.index === LIFECYCLE_STAGES.length
  const closed = group === "closed"

  if (closed) {
    return (
      <p className="text-xs text-muted-foreground">
        {AD_REQUEST_STATUS_LABELS[status]} — this request is closed.
      </p>
    )
  }

  const stageLabel = allComplete ? "Campaign completed" : LIFECYCLE_STAGES[position.index]?.label ?? ""
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1" aria-hidden>
        {LIFECYCLE_STAGES.map((stage, i) => {
          const complete = allComplete || i < position.index
          const current = !allComplete && i === position.index
          return (
            <span
              key={stage.id}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                complete ? "bg-emerald-500" : current ? "bg-primary" : "bg-muted",
              )}
            />
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {allComplete ? stageLabel : `Stage ${position.index + 1} of ${LIFECYCLE_STAGES.length} · ${stageLabel}`}
        {position.side === "paused" ? " · paused" : position.side === "needs_info" ? " · needs info" : ""}
      </p>
    </div>
  )
}