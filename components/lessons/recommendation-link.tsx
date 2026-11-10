"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { trackRecommendationAccepted } from "@/lib/lessons/analytics"

/** A recommended-next-step link that reports acceptance when followed. */
export function RecommendationLink({
  href,
  className,
  target,
  children,
}: {
  href: string
  className?: string
  target: "path" | "lesson"
  children: ReactNode
}) {
  return (
    <Link href={href} className={className} onClick={() => trackRecommendationAccepted("project_lessons", target)}>
      {children}
    </Link>
  )
}
