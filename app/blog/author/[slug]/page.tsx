import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { ArticleCard } from "@/components/blog/article-card"
import { slugifyBlog } from "@/lib/blog/content"
import { publicArticles } from "@/lib/blog/store"
import { authorPersonJsonLd, breadcrumbJsonLd, jsonLdScript } from "@/lib/blog/seo"
import { SITE_URL } from "@/lib/env"

export const revalidate = 300

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const articles = await publicArticles()
  const author = articles.find((article) => slugifyBlog(article.author.name) === slug)?.author
  if (!author) return {}
  return {
    title: `${author.name} | Atai Blog`,
    description: author.bio || `Articles by ${author.name} on Atai.`,
    alternates: { canonical: `/blog/author/${slug}` },
    robots: { index: true, follow: true },
  }
}

export default async function BlogAuthorPage({ params }: Params) {
  const { slug } = await params
  const articles = await publicArticles()
  const written = articles.filter((article) => slugifyBlog(article.author.name) === slug)
  const author = written[0]?.author
  const canonical = `${SITE_URL}/blog/author/${slug}`

  const jsonLd = jsonLdScript([
    ...(author ? [authorPersonJsonLd(author, SITE_URL)] : []),
    breadcrumbJsonLd([
      { name: "Home", url: SITE_URL },
      { name: "Blog", url: `${SITE_URL}/blog` },
      { name: author?.name ?? "Author", url: canonical },
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
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">Author</p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            {author?.name ?? "Author not found"}
          </h1>
          {author?.role ? <p className="mt-3 text-sm text-muted-foreground">{author.role}</p> : null}
          {author?.bio ? <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{author.bio}</p> : null}
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-10">
        {written.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {written.map((article) => (
              <ArticleCard key={article.slug} article={article} />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No published articles by this author yet.</p>
        )}
      </div>

      <SiteFooter activePage="/blog" />
    </main>
  )
}