import { AdminNav } from "@/components/admin-nav"
import { ArticleEditor } from "@/components/admin/blog/article-editor"
import { listAdminCategories } from "@/lib/blog/store"
import { SITE_URL } from "@/lib/env"

export default async function NewArticlePage() {
  const categories = (await listAdminCategories()).map((category) => ({
    slug: category.slug,
    name: category.name,
  }))

  return (
    <div className="min-h-svh bg-background">
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <ArticleEditor article={null} categories={categories} siteUrl={SITE_URL} />
      </main>
    </div>
  )
}
