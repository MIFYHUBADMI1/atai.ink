import { AdminNav } from "@/components/admin-nav"
import { RedirectsManager } from "@/components/admin/blog/redirects-manager"

export default function AdminBlogRedirectsPage() {
  return (
    <div className="min-h-svh bg-background">
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <RedirectsManager />
      </main>
    </div>
  )
}
