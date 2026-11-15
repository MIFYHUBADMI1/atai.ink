import { notFound } from "next/navigation"
import { AdminNav } from "@/components/admin-nav"
import { ArticleEditor } from "@/components/admin/blog/article-editor"
import { getAdminArticle, listAdminCategories, toAdminView } from "@/lib/blog/store"
import { SITE_URL } from "@/lib/env"

type Params = { params: Promise<{ id: string }> }

export default async function EditArticlePage({ params }: Params) {
  const { id } = await params
  const [doc, categories] = await Promise.all([getAdminArticle(id), listAdminCategories()])
  if (!doc) notFound()

  return (
    <div className="min-h-svh bg-background">
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <ArticleEditor
          article={toAdminView(doc)}
          categories={categories.map((category) => ({ slug: category.slug, name: category.name }))}
          siteUrl={SITE_URL}
        />
      </main>
    </div>
  )
}
