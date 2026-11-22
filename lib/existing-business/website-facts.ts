import "server-only"
import { assertPublicHttpUrl } from "@/lib/runtime/router/adapters/shared/ssrf"
import { crawlWebsite, normalizeUrl } from "@/lib/integrations/firecrawl/service"
import { auditWebsiteEvidence } from "@/lib/marketing/seo/auditor"
import type { WebsiteEvidence } from "@/lib/integrations/firecrawl/types"
import type { IntakeWebsiteReading } from "@/lib/types/business-intake"
import type { SeoFinding } from "@/lib/types/db"

/**
 * Website intelligence for an EXISTING business.
 *
 * This reuses the platform's real scraping and SEO machinery but stops at
 * evidence: nothing here generates a plan, clones a site, or starts a build.
 * A founder's live website is a source of business intelligence, not an
 * instruction to rebuild it.
 *
 * Cost control: screenshots are off (they cost ImageKit storage and were never
 * needed for reading a business), and the crawl stays within the existing
 * ≤7-page/20k-char budget. The 7-day `firecrawl_cache` means a retry does not
 * re-spend.
 */

export const INTAKE_MAX_PAGES = 6
/** How much of the read we keep for the founder to inspect. Enough to judge the
 * reading, far short of mirroring the site into our database. */
export const READING_PAGE_LIMIT = 8
export const READING_EXCERPT_CHARS = 1_600
/** Page text carried into the co-founder's evidence block. Headings alone told
 * the model what a page was titled, never what the business actually says. */
export const DIGEST_PAGE_TEXT_CHARS = 1_600
export const DIGEST_TEXT_BUDGET = 8_000

const SOCIAL_HOSTS: Array<[string, string]> = [
  ["facebook.com", "Facebook"],
  ["instagram.com", "Instagram"],
  ["x.com", "X"],
  ["twitter.com", "X"],
  ["linkedin.com", "LinkedIn"],
  ["youtube.com", "YouTube"],
  ["tiktok.com", "TikTok"],
  ["pinterest.com", "Pinterest"],
  ["wa.me", "WhatsApp"],
  ["t.me", "Telegram"],
]

export interface WebsiteFacts {
  submittedUrl: string
  /** The address the site actually served, after redirects. */
  normalizedUrl: string
  hostname: string
  /** The address the founder typed, when it redirected somewhere else. */
  redirectedFrom?: string
  title?: string
  description?: string
  pages: Array<{ url: string; title?: string; headings: string[]; text?: string }>
  navigation: string[]
  /** External presences we could actually see in the links. */
  socialLinks: string[]
  /** mailto:/tel: links found in page markdown. */
  contactHints: string[]
  /** Deterministic on-page checks — observed values, never estimates. */
  seoFindings: Array<{ label: string; status: SeoFinding["status"]; observed?: string }>
  pagesCrawled: number
  fromCache: boolean
}

export interface WebsiteFactsFailure {
  code: string
  message: string
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ""
  }
}

/**
 * Crawl markdown is written for a renderer, not a reader: every navigation item
 * arrives as `[Label](https://site/page)`, every image as `![alt](url)`. Turn it
 * into the prose a person would have read, so an excerpt is worth showing and
 * the evidence block is worth reasoning from.
 */
