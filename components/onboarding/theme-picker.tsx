"use client"

import { Check, Droplets, Monitor, Moon, Sparkles, Sun } from "lucide-react"
import { THEMES, THEME_DESCRIPTIONS, THEME_LABELS, useTheme, type Theme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const THEME_ICONS: Record<Theme, typeof Monitor> = {
  system: Monitor,
  dark: Moon,
  light: Sun,
  "light-blue": Droplets,
  glass: Sparkles,
}

const THEME_PREVIEW: Record<Theme, { canvas: string; panel: string; ink: string }> = {
  system: {
    canvas: "bg-gradient-to-br from-neutral-200 via-neutral-100 to-neutral-300 dark:from-neutral-700 dark:via-neutral-800 dark:to-neutral-600",
    panel: "border border-black/5 bg-white/85 dark:border-white/10 dark:bg-neutral-900/85",
    ink: "text-neutral-500 dark:text-neutral-300",
  },
  dark: {
    canvas: "bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-800",
    panel: "border border-white/10 bg-neutral-800/90",
    ink: "text-neutral-400",
  },
  light: {
    canvas: "bg-gradient-to-br from-white via-neutral-50 to-neutral-200",
    panel: "border border-black/5 bg-white",
    ink: "text-neutral-400",
  },
  "light-blue": {
    canvas: "bg-gradient-to-br from-blue-50 via-sky-100 to-blue-200",
    panel: "border border-sky-900/5 bg-white/90",
    ink: "text-sky-500",
  },
  glass: {
    canvas: "bg-gradient-to-br from-indigo-950/80 via-slate-900/70 to-purple-950/70",
    panel: "border border-white/20 bg-white/15 backdrop-blur-md",
    ink: "text-white/80",
  },
}

export function OnboardingThemePicker() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="rounded-[1.75rem] border border-border/80 bg-card/95 p-3 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.45)]">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Choose your Atai theme">
        {THEMES.map((t) => {
          const Icon = THEME_ICONS[t]
          const active = theme === t
          const preview = THEME_PREVIEW[t]
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              aria-pressed={active}
              className={cn(
                "group flex flex-col overflow-hidden rounded-2xl border text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active
                  ? "border-indigo-500/60 bg-indigo-500/10 shadow-[0_0_0_1px_rgba(99,102,241,0.22),0_14px_36px_-22px_rgba(79,70,229,0.55)]"
                  : "border-border bg-card hover:border-indigo-500/30 hover:bg-accent/50",
              )}
            >
              <span className={cn("relative block h-24 overflow-hidden border-b border-border/60", preview.canvas)}>
                <span className={cn("absolute left-2.5 top-2 flex gap-1", preview.ink)}>
                  <span className="size-1.5 rounded-full bg-current" />
                  <span className="size-1.5 rounded-full bg-current opacity-70" />
                  <span className="size-1.5 rounded-full bg-current opacity-40" />
                </span>
                <span className={cn("absolute right-2.5 top-2 h-2 w-10 rounded-full bg-current opacity-25", preview.ink)} />
                <span className={cn("absolute bottom-2.5 left-2.5 right-2.5 top-7 rounded-lg p-1.5", preview.panel, preview.ink)}>
                  <span className="block h-1.5 w-2/3 rounded-full bg-current opacity-50" />
                  <span className="mt-1 block h-1.5 w-1/2 rounded-full bg-current opacity-30" />
                  <span className="mt-1.5 flex gap-1">
                    <span className="h-3 w-6 rounded bg-indigo-500/80" />
                    <span className="h-3 w-6 rounded bg-current opacity-15" />
                  </span>
                </span>
                {active ? (
                  <span className="absolute right-2 top-8 grid size-5 place-items-center rounded-full bg-indigo-600 text-white shadow-sm">
                    <Check className="size-3" />
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-3 p-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/70 bg-muted/50">
                  <Icon className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold leading-5">{THEME_LABELS[t]}</span>
                    {active ? <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-500">Selected</span> : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{THEME_DESCRIPTIONS[t]}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
