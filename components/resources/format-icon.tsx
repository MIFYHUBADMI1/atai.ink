import {
  BookOpen,
  FileDown,
  FileText,
  Film,
  Image as ImageIcon,
  Link2,
  Route,
} from "lucide-react"
import type { ResourceFormat } from "@/lib/resources/types"
import { cn } from "@/lib/utils"

const ICONS = {
  article: FileText,
  tutorial: BookOpen,
  roadmap: Route,
  document: FileDown,
  image: ImageIcon,
  video: Film,
  link: Link2,
} as const

export function ResourceFormatIcon({
  format,
  className,
}: {
  format: ResourceFormat
  className?: string
}) {
  const Icon = ICONS[format]
  return <Icon className={cn("size-4", className)} aria-hidden />
}
