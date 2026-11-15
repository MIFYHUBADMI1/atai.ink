import type { Metadata } from "next"
import fs from "node:fs"
import path from "node:path"
import Link from "next/link"
import { ArrowLeft, ArrowRight, BookOpen, LifeBuoy } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { MarkdownArticle } from "@/components/resources/markdown-article"
import { markdownHeadings } from "@/lib/resources/media"
import { extractFaqs } from "@/lib/docs/faq"
import { SITE_URL } from "@/lib/env"

/**
 * Extended doc: Runtime API, SDK & API Keys.
 * Source lives in docs/RUNTIME_API_SDK_KEYS.md (edited as Markdown).
 * force-static → read at build time, no runtime filesystem access.
 */
export const dynamic = "force-static"

const GUIDE_PATH = path.join(process.cwd(), "docs", "RUNTIME_API_SDK_KEYS.md")

function loadGuide(): string {
  try {
    const raw = fs.readFileSync(GUIDE_PATH, "utf8")
    return raw.replace(/^# [^\n]*\n+/, "")
  } catch {
    return [
      "# Runtime API guide unavailable",
      "",
      "The guide content could not be loaded. The short SDK reference is at",
      `[${SITE_URL}/sdk](${SITE_URL}/sdk).`,
    ].join("\n")
  }
}

export const metadata: Metadata = {
  title: "Runtime API, SDK & API Keys | Atai Documentation",
  description:
    "A plain-language guide to Atai's Runtime and SDK: what it is, how to install and use it, how to keep your API keys safe, and fixes for common problems.",
  keywords: [
    "Atai Runtime API",
    "Atai SDK",
    "ATAI_API_KEY",
    "Atai API keys",
    "Atai API access",
    "Atai developer",
  ],
  alternates: { canonical: "/docs/runtime-api" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "article",
    locale: "en_US",
    url: `${SITE_URL}/docs/runtime-api`,
    siteName: "Atai",
    title: "Runtime API, SDK & API Keys | Atai",
    description:
      "Call AI, payments, maps, messaging, auth, search and data from one key. Full endpoint reference, key management, and troubleshooting.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Atai Runtime API" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Runtime API, SDK & API Keys | Atai",
    description: "The complete Atai Runtime guide — endpoints, keys, security, limits.",
    images: ["/og-image.png"],
  },
}

export default function RuntimeApiPage() {
  const markdown = loadGuide()
  const sections = markdownHeadings(markdown)
  const troubleshootingId =
    sections.find((s) => /common problems/i.test(s.text))?.id ?? "common-problems"
  const faqs = extractFaqs(markdown)
  const canonical = `${SITE_URL}/docs/runtime-api`

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    headline: "Runtime API, SDK & API Keys",
    description:
      "Everything about the Atai Runtime in plain language: the unified capability API behind every Atai business, the @atai-group/sdk client, keeping API keys safe, security, and usage.",
    image: [`${SITE_URL}/og-image.png`],
    datePublished: "2026-11-14",
    dateModified: "2026-11-14",
    author: { "@type": "Organization", name: "Atai", url: SITE_URL },
    publisher: {
      "@type": "Organization",
      name: "Atai",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/og-image.png` },
    },
    about: { "@type": "Thing", name: "Atai Runtime API" },
    proficiencyLevel: "Intermediate",
  }
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  }
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Docs", item: `${SITE_URL}/docs` },
      { "@type": "ListItem", position: 3, name: "Runtime API", item: canonical },
    ],
  }
  const jsonLd = JSON.stringify([articleJsonLd, ...(faqs.length ? [faqJsonLd] : []), breadcrumbJsonLd])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <SiteHeader activePage="/docs" />

      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-7xl px-6 py-14 lg:px-10">
          <Link
            href="/docs"
            className="mb-6 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to short docs
          </Link>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Documentation · Extended edition
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Runtime API, SDK &amp; API Keys
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
            The unified capability API behind every Atai business. Learn what it is, install the SDK,
            keep your keys safe, and fix what goes wrong — in plain language.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={`#${sections[0]?.id ?? "common-problems"}`}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Start reading <ArrowRight className="size-4" />
            </a>
            <a
              href={`#${troubleshootingId}`}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              <LifeBuoy className="size-4" /> Troubleshooting
            </a>
            <a
              href="/developers"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              <BookOpen className="size-4" /> Developer hub
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-12 lg:grid lg:grid-cols-[240px_1fr] lg:gap-12 lg:px-10">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 max-h-[calc(100vh-8rem)] space-y-1 overflow-y-auto pr-2" aria-label="On this page">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              On this page
            </p>
            {sections.map(({ id, text }) => (
              <a
                key={id}
                href={`#${id}`}
                className={`block rounded-md px-2.5 py-1.5 text-xs leading-5 transition-colors ${
                  /^Part \d+/.test(text) || /^\d+\./.test(text)
                    ? "font-semibold text-foreground hover:bg-accent"
                    : "pl-4 text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {text}
              </a>
            ))}
          </nav>
        </aside>

        <article className="doc-body max-w-3xl min-w-0">
          <MarkdownArticle markdown={markdown} className="doc-body" />

          <div className="mt-16 rounded-xl border border-border bg-card p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Need a human?
            </p>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              Email <a href="mailto:support@atai.ink" className="font-medium text-primary hover:underline">support@atai.ink</a>,
              call or WhatsApp <a href="tel:+256761819885" className="font-medium text-primary hover:underline">+256761819885</a>,
              or follow the{" "}
              <a href="https://whatsapp.com/channel/0029Vb9sizc2Jl8CaYWJhZ1N" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                Atai WhatsApp channel
              </a>.
            </p>
            <div className="mt-5 flex flex-wrap gap-3 border-t border-border pt-5">
              <Link href="/sdk" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                SDK reference <ArrowRight className="size-3.5" />
              </Link>
              <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground">Short docs</Link>
            </div>
          </div>
        </article>
      </div>

      <SiteFooter activePage="/docs" />
    </main>
  )
}
