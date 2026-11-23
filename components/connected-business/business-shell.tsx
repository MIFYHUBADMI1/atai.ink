"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  AppWindow,
  ArrowLeft,
  Building2,
  LayoutDashboard,
  MessagesSquare,
  Settings,
  TrendingUp,
  Wallet,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { BusinessStatus } from "@/lib/types/business"

/**
 * The connected-business shell.
 *
 * Deliberately not `DashboardShell`: this workspace has no source, database,
 * environment, hosting or deploy screens, so it must not render the project
 * navigation groups at all. Every href here is `/business/<id>/…` — the
 * isolation test fails the build if a `/project/` link appears in this tree.
 */

export const BUSINESS_NAV = [
  { href: "", label: "Overview", icon: LayoutDashboard, tour: "nav-business-overview" },
  { href: "/applications", label: "Applications", icon: AppWindow, tour: "nav-business-applications" },
  { href: "/growth", label: "Growth", icon: TrendingUp, tour: "nav-business-growth" },
  { href: "/plan", label: "Plan", icon: MessagesSquare, tour: "nav-business-plan" },
  { href: "/money", label: "Money", icon: Wallet, tour: "nav-business-money" },
  { href: "/settings", label: "Settings", icon: Settings, tour: "nav-business-settings" },
] as const

const STATUS_LABEL: Record<BusinessStatus, string> = {
  draft: "Draft",
  active: "Active",
  suspended: "Suspended",
  archived: "Archived",
}

const STATUS_CLASS: Record<BusinessStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-success/15 text-success",
  suspended: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  archived: "bg-muted text-muted-foreground",
}

function initialOf(name: string): string {
  const letter = name.trim().charAt(0)
  return letter ? letter.toUpperCase() : "B"
}

export function BusinessShell({
  businessId,
  businessName,
  status,
  children,
}: {
  businessId: string
  businessName: string
  status: BusinessStatus
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const root = `/business/${businessId}`

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-sm font-semibold text-primary-foreground shadow-sm"
              >
                {initialOf(businessName)}
              </span>
              <div className="flex min-w-0 flex-col">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold tracking-tight">{businessName}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
                      STATUS_CLASS[status],
                    )}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                </div>
                <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  <Building2 className="size-3" aria-hidden />
                  Connected business
                </span>
              </div>
            </div>
            <Link
              href="/projects"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">All businesses</span>
            </Link>
          </div>

          <nav
            aria-label="Business workspace"
            className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {BUSINESS_NAV.map((item) => {
              const href = `${root}${item.href}`
              const active = item.href === "" ? pathname === root : pathname.startsWith(href)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={href}
                  data-atai-tour={item.tour}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
    </div>
  )
}
