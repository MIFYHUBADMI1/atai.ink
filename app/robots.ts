import { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/env"

/**
 * Robots for search engines and AI crawlers.
 * Public marketing, docs, and developer pages are crawlable.
 * Authenticated product surfaces stay out of the index.
 */
export default function robots(): MetadataRoute.Robots {
  const publicAllow = [
    "/",
    "/about",
    "/founder",
    "/pricing",
    "/docs",
    "/docs/",
    "/developers",
    "/sdk",
    "/start",
    "/explore",
    "/resources",
    "/resources/",
    "/modes-comparison",
    "/feature-requests",
    "/new",
    "/terms",
    "/privacy",
    "/refund-policy",
    "/database-terms",
    "/login",
    "/register",
    "/llms.txt",
    "/llms-full.txt",
    "/resources/sitemap.xml",
    // Googlebot needs these to render pages; longest-match overrides the /_next/ disallow.
    "/_next/static/",
  ]

  const privateDisallow = [
    "/api/",
    "/admin/",
    "/settings/",
    "/account",
    "/dashboard",
    "/projects",
    "/workspace",
    "/project/",
    "/billing/",
    "/finances",
    "/hosting",
    "/ads",
    "/market",
    "/competition",
    "/lessons",
    "/developers/keys",
    "/developers/usage",
    "/developers/calcom",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
    "/confirm-email-change",
    "/_next/",
  ]

  return {
    rules: [
      {
        userAgent: "*",
        allow: publicAllow,
        disallow: privateDisallow,
      },
      {
        userAgent: [
          "GPTBot",
          "OAI-SearchBot",
          "ChatGPT-User",
          "ClaudeBot",
          "Claude-Web",
          "Claude-SearchBot",
          "anthropic-ai",
          "Applebot",
          "Applebot-Extended",
          "PerplexityBot",
          "Perplexity-User",
          "Google-Extended",
          "GoogleOther",
          "DuckAssistBot",
          "MistralAI-User",
          "Amazonbot",
          "Meta-ExternalAgent",
          "cohere-ai",
          "YouBot",
          "CCBot",
          "Bytespider",
        ],
        allow: publicAllow,
        disallow: privateDisallow,
      },
    ],
    sitemap: [
      `${SITE_URL}/sitemap.xml`,
      `${SITE_URL}/seo/sitemap.xml`,
      `${SITE_URL}/resources/sitemap.xml`,
    ],
    host: SITE_URL,
  }
}
