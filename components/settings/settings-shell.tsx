"use client"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { SettingsNav } from "@/components/settings/settings-nav"

export function SettingsShell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <DashboardShell title={title}>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <SettingsNav />
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </DashboardShell>
  )
}
