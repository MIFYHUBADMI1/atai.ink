import type { ResourceCategory, ResourceDifficulty } from "@/lib/resources/types"

/** Tailwind class sets that give every goal area a stable visual identity.
 * All strings are literal so Tailwind's scanner picks them up. */
export type CategoryAccent = {
  /** Eyebrow and inline label color. */
  text: string
  /** Colored pill: border + bg + text. */
  chip: string
  /** Soft tile behind an icon. */
  iconTile: string
  /** Card hover border. */
  hoverBorder: string
  /** Gradient stops for feature washes; pair with `bg-gradient-to-br`/`bg-gradient-to-b`. */
  glow: string
  /** Small inline dot. */
  dot: string
  /** Card title color on group hover. */
  hoverTitle: string
}

export const CATEGORY_ACCENT: Record<ResourceCategory, CategoryAccent> = {
  start: {
    text: "text-emerald-600 dark:text-emerald-300",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    iconTile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    hoverBorder: "hover:border-emerald-500/40 dark:hover:border-emerald-400/40",
    glow: "from-emerald-500/15 via-emerald-500/5 to-transparent",
    dot: "bg-emerald-500 dark:bg-emerald-400",
    hoverTitle: "group-hover:text-emerald-700 dark:group-hover:text-emerald-300",
  },
  build: {
    text: "text-sky-600 dark:text-sky-300",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    iconTile: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
    hoverBorder: "hover:border-sky-500/40 dark:hover:border-sky-400/40",
    glow: "from-sky-500/15 via-sky-500/5 to-transparent",
    dot: "bg-sky-500 dark:bg-sky-400",
    hoverTitle: "group-hover:text-sky-700 dark:group-hover:text-sky-300",
  },
  launch: {
    text: "text-amber-600 dark:text-amber-300",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    iconTile: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
    hoverBorder: "hover:border-amber-500/40 dark:hover:border-amber-400/40",
    glow: "from-amber-500/15 via-amber-500/5 to-transparent",
    dot: "bg-amber-500 dark:bg-amber-400",
    hoverTitle: "group-hover:text-amber-700 dark:group-hover:text-amber-300",
  },
  grow: {
    text: "text-violet-600 dark:text-violet-300",
    chip: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    iconTile: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
    hoverBorder: "hover:border-violet-500/40 dark:hover:border-violet-400/40",
    glow: "from-violet-500/15 via-violet-500/5 to-transparent",
    dot: "bg-violet-500 dark:bg-violet-400",
    hoverTitle: "group-hover:text-violet-700 dark:group-hover:text-violet-300",
  },
  ai: {
    text: "text-fuchsia-600 dark:text-fuchsia-300",
    chip: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
    iconTile: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300",
    hoverBorder: "hover:border-fuchsia-500/40 dark:hover:border-fuchsia-400/40",
    glow: "from-fuchsia-500/15 via-fuchsia-500/5 to-transparent",
    dot: "bg-fuchsia-500 dark:bg-fuchsia-400",
    hoverTitle: "group-hover:text-fuchsia-700 dark:group-hover:text-fuchsia-300",
  },
  atai: {
    text: "text-indigo-600 dark:text-indigo-300",
    chip: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    iconTile: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
    hoverBorder: "hover:border-indigo-500/40 dark:hover:border-indigo-400/40",
    glow: "from-indigo-500/15 via-indigo-500/5 to-transparent",
    dot: "bg-indigo-500 dark:bg-indigo-400",
    hoverTitle: "group-hover:text-indigo-700 dark:group-hover:text-indigo-300",
  },
  templates: {
    text: "text-teal-600 dark:text-teal-300",
    chip: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
    iconTile: "bg-teal-500/10 text-teal-600 dark:text-teal-300",
    hoverBorder: "hover:border-teal-500/40 dark:hover:border-teal-400/40",
    glow: "from-teal-500/15 via-teal-500/5 to-transparent",
    dot: "bg-teal-500 dark:bg-teal-400",
    hoverTitle: "group-hover:text-teal-700 dark:group-hover:text-teal-300",
  },
  glossary: {
    text: "text-slate-600 dark:text-slate-300",
    chip: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    iconTile: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
    hoverBorder: "hover:border-slate-500/40 dark:hover:border-slate-400/40",
    glow: "from-slate-500/15 via-slate-500/5 to-transparent",
    dot: "bg-slate-500 dark:bg-slate-400",
    hoverTitle: "group-hover:text-slate-700 dark:group-hover:text-slate-300",
  },
}

export const DIFFICULTY_ACCENT: Record<ResourceDifficulty, string> = {
  beginner: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  intermediate: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  advanced: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
}
