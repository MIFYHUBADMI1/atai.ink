"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { FileText, RefreshCw, ScanText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Chip, SectionCard } from "@/components/connected-business/page-ui"
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
      const response = await fetch(`/api/businesses/${businessId}/intake`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ action: "reassess" }),
      })
      const body = (await response.json().catch(() => null)) as
        | { data?: { started?: boolean }; error?: { message?: string } }
        | null
      if (!response.ok) {
        toast.error(body?.error?.message ?? "The read could not start.")
        return
      }
      if (body?.data?.started === false) {
        toast.message("A read is already running — this page updates when it finishes.")
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

  const pages = reading?.pages ?? []

  return (
    <SectionCard
      icon={ScanText}
      title={hostname ?? "Your site"}
      description={
        verified
          ? "Address proved. This is the copy Atai read from it."
          : "Address not proved yet — the read still describes what is public."
      }
      actions={
        <>
          {pages.length > 0 ? <Chip>{pages.length} page{pages.length === 1 ? "" : "s"}</Chip> : null}
          <Button type="button" variant="outline" size="sm" onClick={reread} disabled={busy}>
            <RefreshCw className={busy ? "mr-2 size-3.5 animate-spin" : "mr-2 size-3.5"} aria-hidden />
            {busy ? "Starting…" : "Read again"}
          </Button>
        </>
      }
    >
      {reading ? (
        <div className="flex flex-col gap-4">
          {reading.redirectedFrom ? (
            <p className="break-all text-xs text-muted-foreground">
              {reading.redirectedFrom} redirects to {reading.finalUrl ?? hostname}.
            </p>
          ) : null}

          <ul className="grid gap-2 sm:grid-cols-2">
            {pages.slice(0, 6).map((page) => (
              <li key={page.url} className="flex min-w-0 items-start gap-2 rounded-xl border border-border/70 p-3">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{page.title ?? page.url}</p>
                  {page.headings.length ? (
                    <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
                      {page.headings.slice(0, 3).join(" · ")}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              See the full reading
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/40 p-3 text-xs">
              {reading.digest}
            </pre>
          </details>
        </div>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          No reading is stored yet. Read the site to give the co-founder something real to work from.
        </p>
      )}
    </SectionCard>
  )
}
