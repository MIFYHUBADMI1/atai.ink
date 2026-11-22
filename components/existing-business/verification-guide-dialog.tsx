"use client"

import { useState } from "react"
import { ArrowRight, Check, Copy, Download, ExternalLink, FileText, ShieldCheck } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { BusinessDomainMethod } from "@/lib/types/business-intake"
import { cn } from "@/lib/utils"

/**
 * The instructions a founder needs, in the order they need them. A tag or a
 * file name on its own assumes the person already knows where their site is
 * published from — the single most common reason a verification fails.
 *
 * Every long string here (file name, URL) is one unbreakable token, so each
 * wraps with `break-all` inside a `min-w-0` child. Without that the grid track
 * grows past the viewport and the dialog scrolls sideways, which is unusable on
 * a phone.
 */
export function VerificationGuideDialog({
  open,
  onOpenChange,
  hostname,
  method,
  metaSnippet,
  fileName,
  downloadHref,
  fileHref,
  onCheck,
  checking,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hostname: string
  method: BusinessDomainMethod
  metaSnippet: string | null
  fileName: string | null
  downloadHref: string
  fileHref: string
  onCheck: () => void
  checking: boolean
}) {
  const [copied, setCopied] = useState(false)
  // Challenges created before the short names still carry a 60-character file
  // name; say so instead of letting the founder wonder why the docs differ.
  const legacyLongName = Boolean(fileName && fileName.length > 40)

  async function copy() {
    if (!metaSnippet) return
    try {
      await navigator.clipboard.writeText(metaSnippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // The snippet is selectable in the dialog, so a blocked clipboard is not a dead end.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg flex-col gap-4 overflow-hidden sm:max-w-lg [&>*]:min-w-0">
        <DialogHeader className="shrink-0 pr-6">
          <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
            <ShieldCheck className="size-3.5 shrink-0" /> Verify ownership
          </p>
          <DialogTitle className="text-lg font-semibold break-words sm:text-xl">
            Prove {hostname} is yours
          </DialogTitle>
          <p className="text-sm leading-relaxed text-muted-foreground break-words">
            One tag or one file, and Atai knows the business is yours. Nothing else on your site changes, and you can
            remove it once the check passes.
          </p>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {method === "meta_tag" ? (
          <div className="flex min-w-0 flex-col gap-4">
            <ol className="flex flex-col gap-3 text-sm">
              <Step n={1} title="Open the template that renders your homepage">
                In Next.js that is <Code>app/layout.tsx</Code>; on WordPress a header plugin or <Code>header.php</Code>;
                on Squarespace or Wix the site&apos;s custom-code settings.
              </Step>
              <Step n={2} title="Paste the tag inside the head section">
                It must sit between <Code>&lt;head&gt;</Code> and <Code>&lt;/head&gt;</Code>.
              </Step>
              <Step n={3} title="Publish or redeploy, then open your homepage">
                View the page source and search for <Code>atai</Code>. If the tag is not there, the site did not
                publish.
              </Step>
              <Step n={4} title="Come back and press Check my website">
                The check reads your live homepage, not a preview.
              </Step>
            </ol>

            <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-secondary/30 p-3">
              <p className="text-xs font-medium">Your tag</p>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
                <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed">
                  {metaSnippet}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={() => void copy()} className="shrink-0">
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            <ol className="flex flex-col gap-3 text-sm">
              <Step n={1} title="Download the file">
                Keep the name exactly as it is — <Code>{fileName ?? "the downloaded file"}</Code>. A renamed file is
                not served at the address the check asks for.
              </Step>
              <Step n={2} title="Put it in the folder your site is published from">
                On Vercel or Next.js that is the <Code>public/</Code> folder, then redeploy. On WordPress, the site
                root (<Code>public_html</Code>). On plain hosting, the web root.
              </Step>
              <Step n={3} title="Open the file in your browser before checking">
                It must show a line starting <Code>atai-verification=</Code>. A &quot;page not found&quot; here means
                the file is in the wrong folder — fix that first.
              </Step>
              <Step n={4} title="Come back and press Check my website" />
            </ol>

            {legacyLongName ? (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 break-words dark:text-amber-400">
                This challenge was created before file names were shortened. Press{" "}
                <span className="font-medium">New challenge</span> on the card to get a short name like{" "}
                <Code>atai-verify-Ab3dEf9hIj2k.txt</Code> — the long one still works, it is just harder to find.
              </p>
            ) : null}

            <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-secondary/30 p-3">
              <p className="text-xs font-medium">Where does the file go?</p>
              <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <li className="break-words">
                  <span className="font-medium text-foreground">Vercel / Next.js:</span> put it in <Code>public/</Code>,
                  commit, and let the deploy finish. The repository root is not published, so a file there is
                  invisible to the check.
                </li>
                <li className="break-words">
                  <span className="font-medium text-foreground">WordPress:</span> upload it to the site root with your
                  host&apos;s file manager (not the media library).
                </li>
                <li className="break-words">
                  <span className="font-medium text-foreground">Squarespace, Wix, Shopify:</span> use the custom-file
                  or files setting so the file is served at <Code>/{fileName}</Code>.
                </li>
              </ul>
            </div>

            <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-background/60 p-3">
              <p className="text-xs font-medium">The address the check will open</p>
              <a
                href={fileHref}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-start gap-1.5 text-xs text-primary hover:underline"
              >
                <span className="min-w-0 break-all">{fileHref}</span>
                <ExternalLink className="mt-0.5 size-3 shrink-0" />
              </a>
              <div className="mt-1 flex flex-wrap gap-2">
                <a
                  href={downloadHref}
                  download={fileName ?? undefined}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-auto max-w-full whitespace-normal text-left")}
                >
                  <Download className="size-3.5 shrink-0" />
                  <span className="min-w-0 break-all">Download {fileName ?? "file"}</span>
                </a>
                <a
                  href={fileHref}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                >
                  <FileText className="size-3.5 shrink-0" />
                  Open it
                </a>
              </div>
            </div>
          </div>
        )}

        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" onClick={onCheck} disabled={checking} className="w-full gap-1.5 sm:w-auto">
            <ShieldCheck className="size-4 shrink-0" />
            Check my website
            <ArrowRight className="size-4 shrink-0" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Inline token that may be long enough to blow out a line: it wraps. */
function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-secondary px-1 break-all">{children}</code>
}

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex min-w-0 gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] font-medium text-primary">
        {n}
      </span>
      <div className="min-w-0 leading-relaxed">
        <p className="font-medium break-words">{title}</p>
        {children ? <p className="text-muted-foreground break-words">{children}</p> : null}
      </div>
    </li>
  )
}
