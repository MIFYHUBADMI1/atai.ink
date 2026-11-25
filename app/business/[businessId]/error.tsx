"use client"

import { ErrorBoundaryView } from "@/components/error-boundary-view"

/**
 * Page-level boundary for the business workspace.
 *
 * It sits beside `page.tsx`, so it catches errors from the page and the client
 * components below it — but not from `layout.tsx`. That is why
 * `app/business/error.tsx` exists as well.
 */
export default function BusinessPageError({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <ErrorBoundaryView scope="page" error={error} retry={retry ?? reload} />
  )
}

function reload() {
  if (typeof window !== "undefined") window.location.reload()
}
