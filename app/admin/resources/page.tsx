"use client"

import { AdminNav } from "@/components/admin-nav"
import { ResourcesManager } from "@/components/admin/resources-manager"

export default function AdminResourcesPage() {
  return (
    <div className="min-h-svh bg-background">
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <ResourcesManager />
      </main>
    </div>
  )
}
