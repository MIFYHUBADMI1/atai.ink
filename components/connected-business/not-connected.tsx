import Link from "next/link"
import { Globe } from "lucide-react"

import { EmptyPanel } from "@/components/connected-business/page-ui"
import { buttonVariants } from "@/components/ui/button"

/**
 * A business with no connected site has no anchor, so the engines have nothing
 * to read. This says so plainly and offers the one action that changes it.
 */
export function NotConnected({ businessId, what }: { businessId: string; what: string }) {
  return (
    <EmptyPanel
      icon={Globe}
      title={`Connect the site to unlock ${what}`}
      description="Atai needs one verified address to read the business. Nothing about your code, database or hosting is touched."
      action={
        <>
          <Link href="/new/existing" className={buttonVariants()}>
            Connect an existing business
          </Link>
          <Link href={`/business/${businessId}/applications`} className={buttonVariants({ variant: "outline" })}>
            See applications
          </Link>
        </>
      }
    />
  )
}
