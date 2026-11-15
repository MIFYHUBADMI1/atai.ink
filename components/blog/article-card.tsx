import Link from "next/link"
import { Clock, Tag } from "lucide-react"
import type { BlogArticleDoc } from "@/lib/blog/types"

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

export function ArticleCard({ article, featured = false }: { article: BlogArticleDoc; featured?: boolean }) {
  return (
    <article
      className={`flex flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40 ${
        featured ? "sm:col-span-2 lg:col-span-3" : ""
      }`}
    >
      {article.featuredImage?.url ? (
        <Link href={`/blog/${article.slug}`} className="mb-4 block overflow-hidden rounded-xl border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={article.featuredImage.url}
            alt={article.featuredImage.alt || article.title}
            loading="lazy"
            className="aspect-[16/8] w-full object-cover"
          />
        </Link>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/blog/category/${article.category}`}
          className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-primary/20"
        >
          <Tag className="size-3" /> {article.category.replace(/-/g, " ")}
        </Link>
        {article.competitor ? (
          <span className="inline-flex w-fit items-center rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            vs {article.competitor}
          </span>
        ) : null}
      </div>
      <h2 className={`text-balance font-semibold tracking-tight ${featured ? "text-2xl" : "text-xl"}`}>
        <Link href={`/blog/${article.slug}`} className="hover:text-primary">
          {article.title}
        </Link>
      </h2>
      <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">{article.excerpt || article.description}</p>
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
        <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" /> {article.readingMinutes} min read
        </span>
      </div>
    </article>
  )
}