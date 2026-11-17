import { MarkdownArticle } from "@/components/resources/markdown-article"
import { FaqSection } from "@/components/blog/faq-section"
import { extractBlogFaqs, splitFaqSection } from "@/lib/blog/content"

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
