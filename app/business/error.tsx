"use client"

import { ErrorBoundaryView } from "@/components/error-boundary-view"

/**
 * Catches errors thrown by `app/business/[businessId]/layout.tsx` and the
 * client `BusinessShell`.
 *
 * A segment's `error.tsx` does not wrap its own layout, but it does wrap the
 * nested layout of its children — so this is the boundary that keeps a broken
 * shell or gate from replacing the whole app. The page-level boundary below it
 * still handles errors from `page.tsx`.
 */
export default function BusinessSegmentError({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
      <ErrorBoundaryView scope="business" error={error} retry={retry ?? reload} />
    </main>
  )
}

function reload() {
  if (typeof window !== "undefined") window.location.reload()
}
