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

const THEME_PREVIEW: Record<Theme, string> = {
  system: "bg-gradient-to-br from-neutral-200 via-neutral-100 to-neutral-300 dark:from-neutral-700 dark:via-neutral-800 dark:to-neutral-600",
  dark: "bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-700",
  light: "bg-gradient-to-br from-white via-neutral-50 to-neutral-200",
  "light-blue": "bg-gradient-to-br from-blue-50 via-sky-100 to-blue-200",
  glass: "bg-gradient-to-br from-white/40 via-indigo-100/50 to-purple-200/40 backdrop-blur-sm",
}

export function OnboardingThemePicker() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Choose your Atai theme">
      {THEMES.map((t) => {
        const Icon = THEME_ICONS[t]
        const active = theme === t
        return (
          <button
            key={t}
            type="button"
            onClick={() => setTheme(t)}
            aria-pressed={active}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-indigo-500/50 bg-indigo-500/10"
                : "border-border bg-card/70 hover:border-indigo-500/25 hover:bg-accent/40",
            )}
          >
            <span className={cn("relative mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-border/70", THEME_PREVIEW[t])}>
              <Icon className="size-4 text-foreground/80" />
              {active ? (
                <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-indigo-600 text-white">
                  <Check className="size-2.5" />
                </span>
              ) : null}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-5">{THEME_LABELS[t]}</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{THEME_DESCRIPTIONS[t]}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
