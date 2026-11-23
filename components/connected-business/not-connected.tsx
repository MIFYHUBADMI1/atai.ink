import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

/**
 * A business with no connected site has no anchor, so the engines have nothing
 * to read. This says so plainly and offers the one action that changes it.
 */
export function NotConnected({ businessId, what }: { businessId: string; what: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Not connected yet</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Connect the site to unlock {what}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Atai needs one verified address to read the business. Nothing about your code, database or hosting is
          touched.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/new/existing" className={buttonVariants()}>
          Connect an existing business
        </Link>
        <Link href={`/business/${businessId}/applications`} className={buttonVariants({ variant: "outline" })}>
          See applications
        </Link>
      </div>
    </div>
  )
}
