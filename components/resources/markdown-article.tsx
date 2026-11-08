import type { ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { headingId, markdownHeadingIdsByLine } from "@/lib/resources/media"
import { cn } from "@/lib/utils"

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children)
  }
  return ""
}

export function MarkdownArticle({
  markdown,
  className,
}: {
  markdown: string
  className?: string
}) {
  const idsByLine = markdownHeadingIdsByLine(markdown)
  return (
    <div className={cn("flex min-w-0 flex-col gap-5 text-[15px] leading-7 text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children, node }) => {
            const line = node?.position?.start.line
            const id = (line !== undefined ? idsByLine.get(line) : undefined) ?? headingId(textOf(children))
            return (
              <h2 id={id} className="scroll-mt-24 pt-4 text-xl font-semibold tracking-tight">
                {children}
              </h2>
            )
          },
          h3: ({ children }) => (
            <h3 className="pt-2 text-lg font-semibold tracking-tight">{children}</h3>
          ),
          h4: ({ children }) => <h4 className="pt-1 font-semibold">{children}</h4>,
          p: ({ children }) => <p className="text-pretty">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-2 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-2 pl-5">{children}</ol>,
          li: ({ children }) => <li className="[&>p]:m-0">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noreferrer noopener" : undefined}
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="rounded-r-2xl border-l-4 border-primary/40 bg-primary/5 py-2 pl-4 text-muted-foreground">
              {children}
            </blockquote>
          ),
          code: ({ children, className: codeClassName }) => {
            const block = Boolean(codeClassName)
            return block ? (
              <code className="block overflow-x-auto rounded-xl bg-muted/60 p-4 font-mono text-xs leading-6">
                {children}
              </code>
            ) : (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
            )
          },
          pre: ({ children }) => <pre className="overflow-x-auto">{children}</pre>,
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-border/60 px-3 py-2">{children}</td>,
          hr: () => <hr className="border-border" />,
          img: ({ src, alt }) =>
            typeof src === "string" && src.startsWith("https://") ? (
              // Admin-authored content; external images stay lazy and isolated.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={alt ?? ""}
                loading="lazy"
                className="h-auto w-full rounded-2xl border border-border"
              />
            ) : null,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
