"use client"

import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { jsonFetcher, postJson } from "@/lib/client/api"
import { AD_ESTIMATE_DISCLAIMER } from "@/lib/marketing/ads/request-shared"

type Pkg = {
  id: string
  name: string
  description: string
  durationDays: number
  creditsPrice: number
  estimatedImpressionsMin: number
  estimatedImpressionsMax: number
  channels: string[]
  active: boolean
}

export default function AdminAdsPackagesPage() {
  const { data, mutate } = useSWR<{ packages: Pkg[] }>("/api/admin/ads/packages", jsonFetcher)
  const [form, setForm] = useState({
    name: "",
    description: "",
    durationDays: 7,
    creditsPrice: 4000,
    estimatedImpressionsMin: 3000,
    estimatedImpressionsMax: 10000,
    channels: "Instagram, Facebook",
  })
  const [error, setError] = useState<string | null>(null)

  async function save(pkg?: Pkg) {
    setError(null)
    try {
      await postJson("/api/admin/ads/packages", pkg ?? {
        ...form,
        channels: form.channels.split(",").map((s) => s.trim()).filter(Boolean),
      })
      await mutate()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.")
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <Link href="/admin/ads" className="text-sm text-muted-foreground hover:text-foreground">
        ← Advertising inbox
      </Link>
      <h2 className="mt-3 text-2xl font-semibold">Promotional packages</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Prices are in Atai Credits and are controlled here. {AD_ESTIMATE_DISCLAIMER}
      </p>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-6 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Package name" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input type="number" value={form.creditsPrice} onChange={(e) => setForm({ ...form, creditsPrice: Number(e.target.value) })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input type="number" value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value) })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input value={form.channels} onChange={(e) => setForm({ ...form, channels: e.target.value })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input type="number" value={form.estimatedImpressionsMin} onChange={(e) => setForm({ ...form, estimatedImpressionsMin: Number(e.target.value) })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input type="number" value={form.estimatedImpressionsMax} onChange={(e) => setForm({ ...form, estimatedImpressionsMax: Number(e.target.value) })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <button type="button" onClick={() => void save()} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground sm:col-span-2">
          Create package
        </button>
      </div>

      <ul className="mt-6 space-y-3">
        {(data?.packages ?? []).map((pkg) => (
          <li key={pkg.id} className="rounded-2xl border border-border bg-card p-4">
            <p className="font-medium">{pkg.name}</p>
            <p className="text-sm text-muted-foreground">
              {pkg.creditsPrice.toLocaleString()} credits · {pkg.durationDays} days · est. {pkg.estimatedImpressionsMin.toLocaleString()}–{pkg.estimatedImpressionsMax.toLocaleString()} impressions
            </p>
            <button
              type="button"
              onClick={() => void save({ ...pkg, active: !pkg.active })}
              className="mt-2 text-xs text-primary hover:underline"
            >
              {pkg.active ? "Deactivate" : "Activate"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
