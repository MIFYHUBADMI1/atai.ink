import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { ArticleCard } from "@/components/blog/article-card"
import { publicArticles } from "@/lib/blog/store"
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/blog/seo"
import { SITE_URL } from "@/lib/env"

export const revalidate = 300

type Params = { params: Promise<{ tag: string }> }

/** The route segment is already decoded once. A second decode throws on a
 * segment like "100% off", which would turn a tag page into a 500. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { tag } = await params
  const label = safeDecode(tag)
  return {
    title: `Articles about ${label} | Atai Blog`,
    description: `Guides and comparisons tagged ${label} from Atai.`,
    alternates: { canonical: `/blog/tag/${tag}` },
    robots: { index: true, follow: true },
  }
}

export default async function BlogTagPage({ params }: Params) {
  const { tag } = await params
  const label = safeDecode(tag)
  const articles = (await publicArticles()).filter((article) =>
    article.tags.some((entry) => entry.toLowerCase() === label.toLowerCase()),
  )

  const canonical = `${SITE_URL}/blog/tag/${tag}`
  const jsonLd = jsonLdScript([
    breadcrumbJsonLd([
      { name: "Home", url: SITE_URL },
      { name: "Blog", url: `${SITE_URL}/blog` },
      { name: label, url: canonical },
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
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">Topic</p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">{label}</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
            {articles.length} article{articles.length === 1 ? "" : "s"} tagged “{label}”.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-10">
        {articles.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article) => (
              <ArticleCard key={article.slug} article={article} />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No articles with this tag yet.</p>
        )}
      </div>

      <SiteFooter activePage="/blog" />
    </main>
  )
}