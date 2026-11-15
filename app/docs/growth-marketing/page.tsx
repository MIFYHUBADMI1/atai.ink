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
 * Extended doc: Growth & marketing playbook.
 * Source lives in docs/GROWTH_MARKETING_PLAYBOOK.md. force-static.
 */
export const dynamic = "force-static"

const GUIDE_PATH = path.join(process.cwd(), "docs", "GROWTH_MARKETING_PLAYBOOK.md")

function loadGuide(): string {
  try {
    const raw = fs.readFileSync(GUIDE_PATH, "utf8")
    return raw.replace(/^# [^\n]*\n+/, "")
  } catch {
    return [
      "# Growth playbook unavailable",
      "",
      "The guide content could not be loaded. Open the Growth area from your project workspace.",
    ].join("\n")
  }
}

export const metadata: Metadata = {
  title: "Growth & marketing playbook | Atai Documentation",
  description:
    "How to grow a business on Atai: the growth overview, Content Studio, SEO audit, ads & campaigns, market and competitor research, referrals, and learning resources — in plain language.",
  keywords: [
    "Atai growth",
    "Atai marketing",
    "Atai SEO audit",
    "Atai ads",
    "Atai referrals",
    "Atai Studio",
  ],
  alternates: { canonical: "/docs/growth-marketing" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "article",
    locale: "en_US",
    url: `${SITE_URL}/docs/growth-marketing`,
    siteName: "Atai",
    title: "Growth & marketing playbook | Atai",
    description:
      "Research the market, publish content, run ads, audit SEO, and learn what to do next — the complete Atai growth playbook.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Atai growth playbook" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Growth & marketing playbook | Atai",
    description: "Grow your Atai business — tools, gating explained, and fixes.",
    images: ["/og-image.png"],
  },
}

export default function GrowthMarketingPage() {
  const markdown = loadGuide()
  const sections = markdownHeadings(markdown)
  const troubleshootingId =
    sections.find((s) => /common problems/i.test(s.text))?.id ?? "common-problems"
  const faqs = extractFaqs(markdown)
  const canonical = `${SITE_URL}/docs/growth-marketing`

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    headline: "Growth & marketing playbook",
    description:
      "How to grow a business on Atai: growth overview, Studio, SEO audit, ads & campaigns, market research, referrals, learning, and feature gating.",
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
    about: { "@type": "Thing", name: "Atai growth & marketing" },
    proficiencyLevel: "Beginner",
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
      { "@type": "ListItem", position: 3, name: "Growth & marketing", item: canonical },
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
            Growth &amp; marketing playbook
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
            Getting customers is the other half of the work. This playbook maps every growth surface,
            what each does, how features are gated, and fixes for the common "why is this greyed out"
            problems.
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
                  /^\d+\./.test(text)
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
              <Link href="/referrals" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                Referrals <ArrowRight className="size-3.5" />
              </Link>
              <Link href="/resources" className="text-sm text-muted-foreground hover:text-foreground">Resources</Link>
              <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground">Short docs</Link>
            </div>
          </div>
        </article>
      </div>

      <SiteFooter activePage="/docs" />
    </main>
  )
}
