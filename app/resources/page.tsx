import type { Metadata } from "next"
import Link from "next/link"
import { BookOpen, FileDown, Film, Route } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { ResourcesHub } from "@/components/resources/hub"
import { CATEGORY_ACCENT } from "@/components/resources/accents"
import { AuthTrigger } from "@/components/auth/auth-trigger"
import { buttonVariants } from "@/components/ui/button"
import { SITE_URL } from "@/lib/env"
import { CATEGORY_META, RESOURCE_CATEGORIES, summarize } from "@/lib/resources"
import { featuredPublicResource, publicSummaries } from "@/lib/resources/store"
import { resourceFormat } from "@/lib/resources/media"
import { cn } from "@/lib/utils"

export const revalidate = 300

export const metadata: Metadata = {
  title: "Atai Resources | Guides, playbooks, tutorials, and templates for founders",
  description:
    "Practical guides, playbooks, tutorials, roadmaps, templates, documents, and videos for turning ideas into real products and businesses — including how to use Atai.",
  keywords: [
    "start a business",
    "business guides",
    "startup playbooks",
    "MVP guide",
    "product roadmap",
    "founder tutorials",
    "Atai resources",
  ],
  alternates: { canonical: "/resources", types: { "text/plain": [{ url: "/llms.txt" }] } },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    title: "Atai Resources",
    description: "Practical knowledge for founders, builders, and people using Atai to create and grow products.",
    url: `${SITE_URL}/resources`,
    siteName: "Atai",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Atai resources" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Atai Resources",
    description: "Guides, playbooks, tutorials, and templates for building, launching, and growing a product.",
    images: ["/og-image.png"],
  },
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: number | string; icon?: typeof BookOpen; tone: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {Icon ? (
          <span className={cn("flex size-6 items-center justify-center rounded-lg", tone)}>
            <Icon className="size-3.5" aria-hidden />
          </span>
        ) : null}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  )
}

export default async function ResourcesPage() {
  const resources = await publicSummaries()
  const featured = summarize(await featuredPublicResource())
  const downloads = resources.filter((resource) => resource.file).length
  const videos = resources.filter((resource) => resourceFormat(resource) === "video").length
  const latestUpdate = resources
    .map((resource) => resource.updatedAt)
    .sort()
    .at(-1)

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Atai Resources",
      description: metadata.description,
      url: `${SITE_URL}/resources`,
      isPartOf: { "@type": "WebSite", name: "Atai", url: SITE_URL },
      dateModified: latestUpdate,
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
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Resources", item: `${SITE_URL}/resources` },
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
        <header className="max-w-3xl">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">Resources</p>
          <h1 className="mt-3 text-balance text-3xl font-black tracking-tight sm:text-5xl">
            Build smarter. Launch faster. Grow with clarity.
          </h1>
          <p className="mt-4 text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
            Practical guides, playbooks, tutorials, roadmaps, templates, documents, images, and videos for turning
            ideas into real products — including how to use Atai. Every published resource is also part of the Atai
            documentation surface and is written to be readable by people and AI search engines.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/docs" className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}>
              <BookOpen className="size-4" /> Read the documentation
            </Link>
            <Link href="/resources/launch/launch-checklist" className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}>
              <Route className="size-4" /> Launch checklist
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-muted-foreground">
              Updated {latestUpdate ?? "recently"}
            </span>
          </div>
        </header>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Published" value={resources.length} icon={BookOpen} tone="bg-indigo-500/10 text-indigo-600 dark:text-indigo-300" />
          <Stat label="Goal areas" value={RESOURCE_CATEGORIES.length} icon={Route} tone="bg-sky-500/10 text-sky-600 dark:text-sky-300" />
          <Stat label="Downloads" value={downloads} icon={FileDown} tone="bg-amber-500/10 text-amber-600 dark:text-amber-300" />
          <Stat label="Videos" value={videos} icon={Film} tone="bg-rose-500/10 text-rose-600 dark:text-rose-300" />
        </div>

        <div className="mt-10">
          <ResourcesHub resources={resources} featured={featured} />
        </div>

        <section className="mt-16 grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
            <h2 className="text-xl font-semibold">The documentation connects to this library</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Product walkthroughs, tutorials, and the uploaded roadmaps here are referenced from the docs. Start with a
              goal area, then follow the step-by-step documentation when you are ready to build.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {RESOURCE_CATEGORIES.slice(0, 4).map((category) => (
                <Link
                  key={category}
                  href={`/resources/${category}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  <span aria-hidden className={cn("size-1.5 rounded-full", CATEGORY_ACCENT[category].dot)} />
                  {CATEGORY_META[category].label}
                </Link>
              ))}
            </div>
            <Link href="/docs" className={cn(buttonVariants({ variant: "outline" }), "mt-5")}>
              Open the docs
            </Link>
          </div>
          <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
            <h2 className="text-xl font-semibold">Can&apos;t find what you&apos;re looking for?</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Search the library, pick a category and format, or start a project in Atai and learn by doing.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/docs" className={cn(buttonVariants({ variant: "outline" }))}>Read the docs</Link>
              <AuthTrigger view="signup" next="/new/idea" className={cn(buttonVariants())}>
                Try Atai
              </AuthTrigger>
            </div>
          </div>
        </section>
      </div>
      <SiteFooter />
    </main>
  )
}
