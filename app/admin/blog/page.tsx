import Link from "next/link"
import { Mail } from "lucide-react"
import { AdminNav } from "@/components/admin-nav"
import { StudioDashboard } from "@/components/admin/blog/studio-dashboard"

export default function AdminBlogPage() {
  return (
    <div className="min-h-svh bg-background">
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6">
        <StudioDashboard />
        <Link
          href="/admin/blog/newsletter"
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
        >
          <span>
            <span className="block text-sm font-semibold">Newsletter subscribers</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Everyone who asked for new guides in their inbox, and every announcement that went out.
            </span>
          </span>
          <Mail className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      </main>
    </div>
  )
}
