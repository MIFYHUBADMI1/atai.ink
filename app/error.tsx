"use client"

import { ErrorBoundaryView } from "@/components/error-boundary-view"

/**
 * Catches anything thrown below the root layout.
 *
 * Without this file, a render error in any route segment fell through to Next's
 * built-in global error page, which replaces the whole app. This boundary keeps
 * the failure inside the page it belongs to.
 */
export default function AppError({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
      <ErrorBoundaryView scope="app" error={error} retry={retry ?? reload} />
    </main>
  )
}

function reload() {
  if (typeof window !== "undefined") window.location.reload()
}