export function toReadableText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/`{1,3}/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function collectContactHints(evidence: WebsiteEvidence): string[] {
  const hints = new Set<string>()
  for (const page of evidence.pages) {
    const markdown = page.markdown ?? ""
    for (const match of markdown.matchAll(/\((mailto:[^)\s]+|tel:[^)\s]+)\)/gi)) {
      const value = match[1]
      if (value) hints.add(value.trim())
    }
    if (hints.size >= 8) break
  }
  return [...hints].slice(0, 8)
}

function collectSocialLinks(evidence: WebsiteEvidence): string[] {
  const found = new Set<string>()
  for (const page of evidence.pages) {
    for (const link of page.links ?? []) {
      const host = hostnameOf(link)
      if (!host) continue
      for (const [socialHost, label] of SOCIAL_HOSTS) {
        if (host === socialHost || host.endsWith(`.${socialHost}`)) found.add(label)
      }
    }
  }
  return [...found]
}

/**
 * Gather bounded, observed facts about a live website. Never throws away the
 * founder's initialization: a failure returns a code + message and the caller
 * continues with the description they supplied.
 */
export async function collectWebsiteFacts(
  rawUrl: string,
  options: { maxPages?: number } = {},
): Promise<{ facts: WebsiteFacts; evidence: WebsiteEvidence } | { failure: WebsiteFactsFailure }> {
  let normalized: string
  try {
    normalized = normalizeUrl(rawUrl)
  } catch {
    return { failure: { code: "URL_INVALID", message: "That does not look like a website address." } }
  }

  // The crawl path does not carry this guard of its own — verification and
  // intake both add it here rather than trusting the provider's network.
  try {
    assertPublicHttpUrl(normalized)
  } catch {
    return {
      failure: {
        code: "URL_NOT_PUBLIC",
        message: "We can only read a publicly reachable website address.",
      },
    }
  }

  try {
    const evidence = await crawlWebsite(normalized, {
      maxPages: options.maxPages ?? INTAKE_MAX_PAGES,
      includeScreenshots: false,
      // Navigation and footers are the same on every page; the founder's read
      // is about what each page says.
      mainContentOnly: true,
    })

    // The site may answer on a different host than the address typed (a
    // preview URL redirecting to the live domain). Everything below is about
    // the site that actually answered, and the founder is told when the two
    // differ.
    const servedUrl = evidence.finalUrl || evidence.sourceUrl || normalized
    const submittedHost = hostnameOf(normalized)
    const servedHost = hostnameOf(servedUrl)

    const audit = auditWebsiteEvidence(evidence)
    return {
      evidence,
      facts: {
        submittedUrl: rawUrl.trim(),
        normalizedUrl: servedUrl,
        hostname: servedHost,
        ...(servedHost && submittedHost && servedHost !== submittedHost
          ? { redirectedFrom: normalized }
          : {}),
        ...(evidence.title ? { title: evidence.title } : {}),
        ...(evidence.description ? { description: evidence.description } : {}),
        pages: (evidence.pages ?? []).slice(0, 10).map((page) => ({
          url: page.url,
          ...(page.title ? { title: page.title } : {}),
          headings: (page.headings ?? []).slice(0, 12),
          ...(page.markdown ? { text: toReadableText(page.markdown).slice(0, DIGEST_PAGE_TEXT_CHARS) } : {}),
        })),
        navigation: (evidence.navigation ?? []).slice(0, 25),
        socialLinks: collectSocialLinks(evidence),
        contactHints: collectContactHints(evidence),
        seoFindings: (audit.findings ?? [])
          .filter((finding) => finding.status !== "not_observed")
          .slice(0, 20)
          .map((finding) => ({
            label: finding.label,
            status: finding.status,
            ...(finding.observed ? { observed: String(finding.observed).slice(0, 160) } : {}),
          })),
        pagesCrawled: evidence.usage?.pagesCrawled ?? (evidence.pages ?? []).length,
        fromCache: evidence.usage?.cached === true,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Provider/network detail stays server-side; the founder gets a code and a
    // sentence they can act on.
    const notConfigured = /not configured|FIRECRAWL_API_KEY/i.test(message)
    return {
      failure: {
        code: notConfigured ? "ANALYSIS_UNAVAILABLE" : "WEBSITE_UNREACHABLE",
        message: notConfigured
          ? "Website analysis is not available right now. Your business description is still enough to continue."
          : "We couldn't read that website. You can still continue — we'll work from what you told us.",
      },
    }
  }
}

/**
 * A bounded copy of the read: the opening of each page, and the exact evidence
 * block the co-founder is given. Built from the same `facts` the assessment
 * uses, so the founder sees what the model saw rather than a retelling.
 */
export function buildReadingSnapshot(facts: WebsiteFacts, evidence?: WebsiteEvidence): IntakeWebsiteReading {
  const textByUrl = new Map((evidence?.pages ?? []).map((page) => [page.url, page.markdown ?? ""]))
  const pages = facts.pages.slice(0, READING_PAGE_LIMIT).map((page) => {
    // Prefer the fuller text from the crawl; fall back to the bounded copy in
    // the facts (the cache-hit path, where evidence is absent).
    const source = textByUrl.get(page.url) ?? page.text ?? ""
    const text = toReadableText(source)
    return {
      url: page.url,
      ...(page.title ? { title: page.title } : {}),
      headings: page.headings.slice(0, 12),
      excerpt: text.slice(0, READING_EXCERPT_CHARS),
      chars: text.length,
    }
  })
  return {
    capturedAt: Date.now(),
    digest: buildWebsiteDigest(facts),
    pages,
    pagesRead: facts.pagesCrawled,
    charsRead: pages.reduce((total, page) => total + page.chars, 0),
    finalUrl: facts.normalizedUrl,
    ...(facts.redirectedFrom ? { redirectedFrom: facts.redirectedFrom } : {}),
  }
}

/**
 * Bounded digest of the observed facts for the assessment prompt. Website text
 * is fenced as untrusted data by the caller — never paste these strings into a
 * prompt unwrapped.
 */
export function buildWebsiteDigest(facts: WebsiteFacts, maxChars = 12_000): string {
  const lines: string[] = []
  lines.push(`URL: ${facts.normalizedUrl}`)
  lines.push(`Hostname: ${facts.hostname}`)
  if (facts.redirectedFrom) lines.push(`Requested address (redirects to the URL above): ${facts.redirectedFrom}`)
  if (facts.title) lines.push(`Document title: ${facts.title}`)
  if (facts.description) lines.push(`Meta description: ${facts.description}`)
  lines.push(`Pages read: ${facts.pagesCrawled}`)
  if (facts.navigation.length) lines.push(`Navigation labels: ${facts.navigation.join(" | ")}`)
  if (facts.socialLinks.length) lines.push(`Social profiles linked: ${facts.socialLinks.join(", ")}`)
  if (facts.contactHints.length) lines.push(`Contact links found: ${facts.contactHints.join(", ")}`)
  let textBudget = DIGEST_TEXT_BUDGET
  for (const page of facts.pages) {
    lines.push(`\nPAGE: ${page.url}${page.title ? ` — ${page.title}` : ""}`)
    if (page.headings.length) lines.push(`Headings: ${page.headings.join(" / ")}`)
    if (page.text && textBudget > 0) {
      const take = Math.min(DIGEST_PAGE_TEXT_CHARS, textBudget)
      lines.push(`Text: ${page.text.slice(0, take)}${page.text.length > take ? " …" : ""}`)
      textBudget -= Math.min(take, page.text.length)
    }
  }
  if (facts.seoFindings.length) {
    lines.push("\nON-PAGE CHECKS (observed, deterministic):")
    for (const finding of facts.seoFindings) {
      lines.push(`- ${finding.label}: ${finding.status}${finding.observed ? ` (observed: ${finding.observed})` : ""}`)
    }
  }
  const text = lines.join("\n")
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[digest truncated]` : text
}
