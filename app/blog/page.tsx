import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Sparkles } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { ArticleCard } from "@/components/blog/article-card"
import { BlogSearch } from "@/components/blog/blog-search"
import { BlogPagination } from "@/components/blog/pagination"
import { NewsletterForm } from "@/components/blog/newsletter-form"
import { publicArticles, publicCategories } from "@/lib/blog/store"
import { markdownToText } from "@/lib/blog/content"
import { blogJsonLd, breadcrumbJsonLd, jsonLdScript } from "@/lib/blog/seo"
import { SITE_URL } from "@/lib/env"

export const revalidate = 300

const PAGE_SIZE = 9

export const metadata: Metadata = {
  title: "Atai Insights — Build. Launch. Manage. Grow.",
  description:
    "Practical knowledge, independent comparisons, business-building guides and insights from Atai. Learn how to start, build, launch, manage and grow a business with AI.",
  keywords: [
    "Atai blog",
    "Lovable alternative",
    "Bolt.new alternative",
    "v0 alternative",
    "Replit alternative",
    "AI app builder comparison",
    "how to start a business",
    "AI business builder",
  ],
  alternates: { canonical: "/blog" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: `${SITE_URL}/blog`,
    siteName: "Atai",
    title: "Atai Insights — Build. Launch. Manage. Grow.",
    description:
      "Independent comparisons of Atai with Lovable, Bolt, v0 and Replit, plus practical guides for founders building a business with AI.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Atai Insights" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Atai Insights",
    description: "Comparisons and guides for founders building a business with AI.",
    images: ["/og-image.png"],
  },
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; page?: string }>
}) {
  const { q, category, page: pageParam } = await searchParams
  const [articles, categories] = await Promise.all([publicArticles(), publicCategories()])

  const query = (q ?? "").trim().toLowerCase()
  const activeCategory = categories.find((entry) => entry.slug === category) ?? null
  let filtered = articles
  if (activeCategory) filtered = filtered.filter((article) => article.category === activeCategory.slug)
  if (query) {
    filtered = filtered.filter(
      (article) =>
        article.title.toLowerCase().includes(query) ||
        article.excerpt.toLowerCase().includes(query) ||
        article.tags.some((tag) => tag.toLowerCase().includes(query)) ||
        markdownToText(article.body).toLowerCase().includes(query),
    )
  }

  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1)
  // The featured article is shown once, as the hero, and is removed from the
  // paginated list. Filtering it out AFTER the slice would drop an article
  // from the grid on one page and repeat it on another.
  const hero = !query && !activeCategory ? articles.find((article) => article.featured) ?? null : null
  const pool = hero ? filtered.filter((article) => article.slug !== hero.slug) : filtered
  const totalPages = Math.max(1, Math.ceil(pool.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const gridItems = pool.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const featured = currentPage === 1 ? hero : null
  const popular = !query && currentPage === 1 ? [...articles].filter((article) => article.views > 0).sort((a, b) => b.views - a.views).slice(0, 3) : []
  const tags = [...new Set(articles.flatMap((article) => article.tags))]

  const canonical = `${SITE_URL}/blog`
  const jsonLd = jsonLdScript([
    blogJsonLd(SITE_URL),
    breadcrumbJsonLd([
      { name: "Home", url: SITE_URL },
      { name: "Blog", url: canonical },
    ]),
  ])

  const filterParams: Record<string, string> = {}
  if (query) filterParams.q = query
  if (activeCategory) filterParams.category = activeCategory.slug

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <SiteHeader activePage="/blog" />

      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-7xl px-6 py-14 lg:px-10">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Atai Insights · Build. Launch. Manage. Grow.
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Practical knowledge for founders building a business
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
            Independent comparisons of Atai with Lovable, Bolt, v0 and Replit — plus honest guides on
            starting, building, launching, managing and growing a business with AI.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/blog/category/comparisons"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Comparisons &amp; alternatives <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              Try Atai free
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="Content categories" className="flex flex-wrap gap-2">
            <Link
              href="/blog"
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                !activeCategory ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-accent"
              }`}
            >
              All
            </Link>
            {categories.map((entry) => (
              <Link
                key={entry.slug}
                href={`/blog?category=${entry.slug}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeCategory?.slug === entry.slug
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card hover:bg-accent"
                }`}
              >
                {entry.name}
              </Link>
            ))}
          </nav>
          <BlogSearch defaultValue={query} />
        </div>

        {query || activeCategory ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {filtered.length} article{filtered.length === 1 ? "" : "s"}
            {query ? ` matching “${query}”` : ""}
            {activeCategory ? ` in ${activeCategory.name}` : ""}.{" "}
            <Link href="/blog" className="text-primary hover:underline">
              Clear filters
            </Link>
          </p>
        ) : null}

        {featured ? (
          <section className="mt-8" aria-label="Featured article">
            <p className="mb-3 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-primary">
              <Sparkles className="size-3" /> Featured
            </p>
            <ArticleCard article={featured} featured />
          </section>
        ) : null}

        {gridItems.length ? (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {gridItems.map((article) => (
              <ArticleCard key={article.slug} article={article} />
            ))}
          </div>
        ) : (
          <p className="mt-10 text-muted-foreground">
            No articles found{query ? ` for “${query}”` : ""}. Try another search or browse all posts.
          </p>
        )}

        <BlogPagination page={currentPage} totalPages={totalPages} basePath="/blog" searchParams={filterParams} />

        {popular.length ? (
          <section className="mt-14" aria-label="Popular articles">
            <h2 className="text-xl font-semibold tracking-tight">Most read</h2>
            <p className="mt-1 text-xs text-muted-foreground">Based on actual reader views.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {popular.map((article) => (
                <Link
                  key={article.slug}
                  href={`/blog/${article.slug}`}
                  className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <span className="text-sm font-medium leading-6">{article.title}</span>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    {article.views.toLocaleString()} view{article.views === 1 ? "" : "s"}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {tags.length ? (
          <section className="mt-14" aria-label="Browse by tag">
            <h2 className="text-xl font-semibold tracking-tight">Browse by topic</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/blog/tag/${encodeURIComponent(tag)}`}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {tag}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-14 rounded-2xl border border-border bg-card p-6 sm:p-8" aria-label="Newsletter">
          <h2 className="text-xl font-semibold tracking-tight">Get new guides in your inbox</h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
            One email when we publish something worth reading — comparisons, founder guides and product
            updates. No spam, unsubscribe anytime.
          </p>
          <div className="mt-4 max-w-xl">
            <NewsletterForm source="blog-index" />
          </div>
        </section>
      </div>

      <SiteFooter activePage="/blog" />
    </main>
  )
}