"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { IntakeWebsiteReading } from "@/lib/types/business-intake"

/**
 * What Atai actually read from the founder's site, plus the one control that
 * asks for a fresh read. The read runs the existing intake pipeline through a
 * business-addressed route, so the founder never handles the anchor project id.
 */
export function SiteReadingCard({
  businessId,
  reading,
  hostname,
  verified,
}: {
  businessId: string
  reading: IntakeWebsiteReading | null
  hostname: string | null
  verified: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function reread() {
    setBusy(true)
    try {
      const response = await fetch(`/api/businesses/${businessId}/read`, {
        method: "POST",
        headers: { accept: "application/json" },
      })
      const body = (await response.json().catch(() => null)) as
        | { data?: { started?: boolean; message?: string }; error?: { message?: string } }
        | null
      if (!response.ok) {
        toast.error(body?.error?.message ?? "The read could not start.")
        return
      }
      if (body?.data?.started === false) {
        toast.message(body.data.message ?? "A read is already running.")
      } else {
        toast.success("Reading your site again. This page will update when it finishes.")
      }
      router.refresh()
    } catch {
      toast.error("The read could not start.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">What Atai read</p>
          <h2 className="mt-1 break-all text-lg font-semibold">{hostname ?? "Your site"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {verified ? "Address verified." : "Address not proved yet — the read still describes what is public."}
            {reading ? ` ${reading.pages.length} page${reading.pages.length === 1 ? "" : "s"} captured.` : ""}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={reread} disabled={busy}>
          {busy ? "Starting…" : "Read again"}
        </Button>
      </div>

      {reading ? (
        <div className="mt-4 flex flex-col gap-3">
          {reading.redirectedFrom ? (
            <p className="text-xs text-muted-foreground">
              {reading.redirectedFrom} redirects to {reading.finalUrl ?? hostname}.
            </p>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {reading.pages.slice(0, 6).map((page) => (
              <li key={page.url} className="min-w-0 text-sm">
                <span className="font-medium">{page.title ?? page.url}</span>
                {page.headings.length ? (
                  <span className="text-muted-foreground"> — {page.headings.slice(0, 3).join(" · ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">See the full reading</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-xs">
              {reading.digest}
            </pre>
          </details>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No reading is stored yet. Read the site to give the co-founder something real to work from.
        </p>
      )}
    </section>
  )
}
