import type { ComponentType, ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * The connected-business design language.
 *
 * Every operate page is built from these four pieces so the surface reads as
 * one product: a hero that names the page, sections that carry an icon and a
 * title, tiles for a single number, and a panel for a state that has nothing in
 * it yet. They are presentational only — no data, no decisions — so a page can
 * adopt them without changing what it does.
 */

type IconType = ComponentType<{ className?: string }>

const CHIP_TONES = {
  muted: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "bg-red-500/10 text-red-700 dark:text-red-400",
} as const

export type ChipTone = keyof typeof CHIP_TONES

export function Chip({ tone = "muted", children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
        CHIP_TONES[tone],
      )}
    >
      {children}
    </span>
  )
}

export function PageHero({
  eyebrow,
  title,
  description,
  meta,
  actions,
}: {
  eyebrow: string
  title: string
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-7">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
          <h1 className="max-w-3xl break-words text-2xl font-semibold tracking-tight text-balance sm:text-3xl lg:text-4xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </section>
  )
}

export function SectionCard({
  icon: Icon,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  icon?: IconType
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-border/80 bg-card", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 p-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <Icon className="size-4" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold tracking-tight sm:text-lg">{title}</h2>
            {description ? (
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? (
        <div className={cn("min-w-0 border-t border-border/70 p-4 sm:p-5", bodyClassName)}>{children}</div>
      ) : null}
    </section>
  )
}

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "muted",
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: IconType
  tone?: ChipTone
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-border/80 bg-card p-4">
      <div className="flex items-center gap-2">
        {Icon ? (
          <span className={cn("grid size-7 place-items-center rounded-lg", CHIP_TONES[tone])}>
            <Icon className="size-3.5" />
          </span>
        ) : null}
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-1 break-words text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function EmptyPanel({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: IconType
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-3xl border border-dashed border-border bg-card/60 p-5 sm:p-7">
      {Icon ? (
        <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <Icon className="size-5" />
        </span>
      ) : null}
      <div className="flex flex-col gap-2">
        <h1 className="max-w-2xl break-words text-xl font-semibold tracking-tight text-balance sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  )
}
