/** Normalized website evidence produced by the Firecrawl service. This is the
 * ONLY shape the rest of Atai consumes — raw Firecrawl responses never
 * leak past this module (spec section 40). */
export interface FirecrawlPageEvidence {
  url: string
  title?: string
  description?: string
  markdown?: string
  headings: string[]
  links: string[]
  images: string[]
  screenshot?: string
  metadata?: Record<string, unknown>
}

export interface WebsiteEvidence {
  /** The address that was asked for. */
  sourceUrl: string
  /** The address the site actually served, after redirects. Present when the
   * provider reports it; equal to `sourceUrl` when there was no redirect. */
  finalUrl?: string
  title?: string
  description?: string
  pages: FirecrawlPageEvidence[]
  navigation: string[]
  assets: string[]
  screenshots: string[]
  metadata: Record<string, unknown>
  usage: {
    pagesCrawled: number
    creditsEstimated: number
    cached: boolean
  }
  collectedAt: number
}

export interface FirecrawlOptions {
  maxPages?: number
  includeScreenshots?: boolean
  timeoutMs?: number
  /** Drop navigation, footers and sidebars from the markdown. Off by default
   * because the SEO auditor wants the whole document; the business read turns
   * it on so the founder (and the model) get the page's actual content. */
  mainContentOnly?: boolean
}
