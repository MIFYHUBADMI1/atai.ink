import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { ResourceCard } from "@/components/resources/resource-card"
import { CATEGORY_ACCENT } from "@/components/resources/accents"
import { SITE_URL } from "@/lib/env"
import {
  CATEGORY_META,
  RESOURCE_CATEGORIES,
  isResourceCategory,
  summarize,
} from "@/lib/resources"
import { publicResourcesByCategory } from "@/lib/resources/store"
import { resourceFormat } from "@/lib/resources/media"
import { cn } from "@/lib/utils"

export const revalidate = 300

export function generateStaticParams() {
  return RESOURCE_CATEGORIES.map((category) => ({ category }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const { category } = await params
  if (!isResourceCategory(category)) return {}
  const meta = CATEGORY_META[category]
  const url = `/resources/${category}`
  return {
    title: `${meta.title} | Atai Resources`,
    description: meta.description,
    keywords: [meta.label, ...meta.description.split(/[,.]/).map((part) => part.trim()).filter(Boolean).slice(0, 5)],
    alternates: { canonical: url, types: { "text/plain": [{ url: "/llms.txt" }] } },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      title: `${meta.title} | Atai Resources`,
      description: meta.description,
      url: `${SITE_URL}${url}`,
      siteName: "Atai",
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: meta.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${meta.title} | Atai Resources`,
      description: meta.description,
      images: ["/og-image.png"],
    },
  }
}

export default async function ResourceCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>
}) {
  const { category } = await params
  if (!isResourceCategory(category)) notFound()
  const meta = CATEGORY_META[category]
  const resources = (await publicResourcesByCategory(category)).map(summarize)
  const url = `${SITE_URL}/resources/${category}`
  const latestUpdate = resources.map((resource) => resource.updatedAt).sort().at(-1)
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: meta.title,
      description: meta.description,
      url,
      dateModified: latestUpdate,
      isPartOf: { "@type": "WebSite", name: "Atai", url: SITE_URL },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: resources.length,
        itemListElement: resources.map((resource, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: resource.title,
          url: `${SITE_URL}${resource.href}`,
          description: resource.description,
        })),
      },
      hasPart: resources.map((resource) => ({
        "@type":
          resourceFormat(resource) === "video"
            ? "VideoObject"
            : resourceFormat(resource) === "document"
              ? "DigitalDocument"
              : "TechArticle",
        headline: resource.title,
        url: `${SITE_URL}${resource.href}`,
        datePublished: resource.publishedAt,
        dateModified: resource.updatedAt,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Resources", item: `${SITE_URL}/resources` },
        { "@type": "ListItem", position: 2, name: meta.label, item: url },
      ],
    },
  ]

  return (
    <main className="min-h-svh bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <SiteHeader activePage="/resources" />
      <div className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8 lg:px-10">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <ol className="flex flex-wrap gap-2">
            <li><Link href="/resources" className="hover:text-foreground">Resources</Link></li>
            <li aria-hidden>/</li>
            <li className="text-foreground">{meta.label}</li>
          </ol>
        </nav>
        <header className="relative mt-6 max-w-3xl overflow-hidden rounded-3xl border border-border/70 bg-card px-6 py-6 sm:px-8 sm:py-8">
          <div aria-hidden className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", CATEGORY_ACCENT[category].glow)} />
          <div className="relative">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.18em]",
                CATEGORY_ACCENT[category].chip,
              )}
            >
              {meta.label}
            </span>
            <h1 className="mt-3 text-balance text-3xl font-black tracking-tight sm:text-4xl">{meta.title}</h1>
            <p className="mt-3 text-base leading-7 text-muted-foreground">{meta.description}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {resources.length} {resources.length === 1 ? "resource" : "resources"}
              {latestUpdate ? ` · Updated ${latestUpdate}` : ""} · Part of the{" "}
              <Link href="/docs" className="text-foreground underline underline-offset-4">
                Atai documentation surface
              </Link>
            </p>
          </div>
        </header>

        {resources.length > 0 ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {resources.map((resource) => (
              <ResourceCard key={resource.href} resource={resource} />
            ))}
          </div>
        ) : (
          <div className="mt-10 rounded-2xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">
              Nothing published in this area yet. Browse the full{" "}
              <Link href="/resources" className="text-foreground underline underline-offset-4">resource library</Link>{" "}
              or read the <Link href="/docs" className="text-foreground underline underline-offset-4">documentation</Link>.
            </p>
          </div>
        )}

        <nav aria-label="Other resource areas" className="mt-14 border-t border-border pt-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Keep exploring</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/resources" className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              All resources
            </Link>
            {RESOURCE_CATEGORIES.filter((item) => item !== category).map((item) => (
              <Link
                key={item}
                href={`/resources/${item}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <span aria-hidden className={cn("size-1.5 rounded-full", CATEGORY_ACCENT[item].dot)} />
                {CATEGORY_META[item].label}
              </Link>
            ))}
          </div>
        </nav>
      </div>
      <SiteFooter />
    </main>
  )
}
