import Link from "next/link"
import { Database, ShieldAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import type { AdminCatalogSourceView } from "@/lib/billing/catalog/admin-source-types"

/**
 * Shared source banner for every admin surface that shows catalog values.
 * It makes the admin view and the customer/checkout view explicit, so a
 * database draft is never mistaken for a live price.
 */
export function CatalogSourceBanner({ source }: { source?: AdminCatalogSourceView }) {
  if (!source) return null

  const blocked = source.checkoutSource === "unavailable" || Boolean(source.error)
  const Icon = blocked ? ShieldAlert : Database
  const tone = blocked
    ? "border-destructive/30 bg-destructive/5 text-destructive"
    : source.checkoutSource === "db"
      ? "border-emerald-500/30 bg-emerald-500/5 text-foreground"
      : "border-border bg-muted/30 text-foreground"

  return (
    <div className={`mt-6 flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between ${tone}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">
              {blocked
                ? "The selected database catalog could not be read."
                : source.checkoutSource === "db"
                  ? "Checkout and customer reads use the database catalog."
                  : "Checkout and customer reads use the code catalog."}
            </p>
            <Badge variant="outline" className="text-[10px]">
              Admin: {source.adminSource === "db" ? "database" : "code"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Checkout: {source.checkoutSource === "db" ? "database" : source.checkoutSource === "unavailable" ? "unavailable" : "code"}
            </Badge>
            {source.gated ? (
              <Badge variant="secondary" className="text-[10px]">
                Public reads gated
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {source.error
              ? `Showing the code catalog so this page stays operable. Reason: ${source.error}.`
              : source.publication
                ? `Showing publication ${source.publication.version} (${source.publication.productCount} products${source.shadowDifferences > 0 ? `, ${source.shadowDifferences} code differences` : ""}).`
                : source.requestedSource === "code"
                  ? "Code catalog is selected; no database publication is consulted."
                  : "No database publication is active; the code catalog is authoritative."}
            {source.gated ? " Database changes will not reach customers until the public-read gate is enabled." : ""}
          </p>
        </div>
      </div>
      <Link
        href="/admin/billing/catalog"
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Open catalog authoring
      </Link>
    </div>
  )
}
