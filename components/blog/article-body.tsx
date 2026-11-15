import { MarkdownArticle } from "@/components/resources/markdown-article"
import { FaqSection } from "@/components/blog/faq-section"
import { extractBlogFaqs } from "@/lib/blog/content"

/** Splits a trailing FAQ section out of the markdown so it renders once as an
 * accessible accordion (and feeds FAQPage structured data) instead of twice. */
function splitFaqSection(markdown: string): { body: string; faqMarkdown: string | null } {
  const match = /^##\s+(?:frequently asked questions|faq)\s*$/im.exec(markdown)
  if (!match) return { body: markdown, faqMarkdown: null }
  const rest = markdown.slice(match.index + match[0].length)
  const nextHeading = rest.search(/^##\s+/m)
  const faqMarkdown = nextHeading === -1 ? rest : rest.slice(0, nextHeading)
  const tail = nextHeading === -1 ? "" : rest.slice(nextHeading)
  return { body: `${markdown.slice(0, match.index)}${tail}`.trim(), faqMarkdown }
}

export function ArticleBody({ markdown }: { markdown: string }) {
  const { body, faqMarkdown } = splitFaqSection(markdown)
  const faqs = faqMarkdown ? extractBlogFaqs(`## Frequently asked questions\n${faqMarkdown}`) : []
  return (
    <>
      <MarkdownArticle markdown={body} className="doc-body" />
      {faqs.length ? <FaqSection faqs={faqs} /> : null}
    </>
  )
}