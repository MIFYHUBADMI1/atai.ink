"use client"

import { Clock, ImageOff, Tag, User } from "lucide-react"
import { ArticleBody } from "@/components/blog/article-body"
import { ComparisonTable } from "@/components/blog/comparison-table"
import { markdownToc, normalizeBlogBody, readingMinutes, splitFaqSection } from "@/lib/blog/content"
import type { BlogSeo, ComparisonData } from "@/lib/blog/types"

export type ArticlePreviewInput = {
  title: string
  description: string
  excerpt?: string
  body: string
  category: string
  tags: string[]
  competitor?: string
  comparison?: ComparisonData
  featuredImage?: { url: string; alt: string }
  seo?: Partial<BlogSeo>
  author: { name: string; role?: string }
  publishedAt?: string
  updatedAt?: string
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

/**
 * The article as readers will see it, rendered inside the editor. It uses the
 * live page's body renderer, outline and comparison table, so markdown that
 * looks wrong here will look wrong publicly.
 *
 * Category, author and tag chips stay unlinked on purpose: following them would
 * navigate the admin away from unsaved work.
 */
export function ArticlePreview({ article }: { article: ArticlePreviewInput }) {
  // Exactly the preparation the live page applies, so this is what readers
  // will get — not a friendlier version of it.
  const body = normalizeBlogBody(article.body)
  const sections = markdownToc(splitFaqSection(body).body)
  const minutes = readingMinutes(body)
  const publishedDay = article.publishedAt
  const updatedDay = article.updatedAt

  const shareTitle = article.seo?.ogTitle?.trim() || article.title || "Untitled article"
  const shareSummary =
    article.seo?.ogDescription?.trim() || article.seo?.description?.trim() || article.description
  const shareImage = article.seo?.ogImage?.trim() || article.featuredImage?.url

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-dashed border-border bg-background px-3 py-2 text-xs text-muted-foreground">
        Preview only — nothing here is public yet. The live page adds the site header, footer, sharing buttons and the
        subscriber form around this layout.
      </p>

      <header className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-primary">
            <Tag className="size-3" /> {article.category.replace(/-/g, " ")}
          </span>
          {article.competitor ? (
            <span className="inline-flex w-fit items-center rounded-full border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              vs {article.competitor}
            </span>
          ) : null}
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          {article.title.trim() || "Untitled article"}
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">
          {article.excerpt?.trim() || article.description.trim() || "No excerpt or description yet — the card on /blog would be blank."}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <User className="size-3.5" /> {article.author.name || "Unnamed author"}
            {article.author.role ? <span className="text-xs">· {article.author.role}</span> : null}
          </span>
          {publishedDay ? <span>Published {formatDate(publishedDay)}</span> : <span>Not published — the date is set when it goes live.</span>}
          {updatedDay && updatedDay !== publishedDay ? <span>Updated {formatDate(updatedDay)}</span> : null}
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" /> {minutes} min read
          </span>
        </div>
        {article.tags.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <span key={tag} className="rounded-full border border-border px-2.5 py-0.5 text-xs">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="space-y-1 lg:sticky lg:top-24 lg:self-start" aria-label="On this page">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">On this page</p>
          {sections.length ? (
            sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className={`block rounded-md px-2.5 py-1.5 text-xs leading-5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${
                  section.level === 3 ? "pl-5" : ""
                }`}
              >
                {section.text}
              </a>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              No headings yet. Start the body at H2 so the outline and the anchors match the page.
            </p>
          )}
        </nav>

        <article className="doc-body min-w-0 max-w-3xl">
          {article.featuredImage?.url ? (
            <figure className="mb-8">
              {/* Mirrors the public page, which loads featured images without the
                  remote allow-list a <Image> would need. */}
              <img
                src={article.featuredImage.url}
                alt={article.featuredImage.alt || article.title}
                className="h-auto w-full rounded-2xl border border-border"
              />
              {article.featuredImage.alt ? (
                <figcaption className="mt-2 text-xs text-muted-foreground">{article.featuredImage.alt}</figcaption>
              ) : null}
            </figure>
          ) : (
            <p className="mb-6 inline-flex items-center gap-2 text-xs text-muted-foreground">
              <ImageOff className="size-3.5" /> No featured image — the article card and the shared link will show text only.
            </p>
          )}

          {body.trim() ? (
            <ArticleBody markdown={body} />
          ) : (
            <p className="text-sm text-muted-foreground">The body is empty, so the page would publish with no content.</p>
          )}

          {article.comparison ? <ComparisonTable comparison={article.comparison} /> : null}
        </article>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">When the link is shared</p>
        <div className="overflow-hidden rounded-lg border border-border">
          {shareImage ? (
            <img src={shareImage} alt="" loading="lazy" decoding="async" className="h-32 w-full object-cover" />
          ) : null}
          <div className="p-3">
            <p className="line-clamp-2 break-words text-sm font-medium">{shareTitle}</p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {shareSummary || "No description, so the preview would be title-only."}
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
