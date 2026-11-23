"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  AppWindow,
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
  suspended: "bg-amber-500/10 text-amber-600",
  archived: "bg-muted text-muted-foreground",
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
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pt-5 pb-0 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Building2 className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="truncate text-sm font-semibold">{businessName}</span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
                  STATUS_CLASS[status],
                )}
              >
                {STATUS_LABEL[status]}
              </span>
            </div>
            <Link href="/projects" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
              ← All businesses
            </Link>
          </div>

          <nav aria-label="Business workspace" className="flex flex-wrap gap-1 border-b border-transparent">
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
                    "inline-flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "border-b-2 border-primary text-foreground"
                      : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
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
