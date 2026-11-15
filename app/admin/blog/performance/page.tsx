import { AdminNav } from "@/components/admin-nav"
import { PerformanceView } from "@/components/admin/blog/performance-view"

export default function AdminBlogPerformancePage() {
  return (
    <div className="min-h-svh bg-background">
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <PerformanceView />
      </main>
    </div>
  )
}
