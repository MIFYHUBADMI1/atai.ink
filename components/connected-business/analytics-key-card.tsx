"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Check, Copy, KeyRound, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/connected-business/page-ui"
import { postJson } from "@/lib/client/api"

/**
 * The one control a connected business needs to start measuring.
 *
 * A browser key is not a secret in the usual sense — it ships in the page — so
 * the copy here says exactly what it can do (record page views, journeys and
 * clicks) and what it cannot (call a provider, read anything, spend a credit).
 * The key is shown once, with the snippet that uses it, because a founder who
 * has to hunt for the install line does not install it.
 */
export function AnalyticsKeyCard({ businessId }: { businessId: string }) {
  const [secret, setSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const snippet = secret
    ? `<script defer src="${typeof window === "undefined" ? "" : window.location.origin}/atai-analytics.js" data-atai-key="${secret}"></script>`
    : ""

  async function create() {
    setBusy(true)
    try {
      const created = await postJson<{ key: { secret: string } }>(
        `/api/businesses/${businessId}/analytics-key`,
        {},
      )
      setSecret(created.key.secret)
      toast.success("Browser key created — copy it now, it is shown once.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the key")
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      toast.success("Snippet copied.")
    } catch {
      toast.error("Could not copy — select the line and copy it manually.")
    }
  }

  return (
    <SectionCard
      icon={KeyRound}
      title="Measure your site"
      description="Install one line and Atai can tell you which pages people reach, where they stop, and what they press. The key is limited to analytics: it cannot read, call a provider or spend a credit."
    >
      {!secret ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            Create a browser key for this business, then paste the snippet into the <code>&lt;head&gt;</code> of every
            page. Visits appear on Growth within a minute.
          </p>
          <Button type="button" onClick={create} disabled={busy} className="shrink-0">
            {busy ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                Creating…
              </>
            ) : (
              "Create browser key"
            )}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Paste this once, in the <code>&lt;head&gt;</code> of every page. It is shown only now.
          </p>
          <div className="relative min-w-0">
            <pre className="min-w-0 overflow-x-auto rounded-lg border border-border bg-background p-3 pr-12 text-xs">
              <code className="break-all">{snippet}</code>
            </pre>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={copy}
              className="absolute right-2 top-2"
              aria-label="Copy the snippet"
            >
              {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
