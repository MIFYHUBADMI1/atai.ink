import { AdminNav } from "@/components/admin-nav"
import { NewsletterView } from "@/components/admin/blog/newsletter-view"

export default function AdminBlogNewsletterPage() {
  return (
    <div className="min-h-svh bg-background">
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <NewsletterView />
      </main>
    </div>
  )
}
