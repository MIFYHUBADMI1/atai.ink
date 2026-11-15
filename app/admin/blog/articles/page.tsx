import { AdminNav } from "@/components/admin-nav"
import { ArticlesManager } from "@/components/admin/blog/articles-manager"
import { listAdminCategories } from "@/lib/blog/store"
import { BLOG_STATUSES, type BlogStatus } from "@/lib/blog/types"

export default async function AdminBlogArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; category?: string; author?: string }>
}) {
  const [params, categories] = await Promise.all([searchParams, listAdminCategories()])
  const status = BLOG_STATUSES.includes(params.status as BlogStatus) ? (params.status as BlogStatus) : "all"

  return (
    <div className="min-h-svh bg-background">
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <ArticlesManager
          categories={categories.map((category) => ({
            slug: category.slug,
            name: category.name,
          }))}
          initialFilters={{
            query: params.q ?? "",
            status,
            category: params.category ?? "all",
            author: params.author ?? "all",
          }}
        />
      </main>
    </div>
  )
}
