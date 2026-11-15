"use client"

import { useEffect } from "react"

/** Records one real view per article per browser session. Refreshes and
 * back-navigation don't inflate the count; the server also validates that the
 * slug exists before counting. */
export function ViewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    const key = `atai-blog-viewed:${slug}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, "1")
    } catch {
      // Private mode etc. — still record once per mount.
    }
    // The beacon is deliberately not aborted on unmount: a reader who clicks
    // through to the next article would otherwise cancel the request before
    // the server counted the view. `keepalive` lets it survive the unload.
    fetch("/api/blog/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
      keepalive: true,
    }).catch(() => undefined)
  }, [slug])
  return null
}