"use client"

import { AdminNav } from "@/components/admin-nav"
import { LessonsManager } from "@/components/admin/lessons-manager"

export default function AdminLessonsPage() {
  return (
    <div className="min-h-svh bg-background">
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <LessonsManager />
      </main>
    </div>
  )
}
