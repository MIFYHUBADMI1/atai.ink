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
    block: true,
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
    // A block marker (heading, list item, quote, table, divider) only works at
    // the start of a line. Inserted mid-sentence it stays literal text — a
    // "## Title" glued to the end of a paragraph renders as a paragraph, and a
    // table that does not start a line never becomes a table. That is how
    // studio formatting appeared to be ignored on the public page.
    const lead = tool.block && start > 0 && value[start - 1] !== "\n" ? "\n" : ""
    const tail = tool.block && value[end] !== undefined && value[end] !== "\n" ? "\n" : ""
    const inserted = `${lead}${tool.prefix}${selected}${tool.suffix ?? ""}${tail}`
    const next = `${value.slice(0, start)}${inserted}${value.slice(end)}`
    onChange(next)
    // Restore the caret after the inserted text so typing continues naturally.
    requestAnimationFrame(() => {
      const caret = start + lead.length + tool.prefix.length + selected.length
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
