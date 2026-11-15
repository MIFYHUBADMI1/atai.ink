"use client"

import { useRef } from "react"
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Table,
  Image as ImageIcon,
  Minus,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Tool = {
  label: string
  icon: typeof Bold
  prefix: string
  suffix?: string
  block?: boolean
  placeholder?: string
}

const TOOLS: Tool[] = [
  { label: "Heading 2", icon: Heading2, prefix: "## ", block: true, placeholder: "Section title" },
  { label: "Heading 3", icon: Heading3, prefix: "### ", block: true, placeholder: "Subsection title" },
  { label: "Bold", icon: Bold, prefix: "**", suffix: "**", placeholder: "bold text" },
  { label: "Italic", icon: Italic, prefix: "_", suffix: "_", placeholder: "italic text" },
  { label: "Bullet list", icon: List, prefix: "- ", block: true, placeholder: "List item" },
  { label: "Numbered list", icon: ListOrdered, prefix: "1. ", block: true, placeholder: "List item" },
  { label: "Quote", icon: Quote, prefix: "> ", block: true, placeholder: "Callout text" },
  { label: "Code block", icon: Code, prefix: "```\n", suffix: "\n```", placeholder: "code" },
  { label: "Link", icon: LinkIcon, prefix: "[", suffix: "](https://)", placeholder: "link text" },
  { label: "Image", icon: ImageIcon, prefix: "![", suffix: "](https://)", placeholder: "alt text" },
  {
    label: "Table",
    icon: Table,
    prefix: "| Dimension | Atai | Other |\n|---|---|---|\n| ",
    suffix: " | | |",
    placeholder: "Dimension",
  },
  { label: "Divider", icon: Minus, prefix: "\n---\n", block: true },
]

export function MarkdownToolbar({
  value,
  onChange,
  textareaRef,
}: {
  value: string
  onChange: (next: string) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  function apply(tool: Tool) {
    const area = textareaRef.current ?? areaRef.current
    if (!area) return
    const start = area.selectionStart ?? value.length
    const end = area.selectionEnd ?? value.length
    const selected = value.slice(start, end) || tool.placeholder || ""
    const inserted = `${tool.prefix}${selected}${tool.suffix ?? ""}`
    const next = `${value.slice(0, start)}${inserted}${value.slice(end)}`
    onChange(next)
    // Restore the caret after the inserted text so typing continues naturally.
    requestAnimationFrame(() => {
      const caret = start + tool.prefix.length + selected.length
      area.focus()
      area.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className="flex flex-wrap gap-1 border-b border-border bg-muted/30 p-2" role="toolbar" aria-label="Formatting">
      {TOOLS.map((tool) => {
        const Icon = tool.icon
        return (
          <button
            key={tool.label}
            type="button"
            title={tool.label}
            aria-label={tool.label}
            onClick={() => apply(tool)}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
          </button>
        )
      })}
    </div>
  )
}
