import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowUpRight, BookOpen, ExternalLink, FileDown, PlayCircle } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { ArticleBody } from "@/components/resources/article-body"
import { MarkdownArticle } from "@/components/resources/markdown-article"
import { ResourceCard } from "@/components/resources/resource-card"
import { ResourceFormatIcon } from "@/components/resources/format-icon"
import { CATEGORY_ACCENT, DIFFICULTY_ACCENT } from "@/components/resources/accents"
import { AuthTrigger } from "@/components/auth/auth-trigger"
import { buttonVariants } from "@/components/ui/button"
import { SITE_URL } from "@/lib/env"
import {
  CATEGORY_META,
  FORMAT_LABEL,
  RESOURCE_CATEGORIES,
  TYPE_LABEL,
  allResources,
  summarize,
} from "@/lib/resources"
import { getPublicResource, relatedPublicResources } from "@/lib/resources/store"
import {
  formatFileSize,
  markdownHeadings,
  resourceFormat,
  youTubeEmbedUrl,
  youTubeThumbnailUrl,
} from "@/lib/resources/media"
import { cn } from "@/lib/utils"

export const revalidate = 300

export function generateStaticParams() {
  return allResources().map((resource) => ({
    category: resource.category,
    slug: resource.slug,
  }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; slug: string }>
}): Promise<Metadata> {
  const { category, slug } = await params
  const resource = await getPublicResource(category, slug)
  if (!resource) return {}
  const url = `/resources/${resource.category}/${resource.slug}`
  const title = resource.seoTitle || `${resource.title} | Atai Resources`
  const description = resource.seoDescription || resource.description
  const keywords = Array.from(new Set([...resource.topics, ...(resource.keywords ?? [])]))
  const image = resource.imageUrl ?? youTubeThumbnailUrl(resource.youtubeUrl) ?? "/og-image.png"

  return {
    title,
    description,
    keywords,
    alternates: { canonical: url, types: { "text/plain": [{ url: "/llms.txt" }] } },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      title: resource.title,
      description,
      url: `${SITE_URL}${url}`,
      siteName: "Atai",
      publishedTime: resource.publishedAt,
      modifiedTime: resource.updatedAt,
      authors: ["Atai"],
      tags: keywords,
      images: [{ url: image, alt: resource.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: resource.title,
      description,
      images: [image],
    },
  }
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

export default async function ResourceArticlePage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>
}) {
  const { category, slug } = await params
  const resource = await getPublicResource(category, slug)
  if (!resource) notFound()

  const related = (await relatedPublicResources(resource)).map(summarize)
  const format = resourceFormat(resource)
  const formatLabel = FORMAT_LABEL[format]
  const description = resource.seoDescription || resource.description
  const url = `${SITE_URL}/resources/${resource.category}/${resource.slug}`
  const keywords = Array.from(new Set([...resource.topics, ...(resource.keywords ?? [])]))
  const embedUrl = youTubeEmbedUrl(resource.youtubeUrl)
  const thumbnail = youTubeThumbnailUrl(resource.youtubeUrl)
  const headings = resource.contentMarkdown
    ? markdownHeadings(resource.contentMarkdown)
    : resource.body.flatMap((block) => (block.type === "h2" ? [{ id: block.id, text: block.text }] : []))
  const howToSteps = resource.body.flatMap((block) => (block.type === "ol" ? block.items : []))
  const faqItems = resource.body.flatMap((block) => (block.type === "faq" ? block.items : []))

  const base = {
    "@context": "https://schema.org",
    headline: resource.title,
    name: resource.title,
    description,
    datePublished: resource.publishedAt,
    dateModified: resource.updatedAt,
    author: { "@type": "Organization", name: "Atai", url: SITE_URL },
    publisher: { "@type": "Organization", name: "Atai", url: SITE_URL },
    url,
    inLanguage: "en",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    isPartOf: { "@type": "WebSite", name: "Atai", url: SITE_URL },
    keywords: keywords.join(", "),
    about: resource.topics.map((topic) => ({ "@type": "Thing", name: topic })),
  }

  const jsonLd: Record<string, unknown>[] = []
  if (format === "video") {
    jsonLd.push({
      ...base,
      "@type": "VideoObject",
      thumbnailUrl: thumbnail ? [thumbnail] : undefined,
      uploadDate: resource.publishedAt,
      embedUrl: embedUrl ?? undefined,
      contentUrl: resource.youtubeUrl,
    })
  } else if (format === "document") {
    jsonLd.push({
      ...base,
      "@type": "DigitalDocument",
      encodingFormat: resource.file?.mimeType,
      contentUrl: resource.file?.url,
      fileFormat: resource.file?.mimeType,
    })
  } else if (format === "image") {
    jsonLd.push({
      ...base,
      "@type": "ImageObject",
      contentUrl: resource.imageUrl ?? resource.file?.url,
      thumbnailUrl: resource.imageUrl ?? resource.file?.url,
    })
  } else if (format === "link") {
    jsonLd.push({ ...base, "@type": "WebPage", relatedLink: resource.externalUrl })
  } else {
    jsonLd.push({ ...base, "@type": "TechArticle", articleSection: CATEGORY_META[resource.category].label })
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "LearningResource",
      name: resource.title,
      description,
      url,
      learningResourceType: format === "roadmap" ? "Roadmap" : format === "tutorial" ? "Tutorial" : "Guide",
      educationalLevel: resource.difficulty,
      teaches: resource.topics,
      timeRequired: `PT${Math.max(1, resource.readingMinutes)}M`,
      inLanguage: "en",
      isAccessibleForFree: true,
    })
  }

  jsonLd.push({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Resources", item: `${SITE_URL}/resources` },
      {
        "@type": "ListItem",
        position: 3,
        name: CATEGORY_META[resource.category].label,
        item: `${SITE_URL}/resources/${resource.category}`,
      },
      { "@type": "ListItem", position: 4, name: resource.title, item: url },
    ],
  })

  if (howToSteps.length > 0 && (resource.type === "tutorial" || resource.type === "checklist" || resource.title.startsWith("How to"))) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: resource.title,
      description,
      url,
      step: howToSteps.map((name, position) => ({
        "@type": "HowToStep",
        position: position + 1,
        name,
        text: name,
      })),
    })
  }
  if (faqItems.length > 0) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    })
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <SiteHeader activePage="/resources" />
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 pb-20 pt-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:px-10">
        <article>
          <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
            <ol className="flex flex-wrap gap-2">
              <li><Link href="/resources" className="hover:text-foreground">Resources</Link></li>
              <li aria-hidden>/</li>
              <li>
                <Link href={`/resources/${resource.category}`} className="hover:text-foreground">
                  {CATEGORY_META[resource.category].label}
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li className="text-foreground">{resource.title}</li>
            </ol>
          </nav>

          <header className="mt-6 border-b border-border pb-8">
            <p className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              <span className={CATEGORY_ACCENT[resource.category].text}>
                {CATEGORY_META[resource.category].label} · {TYPE_LABEL[resource.type]}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 tracking-[0.12em]">
                <ResourceFormatIcon format={format} className="size-3" />
                {formatLabel}
              </span>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 capitalize tracking-[0.12em]",
                  DIFFICULTY_ACCENT[resource.difficulty],
                )}
              >
                {resource.difficulty}
              </span>
            </p>
            <h1 className="mt-3 text-balance text-3xl font-black tracking-tight sm:text-4xl">{resource.title}</h1>
            <p className="mt-4 max-w-2xl text-pretty text-base leading-7 text-muted-foreground">{resource.description}</p>
            <p className="mt-4 text-sm text-muted-foreground">
              {format === "video"
                ? "Video resource"
                : `${resource.readingMinutes} min read`}
              {" · "}Published by Atai · Updated {formatDate(resource.updatedAt)}
            </p>
            {keywords.length > 0 ? (
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Topics">
                {keywords.slice(0, 8).map((keyword) => (
                  <li key={keyword} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {keyword}
                  </li>
                ))}
              </ul>
            ) : null}
          </header>

          {embedUrl ? (
            <figure className="mt-8">
              <div className="aspect-video overflow-hidden rounded-2xl border border-border bg-black">
                <iframe
                  src={embedUrl}
                  title={resource.title}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                  className="size-full"
                />
              </div>
              {resource.youtubeUrl ? (
                <figcaption className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <PlayCircle className="size-3.5" />
                  <a
                    href={resource.youtubeUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="hover:text-foreground"
                  >
                    Watch on YouTube
                  </a>
                </figcaption>
              ) : null}
            </figure>
          ) : null}

          {format === "image" && resource.imageUrl ? (
            <figure className="mt-8">
              {/* Admin-uploaded images stay external, lazy, and isolated. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resource.imageUrl}
                alt={resource.title}
                loading="lazy"
                className="h-auto w-full rounded-2xl border border-border"
              />
            </figure>
          ) : null}

          {resource.file ? (
            <a
              href={resource.file.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-8 flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-indigo-500/30 hover:bg-accent/40"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                <FileDown className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{resource.file.name}</span>
                <span className="mt-0.5 block font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {[formatFileSize(resource.file.size), resource.file.mimeType].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-300">
                Download <ArrowUpRight className="size-4" />
              </span>
            </a>
          ) : null}

          {resource.externalUrl ? (
            <a
              href={resource.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(buttonVariants({ variant: "outline" }), "mt-6 gap-1.5")}
            >
              <ExternalLink className="size-4" /> Open the original resource
            </a>
          ) : null}

          {headings.length > 0 ? (
            <details className="mt-6 rounded-2xl border border-border bg-card p-4 lg:hidden">
              <summary className="cursor-pointer text-sm font-medium">On this page</summary>
              <ol className="mt-3 space-y-2 text-sm">
                {headings.map((heading) => (
                  <li key={heading.id}>
                    <a href={`#${heading.id}`} className="text-muted-foreground hover:text-foreground">{heading.text}</a>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}

          <div className="mt-8 max-w-2xl">
            {resource.contentMarkdown ? (
              <MarkdownArticle markdown={resource.contentMarkdown} />
            ) : resource.body.length > 0 ? (
              <ArticleBody blocks={resource.body} />
            ) : (
              <p className="text-sm leading-7 text-muted-foreground">
                This resource is published in {formatLabel.toLowerCase()} form. Use the actions above to open it, then
                continue with the related resources and the{" "}
                <Link href="/docs" className="text-foreground underline underline-offset-4">Atai documentation</Link>.
              </p>
            )}
          </div>

          <aside className="mt-10 rounded-2xl border border-border bg-muted/40 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="size-4" /> This resource is part of the Atai documentation surface
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Tutorials, roadmaps, and uploaded documents here are referenced from the product documentation so the
              guidance stays in one place.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/docs" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Open the docs
              </Link>
              <Link href={`/resources/${resource.category}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                More in {CATEGORY_META[resource.category].label}
              </Link>
            </div>
          </aside>

          {related.length > 0 ? (
            <section className="mt-14">
              <h2 className="text-lg font-semibold">Related resources</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {related.map((item) => (
                  <ResourceCard key={item.href} resource={item} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-12 rounded-3xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Ready to put this into practice?</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Atai helps you turn ideas into full-stack products with planning, collaboration, and infrastructure ready to launch.
            </p>
            <AuthTrigger view="signup" next="/new/idea" className={cn(buttonVariants(), "mt-4")}>
              Try Atai
            </AuthTrigger>
          </section>
        </article>

        <aside className="hidden lg:block">
          <div className="sticky top-8 space-y-6">
            {headings.length > 0 ? (
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">On this page</p>
                <ol className="mt-3 space-y-2 text-sm">
                  {headings.map((heading) => (
                    <li key={heading.id}>
                      <a href={`#${heading.id}`} className="text-muted-foreground hover:text-foreground">{heading.text}</a>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Library</p>
              <ul className="mt-3 space-y-2 text-sm">
                <li><Link href="/resources" className="text-muted-foreground hover:text-foreground">All resources</Link></li>
                {RESOURCE_CATEGORIES.filter((item) => item !== resource.category).slice(0, 6).map((item) => (
                  <li key={item}>
                    <Link href={`/resources/${item}`} className="text-muted-foreground hover:text-foreground">
                      {CATEGORY_META[item].label}
                    </Link>
                  </li>
                ))}
                <li><Link href="/docs" className="text-muted-foreground hover:text-foreground">Documentation</Link></li>
              </ul>
            </div>
          </div>
        </aside>
      </div>
      <SiteFooter />
    </main>
  )
}
