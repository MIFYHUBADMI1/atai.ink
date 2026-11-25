"use client"

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * The small vocabulary the co-founder settings rail is built from.
 *
 * One `RailSection` per concern keeps the rail readable: a title, a one-line
 * description, then a body separated by a rule. Nothing here is a `Card` inside
 * another `Card`.
 */

export function RailSection({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-start gap-3 p-4">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {action}
          </div>
          {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
      </header>
      <div className="border-t border-border p-4">{children}</div>
    </section>
  )
}

export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {children}
      </div>
      {hint ? <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function Slider({
  value,
  min = 1,
  max = 5,
  step = 1,
  onChange,
  label,
  disabled,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  label: string
  disabled?: boolean
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
    />
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        checked ? "border-primary bg-primary" : "border-border bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "block size-3.5 rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

export function InlineNotice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error"
  children: ReactNode
}) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "rounded-lg border px-3 py-2 text-xs leading-5",
        tone === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </p>
  )
}
