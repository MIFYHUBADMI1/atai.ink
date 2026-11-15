import type { BlogCategoryDoc } from "@/lib/blog/types"
import { extractBlogFaqs } from "@/lib/blog/content"

/**
 * Serialise structured data for a `<script type="application/ld+json">` block.
 *
 * A title, description or FAQ answer containing `</script>` would otherwise
 * close the element and inject markup, so every character that could end the
 * script block is escaped to its JSON unicode form. The result is still valid
 * JSON — the escapes are only read by the JSON-LD parser.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

interface ArticleSeoInput {
  slug: string
  title: string
  description: string
  excerpt: string
  publishedAt: string
  updatedAt: string
  tags: string[]
  author: { name: string; url?: string }
  featuredImage?: { url: string; alt: string }
  seo?: {
    title?: string
    description?: string
    canonical?: string
    ogTitle?: string
    ogDescription?: string
    ogImage?: string
    noindex?: boolean
  }
}

/** Dynamic metadata for a public article. Canonical defaults to the article
 * URL; admins can override it (e.g. for syndicated content). */
export function articleMetadata(input: ArticleSeoInput, baseUrl: string) {
  const url = `${baseUrl}/blog/${input.slug}`
  const title = input.seo?.title?.trim() || `${input.title} | Atai Blog`
  const description = input.seo?.description?.trim() || input.description
  const image = input.seo?.ogImage || input.featuredImage?.url || `${baseUrl}/og-image.png`
  return {
    title,
    description,
    keywords: input.tags,
    alternates: { canonical: input.seo?.canonical?.trim() || `/blog/${input.slug}` },
    robots: input.seo?.noindex ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: {
      type: "article" as const,
      locale: "en_US",
      url,
      siteName: "Atai",
      title: input.seo?.ogTitle?.trim() || input.title,
      description: input.seo?.ogDescription?.trim() || input.excerpt || description,
      publishedTime: input.publishedAt,
      modifiedTime: input.updatedAt || input.publishedAt,
      authors: [input.author.name],
      tags: input.tags,
      images: [{ url: image, width: 1200, height: 630, alt: input.featuredImage?.alt || input.title }],
    },
    twitter: {
      card: "summary_large_image" as const,
      title: input.seo?.ogTitle?.trim() || input.title,
      description: input.seo?.ogDescription?.trim() || description,
      images: [image],
    },
  }
}

export function blogPostingJsonLd(input: ArticleSeoInput, baseUrl: string) {
  const url = `${baseUrl}/blog/${input.slug}`
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    headline: input.title,
    description: input.description,
    image: [input.featuredImage?.url || `${baseUrl}/og-image.png`],
    datePublished: input.publishedAt,
    dateModified: input.updatedAt || input.publishedAt,
    author: {
      "@type": "Person",
      name: input.author.name,
      ...(input.author.url ? { url: input.author.url } : {}),
    },
    publisher: {
      "@type": "Organization",
      name: "Atai",
      url: baseUrl,
      logo: { "@type": "ImageObject", url: `${baseUrl}/og-image.png` },
    },
    keywords: input.tags.join(", "),
    inLanguage: "en",
  }
}

export function faqJsonLd(markdown: string) {
  const faqs = extractBlogFaqs(markdown)
  if (!faqs.length) return null
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  }
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}

export function blogJsonLd(baseUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Atai Insights",
    url: `${baseUrl}/blog`,
    description:
      "Practical knowledge, independent comparisons, business-building guides and insights from Atai.",
    publisher: { "@type": "Organization", name: "Atai", url: baseUrl },
  }
}

export function authorPersonJsonLd(author: { name: string; role?: string; bio?: string; url?: string }, baseUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: author.name,
    ...(author.role ? { jobTitle: author.role } : {}),
    ...(author.bio ? { description: author.bio } : {}),
    ...(author.url ? { url: author.url } : {}),
    worksFor: { "@type": "Organization", name: "Atai", url: baseUrl },
  }
}

export function categoryMetadata(category: BlogCategoryDoc, baseUrl: string) {
  return {
    title: category.seoTitle?.trim() || `${category.name} | Atai Blog`,
    description:
      category.seoDescription?.trim() ||
      category.description ||
      `Articles about ${category.name.toLowerCase()} from Atai.`,
    alternates: { canonical: `/blog/category/${category.slug}` },
    openGraph: {
      type: "website" as const,
      url: `${baseUrl}/blog/category/${category.slug}`,
      siteName: "Atai",
      title: category.seoTitle?.trim() || `${category.name} | Atai Blog`,
      description: category.description,
    },
  }
}