"use client"

import { ArrowRight, Building2, Sparkles } from "lucide-react"
import { GitHubIcon } from "@/components/github-icon"
import { ONBOARDING_PATHS, type OnboardingPathId } from "@/lib/onboarding/profile"
import { cn } from "@/lib/utils"

const ICONS = {
  build: Sparkles,
  import: GitHubIcon,
  connect: Building2,
} as const

/**
 * The fork in the journey: build something new, bring a codebase, or connect a
 * business that already runs. Every later step differs by this answer, so it is
 * asked plainly instead of being inferred from whatever the founder types.
 */
export function OnboardingPathStep({
  value,
  onChoose,
  disabled,
}: {
  value: OnboardingPathId | ""
  onChoose: (path: OnboardingPathId) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2">
        {ONBOARDING_PATHS.map((option) => {
          const Icon = ICONS[option.id]
          const active = value === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChoose(option.id)}
              disabled={disabled}
              aria-pressed={active}
              data-path={option.id}
              className={cn(
                "group flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                active
                  ? "border-indigo-500/50 bg-indigo-500/10"
                  : "border-border hover:border-foreground/20 hover:bg-accent/40",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]",
                  active ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300" : "bg-secondary text-secondary-foreground",
                )}
              >
                <Icon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-5 text-foreground">{option.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.hint}</span>
              </span>
              <ArrowRight className="mt-1.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          )
        })}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Already running something? Connecting it takes a live site and a few sentences — nothing gets rebuilt.
      </p>
    </div>
  )
}
