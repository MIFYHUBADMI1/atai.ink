import { redirect } from "next/navigation"
import { AlertTriangle, Boxes, Database, ShieldCheck } from "lucide-react"
import { AdminNav } from "@/components/admin-nav"
import { Badge } from "@/components/ui/badge"
import { CatalogManager } from "@/components/admin/catalog-manager"
import { requireAdmin } from "@/lib/auth/session"
import { listCatalogProducts } from "@/lib/billing/catalog/service"
import type { CatalogProductView } from "@/lib/billing/catalog/types"

export const dynamic = "force-dynamic"

export default async function AdminCommercialCatalogPage() {
  try {
    await requireAdmin()
  } catch {
    redirect("/dashboard")
  }

  let products: CatalogProductView[] = []
  let loadError: string | null = null
  try {
    products = await listCatalogProducts()
  } catch {
    loadError = "The catalog database could not be read. No commercial values were changed."
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <AdminNav />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <Boxes className="size-3.5" /> Commercial catalog
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Catalog authoring</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Create products, edit drafts, publish validated versions and archive identities. Published
            versions are immutable. Checkout, webhooks, entitlements and credit grants still use the code
            catalog in A7.2.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            <Database className="mr-1 size-3" /> {products.length} products
          </Badge>
          <Badge variant="secondary">Checkout: code catalog</Badge>
        </div>
      </header>

      <div className="mt-5 flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        <p>
          Publishing writes an immutable <strong>candidate</strong> publication snapshot. It does not
          activate the catalog, enable database customer reads, change Dodo products, or alter existing
          subscriptions and payments.
        </p>
      </div>

      {loadError ? (
        <div className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {loadError}
        </div>
      ) : null}

      <CatalogManager initialProducts={products} />
    </div>
  )
}
