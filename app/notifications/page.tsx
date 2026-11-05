"use client"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { NotificationsWorkspace } from "@/components/dashboard/notifications-workspace"

export default function NotificationsPage() {
  return (
    <DashboardShell title="Notifications">
      <NotificationsWorkspace />
    </DashboardShell>
  )
}
