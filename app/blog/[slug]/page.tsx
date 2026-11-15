import type { Metadata } from "next"
import Link from "next/link"
import { notFound, permanentRedirect } from "next/navigation"
import { ArrowLeft, ArrowRight, Clock, Tag, User } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { ArticleBody } from "@/components/blog/article-body"
import { ComparisonTable } from "@/components/blog/comparison-table"
import { ShareButtons } from "@/components/blog/share-buttons"
import { NewsletterForm } from "@/components/blog/newsletter-form"
import { ViewBeacon } from "@/components/blog/view-beacon"
import { markdownToc, slugifyBlog } from "@/lib/blog/content"
import { publicArticles, relatedArticles, resolvePublicSlug } from "@/lib/blog/store"
import { articleMetadata, blogPostingJsonLd, breadcrumbJsonLd, faqJsonLd, jsonLdScript } from "@/lib/blog/seo"
import { SITE_URL } from "@/lib/env"

export const revalidate = 300

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const resolution = await resolvePublicSlug(slug)
  if (resolution.kind !== "article") return {}
  return articleMetadata(resolution.article, SITE_URL) as Metadata
}

export default async function BlogPostPage({ params }: Params) {
  const { slug } = await params
  const resolution = await resolvePublicSlug(slug)
  if (resolution.kind === "redirect") permanentRedirect(`/blog/${resolution.toSlug}`)
  if (resolution.kind !== "article") notFound()
  const post = resolution.article

  const all = await publicArticles()
  const related = relatedArticles(post, all)

  // The hero renders the H1; drop a leading file-style title line so the page
  // keeps exactly one H1 and TOC anchors stay in sync with the renderer.
  const markdown = post.body.replace(/^# [^\n]*\n+/, "")
  const sections = markdownToc(markdown)
  const faq = faqJsonLd(markdown)
  const canonical = `${SITE_URL}/blog/${post.slug}`
  const authorSlug = slugifyBlog(post.author.name)

  const jsonLd = jsonLdScript([
    blogPostingJsonLd(post, SITE_URL),
    ...(faq ? [faq] : []),
    breadcrumbJsonLd([
      { name: "Home", url: SITE_URL },
      { name: "Blog", url: `${SITE_URL}/blog` },
      { name: post.title, url: canonical },
    ]),
  ])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <ViewBeacon slug={post.slug} />
      <SiteHeader activePage="/blog" />

      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-7xl px-6 py-14 lg:px-10">
          <Link
            href="/blog"
            className="mb-6 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to blog
          </Link>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Link
              href={`/blog/category/${post.category}`}
              className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-primary hover:bg-primary/20"
            >
              <Tag className="size-3" /> {post.category.replace(/-/g, " ")}
            </Link>
            {post.competitor ? (
              <span className="inline-flex w-fit items-center rounded-full border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                vs {post.competitor}
              </span>
            ) : null}
          </div>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">{post.title}</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{post.excerpt || post.description}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <Link href={`/blog/author/${authorSlug}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
              <User className="size-3.5" /> {post.author.name}
              {post.author.role ? <span className="text-xs">· {post.author.role}</span> : null}
            </Link>
            <time dateTime={post.publishedAt}>Published {formatDate(post.publishedAt)}</time>
            {post.updatedAt && post.updatedAt !== post.publishedAt ? (
              <time dateTime={post.updatedAt}>Updated {formatDate(post.updatedAt)}</time>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" /> {post.readingMinutes} min read
            </span>
          </div>
          {post.tags.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/blog/tag/${encodeURIComponent(tag)}`}
                  className="rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-accent"
                >
                  {tag}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-12 lg:grid lg:grid-cols-[240px_1fr] lg:gap-12 lg:px-10">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 max-h-[calc(100vh-8rem)] space-y-1 overflow-y-auto pr-2" aria-label="On this page">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">On this page</p>
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className={`block rounded-md px-2.5 py-1.5 text-xs leading-5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${
                  section.level === 3 ? "pl-5" : ""
                }`}
              >
                {section.text}
              </a>
            ))}
          </nav>
        </aside>

        <article className="doc-body max-w-3xl min-w-0">
          {post.featuredImage?.url ? (
            <figure className="mb-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.featuredImage.url}
                alt={post.featuredImage.alt || post.title}
                className="h-auto w-full rounded-2xl border border-border"
              />
              {post.featuredImage.alt ? (
                <figcaption className="mt-2 text-xs text-muted-foreground">{post.featuredImage.alt}</figcaption>
              ) : null}
            </figure>
          ) : null}

          <ArticleBody markdown={markdown} />

          {post.comparison ? <ComparisonTable comparison={post.comparison} /> : null}

          <div className="mt-10 border-t border-border pt-6">
            <ShareButtons url={canonical} title={post.title} />
          </div>

          <div className="mt-12 rounded-2xl border border-border bg-card p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Ready to build?</p>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              Atai takes you from an idea to a running business — plan it, build the app, launch it, then
              manage and grow it in one place.
            </p>
            <div className="mt-5 flex flex-wrap gap-3 border-t border-border pt-5">
              <Link
                href="/register"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                Create a free account <ArrowRight className="size-3.5" />
              </Link>
              <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
                See pricing
              </Link>
              <Link href="/docs/onboarding" className="text-sm text-muted-foreground hover:text-foreground">
                Getting started guide
              </Link>
            </div>
          </div>

          {related.length ? (
            <section className="mt-12">
              <h2 className="text-xl font-semibold tracking-tight">Related reading</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {related.map((entry) => (
                  <Link
                    key={entry.slug}
                    href={`/blog/${entry.slug}`}
                    className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                  >
                    <span className="text-sm font-medium leading-6 text-foreground">{entry.title}</span>
                    <span className="mt-2 block text-xs text-muted-foreground">{entry.readingMinutes} min read</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-12 rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold tracking-tight">Enjoyed this guide?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Get the next one in your inbox.</p>
            <div className="mt-4">
              <NewsletterForm source={`article:${post.slug}`} compact />
            </div>
          </section>
        </article>
      </div>

      <SiteFooter activePage="/blog" />
    </main>
  )
}