import type { Metadata } from "next"
import { SITE_URL } from "@/lib/env"
import { DocsContent } from "@/components/docs-content"

const DOC_SECTIONS = [
  ["getting-started", "Getting Started"],
  ["how-it-works", "How It Works"],
  ["pipeline-modes", "Atai Standard & Pro"],
  ["website-mode", "Website Mode"],
  ["idea-mode", "Idea Mode"],
  ["collaborate", "Collaborate & Refine Plan"],
  ["understanding", "Understanding & Planning"],
  ["editing-your-plan", "Editing Your Plan"],
  ["building", "Building Your Application"],
  ["database-manager", "Database Manager"],
  ["workspace", "Working With Your App"],
  ["publishing", "Publishing & Domains"],
  ["github", "GitHub Integration"],
  ["credits", "Credits & Billing"],
  ["appearance", "Themes & Appearance"],
  ["account", "Account & Settings"],
  ["faq", "Frequently Asked Questions"],
] as const

export const metadata: Metadata = {
  title: "Atai Documentation | Guides, Tutorials & Help",
  description:
    "Complete guide to Atai. Learn how to turn websites and ideas into working applications, manage projects, publish to custom domains, and get the most out of every feature.",
  keywords: [
    "Atai documentation",
    "how to use Atai",
    "AI business platform guide",
    "idea mode",
    "website mode",
    "GitHub mode",
    "publish a website",
    "custom domains",
    "AI credits and billing",
  ],
  alternates: { canonical: "/docs", types: { "text/plain": [{ url: "/llms.txt" }] } },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: `${SITE_URL}/docs`,
    siteName: "Atai",
    title: "Atai Documentation | Guides, Tutorials & Help",
    description:
      "Complete guide to Atai. Learn how to turn websites and ideas into working applications.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Atai Documentation" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Atai Documentation | Guides, Tutorials & Help",
    description: "Complete guide to Atai — tutorials, guides, and help.",
    images: ["/og-image.png"],
  },
}

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "Atai Documentation",
    name: "Atai Documentation",
    description:
      "Complete guide to Atai: how to turn an idea or website into a working application, plan with AI teams, build, publish to a custom domain, manage credits, and operate a business.",
    url: `${SITE_URL}/docs`,
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/docs` },
    author: { "@type": "Organization", name: "Atai", url: SITE_URL },
    publisher: { "@type": "Organization", name: "Atai", url: SITE_URL },
    inLanguage: "en",
    isAccessibleForFree: true,
    articleSection: "Product documentation",
    about: [
      { "@type": "Thing", name: "Starting an online business with AI" },
      { "@type": "Thing", name: "Building a website or application" },
      { "@type": "Thing", name: "Publishing and custom domains" },
    ],
    hasPart: DOC_SECTIONS.map(([id, name]) => ({
      "@type": "TechArticle",
      name,
      url: `${SITE_URL}/docs#${id}`,
    })),
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Documentation", item: `${SITE_URL}/docs` },
    ],
  },
]

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <DocsContent />
    </main>
  )
}
