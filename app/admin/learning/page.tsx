"use client"

import { AdminNav } from "@/components/admin-nav"
import { LearningManager } from "@/components/admin/learning-manager"

export default function AdminLearningPage() {
  return (
    <div className="min-h-svh bg-background">
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <LearningManager />
      </main>
    </div>
  )
}
