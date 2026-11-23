import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { AlertTriangle, Boxes, Database, Lock, ShieldCheck } from "lucide-react"
import { AdminNav } from "@/components/admin-nav"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { requireAdmin } from "@/lib/auth/session"
import { listCatalogProducts } from "@/lib/billing/catalog/service"
import type { CatalogProductType, CatalogProductView } from "@/lib/billing/catalog/types"

export const dynamic = "force-dynamic"

const SECTIONS: Array<{ type: CatalogProductType; title: string; description: string }> = [
  {
    type: "subscription",
    title: "Subscriptions",
    description: "Recurring plans, including archived legacy plans kept only for renewals.",
  },
  {
    type: "credit_pack",
    title: "Credit packages",
    description: "One-time credit purchases. A7.0 does not change how they are sold.",
  },
  {
    type: "infrastructure",
    title: "Infrastructure products",
    description: "Credit-funded hosting plans. Purchase model and renewal rules are explicit.",
  },
]

function formatMoney(currency: string, minor: number | null): string {
  if (minor === null) return "Custom"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100)
}

function creditsLabel(product: CatalogProductView): string {
  const credits = product.currentVersion?.credits
  if (product.type === "infrastructure") {
    const charge = product.currentVersion?.infrastructure?.creditCharge
    return charge === null || charge === undefined ? "Custom" : `${charge.toLocaleString()} credits`
  }
  if (!credits) return "—"
  if (credits.oneTimeGrant !== null) return `${credits.oneTimeGrant.toLocaleString()} one-time`
  if (credits.monthlyGrant === null && product.saleMode === "contact") return "Negotiated"
  if (credits.monthlyGrant !== null) {
    const annual =
      credits.annualTotalCredits === null
        ? ""
        : ` · ${credits.annualTotalCredits.toLocaleString()}/yr`
    return `${credits.monthlyGrant.toLocaleString()}/mo${annual}`
  }
  return "—"
}

function priceLabel(product: CatalogProductView): string {
  const version = product.currentVersion
  if (!version) return "—"
  if (product.type === "infrastructure") {
    return version.infrastructure?.purchaseModel === "credit_funded"
      ? "Credit-funded"
      : formatMoney(version.currency, version.priceMinor)
  }
  const monthly = formatMoney(version.currency, version.priceMinor)
  if (!version.billingIntervals.includes("annual") || version.annualPriceMinor === null) {
    return version.billingIntervals.includes("monthly") ? `${monthly}/mo` : monthly
  }
  return `${monthly}/mo · ${formatMoney(version.currency, version.annualPriceMinor)}/yr`
}

function statusBadge(product: CatalogProductView): ReactNode {
  if (product.status === "archived") return <Badge variant="outline">Archived</Badge>
  if (product.status === "draft") return <Badge variant="secondary">Draft</Badge>
  return <Badge>Published</Badge>
}

function dodoBadge(product: CatalogProductView): ReactNode {
  if (product.dodoStatus === "missing") return <Badge variant="outline">Not mapped</Badge>
  if (product.dodoStatus === "invalid") return <Badge variant="destructive">Invalid</Badge>
  if (product.dodoStatus === "valid") return <Badge>Validated</Badge>
  return <Badge variant="secondary">Unvalidated</Badge>
}

function CatalogTable({ products }: { products: CatalogProductView[] }) {
  if (products.length === 0) {
    return <p className="px-5 py-8 text-sm text-muted-foreground">No products in this category.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-5 py-3 font-medium">Product</th>
            <th className="px-5 py-3 font-medium">Type</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium">Version</th>
            <th className="px-5 py-3 text-right font-medium">Price</th>
            <th className="px-5 py-3 text-right font-medium">Credits</th>
            <th className="px-5 py-3 font-medium">Dodo</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-b border-border last:border-0">
              <td className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{product.name}</span>
                  {product.legacyRenewalOnly && (
                    <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-400">
                      Legacy renewal only
                    </Badge>
                  )}
                  {product.saleMode === "free" && <Badge variant="secondary">Free</Badge>}
                  {product.saleMode === "contact" && <Badge variant="outline">Contact</Badge>}
                </div>
                <p className="mt-1 max-w-md text-xs text-muted-foreground">{product.description}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{product.id}</p>
              </td>
              <td className="px-5 py-3 capitalize text-muted-foreground">{product.type.replace("_", " ")}</td>
              <td className="px-5 py-3">{statusBadge(product)}</td>
              <td className="px-5 py-3 font-mono text-xs">
                {product.currentVersion ? `v${product.currentVersion.version}` : "—"}
                <span className="block text-[10px] text-muted-foreground">{product.versionCount} total</span>
              </td>
              <td className="px-5 py-3 text-right font-mono text-xs">{priceLabel(product)}</td>
              <td className="px-5 py-3 text-right font-mono text-xs">{creditsLabel(product)}</td>
              <td className="px-5 py-3">
                <div className="flex flex-col gap-1">
                  {dodoBadge(product)}
                  {product.dodoMappings.map((mapping) => (
                    <span key={`${mapping.cycle}:${mapping.environment}:${mapping.dodoProductId}`} className="font-mono text-[10px] text-muted-foreground">
                      {mapping.cycle}: {mapping.dodoProductId}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

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
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Catalog foundation</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Read-only view of the database catalog seeded from today&apos;s code definitions.
            Checkout, webhooks, entitlements and credit grants still use the code catalog in A7.0.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            <Database className="mr-1 size-3" /> {products.length} products
          </Badge>
          <Badge variant="secondary">
            <Lock className="mr-1 size-3" /> Read-only
          </Badge>
        </div>
      </header>

      <div className="mt-5 flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        <p>
          Seeded versions are immutable. Dodo mappings are imported but remain <strong>unvalidated</strong> until
          A7.4 validates them against Dodo. Legacy plans are archived and never offered for new purchases.
        </p>
      </div>

      {loadError ? (
        <div className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {loadError}
        </div>
      ) : null}

      {SECTIONS.map((section) => {
        const sectionProducts = products.filter((product) => product.type === section.type)
        return (
          <Card key={section.type} className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {section.title}
                <Badge variant="outline">{sectionProducts.length}</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{section.description}</p>
            </CardHeader>
            <CardContent className="p-0">
              <CatalogTable products={sectionProducts} />
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
