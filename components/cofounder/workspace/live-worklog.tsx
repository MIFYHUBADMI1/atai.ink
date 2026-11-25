"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Loader2, X, EyeOff } from "lucide-react"
import type { CofounderWorklogStep } from "@/lib/cofounder/workspace-types"
import { cn } from "@/lib/utils"

/**
 * The live worklog: what the co-founder is doing while it answers.
 *
 * Steps are keyed by tool-call id, so a call that starts and finishes updates
 * one row rather than adding a second. The elapsed timer only runs while the
 * turn is live; a finished log keeps its final shape until the founder hides it.
 */
export function LiveWorklog({
  steps,
  running,
  onHide,
}: {
  steps: CofounderWorklogStep[]
  running: boolean
  onHide?: () => void
}) {
  const startedAt = useRef(Date.now())
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!running) return
    startedAt.current = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running])

  if (!steps.length) return null

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {running ? <Loader2 className="size-3 animate-spin text-primary" aria-hidden /> : null}
          {running ? `Working — ${elapsed}s` : "Worked"}
        </p>
        {!running && onHide ? (
          <button
            type="button"
            onClick={onHide}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <EyeOff className="size-3" aria-hidden />
            Hide
          </button>
        ) : null}
      </div>
      <ul className="space-y-1.5">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2 text-xs leading-5">
            <span className="mt-0.5 shrink-0">
              {step.status === "running" ? (
                <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
              ) : step.status === "error" ? (
                <X className="size-3.5 text-destructive" aria-hidden />
              ) : (
                <Check className="size-3.5 text-emerald-500" aria-hidden />
              )}
            </span>
            <span className={cn("min-w-0 break-words", step.status === "error" ? "text-destructive" : "text-foreground/80")}>
              {step.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
