"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { BookOpen, Download, Loader2, Terminal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/connected-business/page-ui"
import { postJson } from "@/lib/client/api"

interface GuideResponse {
  markdown: string
  keyPrefix?: string
}

/**
 * Onboarding for the SDK, written for the founder's coding agent.
 *
 * The brief is generated with a fresh, analytics-scoped runtime key inside it,
 * so it is a file to hand over — not a page to read. The steps here mirror the
 * brief's own order on purpose: a founder who follows the card and an agent who
 * follows the file must end up in the same place.
 */
export function SdkSetupCard({ businessId }: { businessId: string }) {
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const data = await postJson<GuideResponse>(`/api/businesses/${businessId}/integration-guide`)
      const blob = new Blob([data.markdown], { type: "text/markdown" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "atai-sdk-brief.md"
      link.click()
      URL.revokeObjectURL(url)
      toast.success("Brief downloaded — hand it to your coding agent.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the brief. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      icon={Terminal}
      title="Install the SDK with your coding agent"
      description="One file, written for an AI coding agent, that installs the Atai SDK in your application and wires the tracking Atai needs to advise you. It carries a runtime key for this business, shown once."
      actions={
        <Button type="button" onClick={download} disabled={busy}>
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : <Download className="mr-2 size-4" aria-hidden />}
          {busy ? "Building the brief…" : "Download the brief"}
        </Button>
      }
    >
      <ol className="flex flex-col gap-4">
        <Step index={1} title="Install the package">
          <p className="text-sm leading-6 text-muted-foreground">
            On your server, <code className="break-all">npm install @atai-group/sdk</code> — Node 18 or newer. Types
            ship with the package.
          </p>
        </Step>
        <Step index={2} title="Give the brief to your agent">
          <p className="text-sm leading-6 text-muted-foreground">
            Download it, then say <em>“follow this brief”</em>. It names every file, command and field, so the agent
            does not invent an integration of its own.
          </p>
        </Step>
        <Step index={3} title="Add the page measurement">
          <p className="text-sm leading-6 text-muted-foreground">
            The browser snippet from <strong>Measure your site</strong> above covers page views, journeys and clicks.
            The brief covers the events your server should send.
          </p>
        </Step>
        <Step index={4} title="Check it arrived">
          <p className="text-sm leading-6 text-muted-foreground">
            The first authenticated call proves the connection; events appear on Growth within a minute.
          </p>
        </Step>
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-4 text-xs text-muted-foreground">
        <Link
          href="/sdk"
          className="inline-flex items-center gap-1.5 font-medium text-primary underline underline-offset-2"
        >
          <BookOpen className="size-3.5" aria-hidden />
          SDK & API reference
        </Link>
        <span>The brief is regenerated each time you download it; the key inside is revoked when you download again.</span>
      </div>
    </SectionCard>
  )
}

function Step({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <li className="flex min-w-0 gap-3">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
        {index}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  )
}
