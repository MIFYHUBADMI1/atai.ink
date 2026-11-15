import type { Metadata } from "next"
import fs from "node:fs"
import path from "node:path"
import Link from "next/link"
import { ArrowLeft, ArrowRight, LifeBuoy } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { MarkdownArticle } from "@/components/resources/markdown-article"
import { markdownHeadings } from "@/lib/resources/media"
import { extractFaqs } from "@/lib/docs/faq"
import { SITE_URL } from "@/lib/env"

/**
 * The extended onboarding guide — a long-form companion to /docs.
 *
 * The content lives in docs/ONBOARDING_GUIDE.md so it can be edited as a
 * normal Markdown file. It is read at build time (force-static), which means
 * no filesystem access is needed at request time and no runtime dependency
 * on the repo layout in a deployed environment.
 */
export const dynamic = "force-static"

const GUIDE_PATH = path.join(process.cwd(), "docs", "ONBOARDING_GUIDE.md")

function loadGuide(): string {
  try {
    const raw = fs.readFileSync(GUIDE_PATH, "utf8")
    // The page renders its own H1 hero, so drop the file's title line to keep
    // a single H1. Both the renderer and the TOC read this same string, so
    // heading anchors stay in sync.
    return raw.replace(/^# [^\n]*\n+/, "")
  } catch {
    return [
      "# Onboarding guide unavailable",
      "",
      "The guide content could not be loaded. The short documentation is at",
      `[${SITE_URL}/docs](${SITE_URL}/docs).`,
    ].join("\n")
  }
}

export const metadata: Metadata = {
  title: "Atai Getting Started Guide | Create an Account & Build Your Business",
  description:
    "A plain-language, step-by-step guide to starting, building, launching, running and growing a business on Atai — with fixes for common problems.",
  keywords: [
    "Atai onboarding",
    "Atai getting started",
    "create Atai account",
    "Atai sign up",
    "Atai login",
    "Atai tutorial",
    "Atai troubleshooting",
    "build a business with AI",
    "start an online business",
  ],
  alternates: { canonical: "/docs/onboarding" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "article",
    locale: "en_US",
    url: `${SITE_URL}/docs/onboarding`,
    siteName: "Atai",
    title: "Atai Getting Started Guide | Create an Account",
    description:
      "Everything a new Atai owner needs: start, build, run and grow a business — with clear steps and fixes for common problems.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Atai onboarding guide" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Atai Getting Started Guide | Create an Account",
    description: "The Atai getting-started guide — every step and every fix.",
    images: ["/og-image.png"],
  },
}

export default function OnboardingGuidePage() {
  const markdown = loadGuide()
  const sections = markdownHeadings(markdown)
  const troubleshootingId =
    sections.find((s) => /common problems/i.test(s.text))?.id ?? "common-problems"

  // Two sections hold Q/A content: "Common problems" and "Frequently asked
  // questions". Merge both (deduped) so the FAQPage structured data reflects
  // everything the guide actually answers.
  const faqs = (() => {
    const seen = new Set<string>()
    return [
      ...extractFaqs(markdown),
      ...extractFaqs(markdown, { section: /^##\s+frequently asked questions/i }),
    ]
      .filter((f) => {
        const key = f.q.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 30)
  })()
  const canonical = `${SITE_URL}/docs/onboarding`

  // Structured data: helps search engines and AI assistants parse the guide
  // as authoritative documentation and surface its common-problem answers.
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "mainEntityOfPage": { "@type": "WebPage", "@id": canonical },
    "headline": "Atai Getting Started Guide",
    "description":
      "Everything a new Atai owner needs, end to end: what Atai is, how to start, plan, build, publish, operate, grow and scale — plus a fix for every common problem.",
    "image": [`${SITE_URL}/og-image.png`],
    "datePublished": "2026-11-14",
    "dateModified": "2026-11-14",
    "author": { "@type": "Organization", "name": "Atai", "url": SITE_URL },
    "publisher": {
      "@type": "Organization",
      "name": "Atai",
      "url": SITE_URL,
      "logo": { "@type": "ImageObject", "url": `${SITE_URL}/og-image.png` },
    },
    "about": { "@type": "Thing", "name": "Atai business-building platform" },
    "proficiencyLevel": "Beginner",
  }
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map((f) => ({
      "@type": "Question",
      "name": f.q,
      "acceptedAnswer": { "@type": "Answer", "text": f.a },
    })),
  }
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": SITE_URL },
      { "@type": "ListItem", "position": 2, "name": "Docs", "item": `${SITE_URL}/docs` },
      { "@type": "ListItem", "position": 3, "name": "Onboarding guide", "item": canonical },
    ],
  }
  const jsonLd = JSON.stringify([articleJsonLd, faqJsonLd, breadcrumbJsonLd])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <SiteHeader activePage="/docs" />

      {/* Hero */}
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
            Atai Getting Started Guide
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
            Everything a new owner needs, end to end: what Atai is, how to start, plan, build,
            publish, operate, grow and scale — plus a fix for every common problem.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Create your account <ArrowRight className="size-4" />
            </Link>
            <a
              href={`#${sections[0]?.id ?? ""}`}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
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
          <p className="mt-4 text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary underline underline-offset-4 hover:decoration-primary">
              Sign in
            </Link>
            .
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-12 lg:grid lg:grid-cols-[240px_1fr] lg:gap-12 lg:px-10">
        {/* Table of contents */}
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

        {/* Guide body */}
        <article className="max-w-3xl min-w-0">
          <div className="mb-8 rounded-xl border border-primary/25 bg-primary/5 px-5 py-4 text-sm leading-6 text-muted-foreground">
            <strong className="text-foreground">New here?</strong> Manage your credits, plan and
            invoices in{" "}
            <Link href="/settings/billing" className="font-medium text-primary underline underline-offset-4 hover:decoration-primary">
              Settings → Billing
            </Link>
            . Then start with Section 1 below and follow the steps in order.
          </div>

          <MarkdownArticle markdown={markdown} className="onboarding-doc" />

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
              <Link href="/new" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                Start a business <ArrowRight className="size-3.5" />
              </Link>
              <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">View pricing</Link>
              <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground">Short docs</Link>
              <Link href="/resources" className="text-sm text-muted-foreground hover:text-foreground">Resource library</Link>
            </div>
          </div>
        </article>
      </div>

      <SiteFooter activePage="/docs" />
    </main>
  )
}
