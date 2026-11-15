import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { ArticleCard } from "@/components/blog/article-card"
import { BlogPagination } from "@/components/blog/pagination"
import { getCategory, publicArticles } from "@/lib/blog/store"
import { breadcrumbJsonLd, categoryMetadata, jsonLdScript } from "@/lib/blog/seo"
import { SITE_URL } from "@/lib/env"

export const revalidate = 300

const PAGE_SIZE = 9

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const category = await getCategory(slug)
  if (!category) return {}
  return categoryMetadata(category, SITE_URL) as Metadata
}

export default async function BlogCategoryPage({
  params,
  searchParams,
}: Params & { searchParams: Promise<{ page?: string }> }) {
  const { slug } = await params
  const { page: pageParam } = await searchParams
  const category = await getCategory(slug)
  if (!category) notFound()

  const articles = (await publicArticles()).filter((article) => article.category === category.slug)
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1)
  const totalPages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = articles.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const canonical = `${SITE_URL}/blog/category/${category.slug}`
  const jsonLd = jsonLdScript([
    breadcrumbJsonLd([
      { name: "Home", url: SITE_URL },
      { name: "Blog", url: `${SITE_URL}/blog` },
      { name: category.name, url: canonical },
    ]),
  ])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <SiteHeader activePage="/blog" />

      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-7xl px-6 py-14 lg:px-10">
          <Link
            href="/blog"
            className="mb-6 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> All articles
          </Link>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">Content category</p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">{category.name}</h1>
          {category.description ? (
            <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{category.description}</p>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-10">
        {pageItems.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {pageItems.map((article) => (
              <ArticleCard key={article.slug} article={article} />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">Nothing published in this category yet — check back soon.</p>
        )}
        <BlogPagination page={currentPage} totalPages={totalPages} basePath={`/blog/category/${category.slug}`} />
      </div>

      <SiteFooter activePage="/blog" />
    </main>
  )
}