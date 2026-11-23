"use client"

import Link from "next/link"
import useSWR from "swr"
import {
  Loader2, AlertTriangle, Shield, Coins, DollarSign, TrendingUp,
  RefreshCw, Package, CreditCard, ShoppingCart, CheckCircle2,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { jsonFetcher } from "@/lib/client/api"
import { AdminNav } from "@/components/admin-nav"
import { CatalogSourceBanner } from "@/components/admin/catalog-source-banner"
import type { AdminCatalogSourceView } from "@/lib/billing/catalog/admin-source-types"

interface BillingOverview {
  payments: {
    total: number
    successful: number
    failed: number
  }
  credits: {
    totalHeld: number
    totalSubscriptionCredits: number
    totalPermanentCredits: number
    totalGranted: number
    totalCharged: number
  }
  revenue: {
    total: number
    currency: string
  }
}

interface BillingConfig {
  catalogSource?: AdminCatalogSourceView
  permanentCreditPacks: {
    id: string
    credits: number
    priceUSD: number
    pricePerCredit: number
    label: string
    popular: boolean
    saleMode?: string
    dodoProductId?: string
  }[]
  conversionRate: {
    AtaiCreditsPerBaselineUnit: number
  }
}

export default function AdminCreditPacksPage() {
  const { data: config, isLoading: configLoading } = useSWR<BillingConfig>(
    "/api/admin/billing/configuration",
    jsonFetcher,
    { refreshInterval: 60000 },
  )

  const { data: overview, isLoading: overviewLoading, mutate } = useSWR<BillingOverview>(
    "/api/admin/billing/overview",
    jsonFetcher,
    { refreshInterval: 30000 },
  )

  if (configLoading || overviewLoading) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AdminNav />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Admin</p>
              <Badge variant="secondary" className="gap-1 text-xs">
                <Shield className="size-3" />
                Billing
              </Badge>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Credit Packs</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only view of the active catalog. Edit credit-pack products and Dodo mappings in Catalog
              authoring.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => mutate()} className="gap-1.5">
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </header>

        <CatalogSourceBanner source={config?.catalogSource} />

        {/* ── Permanent Credit Packages (Dodo) ── */}
        <section className="mt-8">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">Permanent Credit Packages</p>
          <p className="text-sm text-muted-foreground mb-4">
            Customer-facing permanent credit packages for purchase via Dodo Payments.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {config?.permanentCreditPacks.map((pkg) => {
              return (
                <Card key={pkg.id} className={pkg.popular ? "border-primary/30" : ""}>
                  <CardContent className="py-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-lg font-semibold">{pkg.label}</p>
                          {pkg.popular && (
                            <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                              Popular
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-2xl font-bold text-primary">
                          ${pkg.priceUSD.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">USD</span>
                        </p>
                      </div>
                      <Badge variant={pkg.saleMode === "self_serve" ? "default" : "outline"} className="capitalize">
                        {pkg.saleMode ?? "self_serve"}
                      </Badge>
                    </div>

                    <div className="mt-4 space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <Coins className="size-3" />
                          Credits
                        </span>
                        <span className="font-mono font-semibold">{pkg.credits.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <DollarSign className="size-3" />
                          Price per Credit
                        </span>
                        <span className="font-mono">{pkg.credits > 0 ? `$${pkg.pricePerCredit.toFixed(4)}` : "—"}</span>
                      </div>
                    </div>


                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>

        {/* ── Dodo Mappings ── */}
        <section className="mt-10">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">Dodo Product Mappings</p>
          <Card>
            <CardContent className="py-5">
              <p className="text-sm text-muted-foreground mb-4">
                Checkout uses the Dodo product attached to the active catalog version. Change an id by
                publishing a new version in Catalog authoring; direct Dodo edits do not update the catalog.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 text-xs font-mono uppercase text-muted-foreground">Pack</th>
                      <th className="text-left py-2 text-xs font-mono uppercase text-muted-foreground">Sale mode</th>
                      <th className="text-left py-2 text-xs font-mono uppercase text-muted-foreground">Dodo product id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {config?.permanentCreditPacks.map((pack) => (
                      <tr key={pack.id} className="border-b border-border last:border-0">
                        <td className="py-3 font-medium">{pack.label}</td>
                        <td className="py-3 text-xs capitalize">{pack.saleMode ?? "self_serve"}</td>
                        <td className="py-3 font-mono text-xs text-muted-foreground">
                          {pack.dodoProductId || "Not configured"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── Credit Economy Overview ── */}
        <section className="mt-10">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">Credit Economy</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="py-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Credits Held</p>
                    <p className="mt-2 text-2xl font-semibold text-primary">{(overview?.credits.totalHeld ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-primary/10 p-2"><Coins className="size-4 text-primary" /></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Granted</p>
                    <p className="mt-2 text-2xl font-semibold text-green-500">+{(overview?.credits.totalGranted ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-green-500/10 p-2"><CreditCard className="size-4 text-green-500" /></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Charged</p>
                    <p className="mt-2 text-2xl font-semibold text-red-500">-{(overview?.credits.totalCharged ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-red-500/10 p-2"><CreditCard className="size-4 text-red-500" /></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">            Total Revenue
          </p>
            <p className="mt-2 text-2xl font-semibold text-green-500">${(overview?.revenue.total ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-green-500/10 p-2"><DollarSign className="size-4 text-green-500" /></div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  )
}
