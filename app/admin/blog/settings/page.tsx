import { AdminNav } from "@/components/admin-nav"
import { SettingsView } from "@/components/admin/blog/settings-view"

export default function AdminBlogSettingsPage() {
  return (
    <div className="min-h-svh bg-background">
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <SettingsView />
      </main>
    </div>
  )
}
