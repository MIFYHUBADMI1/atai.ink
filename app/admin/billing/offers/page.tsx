"use client"

import Link from "next/link"
import useSWR from "swr"
import { useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Megaphone,
  Pause,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Zap,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AdminNav } from "@/components/admin-nav"
import { deleteJson, jsonFetcher, postJson } from "@/lib/client/api"
import type { PromotionalOffer } from "@/lib/billing/offers"
import type { CatalogProductView } from "@/lib/billing/catalog/types"

interface OfferForm {
  id: string
  name: string
  description: string
  status: PromotionalOffer["status"]
  target: PromotionalOffer["target"]
  productIds: string[]
  bonusCredits: string
  startsAt: string
  endsAt: string
}

const EMPTY_FORM: OfferForm = {
  id: "",
  name: "",
  description: "",
  status: "draft",
  target: "all",
  productIds: [],
  bonusCredits: "1000",
  startsAt: "",
  endsAt: "",
}

const TARGET_LABEL: Record<PromotionalOffer["target"], string> = {
  all: "Plans and credit packs",
  subscription: "Plans only",
  credit_pack: "Credit packs only",
}

const STATUS_STYLE: Record<PromotionalOffer["status"], string> = {
  draft: "border-border text-muted-foreground",
  active: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
  paused: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  ended: "border-border text-muted-foreground",
}

function toInputValue(ms: number | null): string {
  if (ms === null) return ""
  const d = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromInputValue(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

function formatWindow(offer: PromotionalOffer): string {
  if (offer.startsAt === null && offer.endsAt === null) return "Always on while active"
  const start = offer.startsAt === null ? "now" : new Date(offer.startsAt).toLocaleString()
  const end = offer.endsAt === null ? "no end" : new Date(offer.endsAt).toLocaleString()
  return `${start} → ${end}`
}

function formFor(offer: PromotionalOffer): OfferForm {
  return {
    id: offer.id,
    name: offer.name,
    description: offer.description,
    status: offer.status,
    target: offer.target,
    productIds: [...offer.productIds],
    bonusCredits: String(offer.bonusCredits),
    startsAt: toInputValue(offer.startsAt),
    endsAt: toInputValue(offer.endsAt),
  }
}

export default function AdminOffersPage() {
  const { data, error, isLoading, mutate } = useSWR<{ offers: PromotionalOffer[] }>(
    "/api/admin/billing/offers",
    jsonFetcher,
  )
  const { data: catalog } = useSWR<{ products: CatalogProductView[] }>(
    "/api/admin/billing/catalog",
    jsonFetcher,
  )
  const [form, setForm] = useState<OfferForm>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const offers = data?.offers ?? []
  const productType = form.target === "credit_pack" ? "credit_pack" : form.target === "subscription" ? "subscription" : null
  const products = (catalog?.products ?? []).filter(
    (product) => product.status !== "archived" && (!productType || product.type === productType),
  )

  function set<K extends keyof OfferForm>(key: K, value: OfferForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function reset() {
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  async function save() {
    setBusy(true)
    setFormError(null)
    setMessage(null)
    try {
      const bonusCredits = Number(form.bonusCredits)
      if (!form.name.trim()) throw new Error("Give the offer a name.")
      if (!Number.isInteger(bonusCredits) || bonusCredits < 1) {
        throw new Error("Bonus credits must be a whole number of at least 1.")
      }
      const startsAt = fromInputValue(form.startsAt)
      const endsAt = fromInputValue(form.endsAt)
      if (startsAt !== null && endsAt !== null && endsAt <= startsAt) {
        throw new Error("The end date must be after the start date.")
      }
      await postJson("/api/admin/billing/offers", {
        ...(form.id ? { id: form.id } : {}),
        name: form.name.trim(),
        description: form.description.trim(),
        status: form.status,
        target: form.target,
        productIds: form.productIds,
        bonusCredits,
        startsAt,
        endsAt,
      })
      await mutate()
      setMessage(form.id ? "Offer updated." : "Offer created.")
      reset()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not save the offer.")
    } finally {
      setBusy(false)
    }
  }

  async function remove(offer: PromotionalOffer) {
    if (!window.confirm(`Delete "${offer.name}"? Existing checkouts keep the bonus they were quoted.`)) return
    setBusy(true)
    setMessage(null)
    try {
      await deleteJson(`/api/admin/billing/offers?id=${encodeURIComponent(offer.id)}`)
      await mutate()
      if (form.id === offer.id) reset()
      setMessage("Offer deleted.")
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not delete the offer.")
    } finally {
      setBusy(false)
    }
  }

  async function toggleStatus(offer: PromotionalOffer) {
    setBusy(true)
    setMessage(null)
    try {
      await postJson("/api/admin/billing/offers", {
        id: offer.id,
        name: offer.name,
        description: offer.description,
        status: offer.status === "active" ? "paused" : "active",
        target: offer.target,
        productIds: offer.productIds,
        bonusCredits: offer.bonusCredits,
        startsAt: offer.startsAt,
        endsAt: offer.endsAt,
      })
      await mutate()
      setMessage(offer.status === "active" ? "Offer paused." : "Offer activated.")
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not update the offer.")
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <AdminNav />
        <div className="mx-auto max-w-6xl px-6 py-10 text-center">
          <AlertTriangle className="size-10 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-semibold">Access Denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">You don&apos;t have permission to access this page.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AdminNav />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/admin/billing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3.5" />
              Billing dashboard
            </Link>
            <div className="mt-3 flex items-center gap-3">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Admin</p>
              <Badge variant="secondary" className="gap-1 text-xs">
                <Shield className="size-3" />
                Billing
              </Badge>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Offers &amp; campaigns</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Add bonus credits on top of a plan or credit-pack purchase. An offer never changes the
              catalog price, and a checkout keeps the bonus it was quoted even if the offer is edited
              or deleted later.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" render={<Link href="/pricing" target="_blank" />} className="gap-1.5">
              <Megaphone className="size-3.5" />
              View pricing
            </Button>
            <Button variant="outline" size="sm" onClick={() => mutate()} className="gap-1.5">
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          </div>
        </header>

        {message ? (
          <p className="mt-5 flex items-center gap-2 rounded-lg border border-green-500/25 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
            <CheckCircle2 className="size-4" />
            {message}
          </p>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="order-2 lg:order-1">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                All offers ({offers.length})
              </p>
              <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
                <Plus className="size-3.5" />
                New offer
              </Button>
            </div>
            {offers.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <Megaphone className="mx-auto size-8 text-muted-foreground" />
                  <p className="mt-3 font-medium">No offers yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create an offer to add bonus credits to a plan or credit pack.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {offers.map((offer) => (
                  <Card key={offer.id}>
                    <CardContent className="py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{offer.name}</p>
                            <Badge variant="outline" className={STATUS_STYLE[offer.status]}>
                              {offer.status}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              +{offer.bonusCredits.toLocaleString()} credits
                            </Badge>
                          </div>
                          {offer.description ? (
                            <p className="mt-1 text-sm text-muted-foreground">{offer.description}</p>
                          ) : null}
                          <p className="mt-2 text-xs text-muted-foreground">
                            {TARGET_LABEL[offer.target]}
                            {offer.productIds.length > 0 ? ` · ${offer.productIds.length} selected product${offer.productIds.length === 1 ? "" : "s"}` : " · every product in this category"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{formatWindow(offer)}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleStatus(offer)}
                            disabled={busy}
                            className="gap-1.5"
                          >
                            {offer.status === "active" ? <Pause className="size-3.5" /> : <Zap className="size-3.5" />}
                            {offer.status === "active" ? "Pause" : "Activate"}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setForm(formFor(offer))} className="gap-1.5">
                            <Pencil className="size-3.5" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => remove(offer)}
                            disabled={busy}
                            className="gap-1.5 text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <aside className="order-1 lg:order-2">
            <Card className="lg:sticky lg:top-20">
              <CardContent className="py-5">
                <div className="flex items-center gap-2">
                  <Megaphone className="size-4 text-primary" />
                  <p className="font-medium">{form.id ? "Edit offer" : "New offer"}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pack bonuses are permanent. Plan bonuses join the first monthly grant and follow its expiry.
                </p>

                <div className="mt-4 space-y-3">
                  <label className="block text-xs font-medium">
                    Name
                    <input
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="Launch week bonus"
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Description
                    <textarea
                      value={form.description}
                      onChange={(e) => set("description", e.target.value)}
                      rows={3}
                      placeholder="What the customer gets and why."
                      className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      Status
                      <select
                        value={form.status}
                        onChange={(e) => set("status", e.target.value as OfferForm["status"])}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      >
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                        <option value="ended">Ended</option>
                      </select>
                    </label>
                    <label className="block text-xs font-medium">
                      Applies to
                      <select
                        value={form.target}
                        onChange={(e) => setForm((current) => ({ ...current, target: e.target.value as OfferForm["target"], productIds: [] }))}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      >
                        <option value="all">Plans and packs</option>
                        <option value="subscription">Plans only</option>
                        <option value="credit_pack">Credit packs only</option>
                      </select>
                    </label>
                  </div>
                  <label className="block text-xs font-medium">
                    Bonus credits
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={form.bonusCredits}
                      onChange={(e) => set("bonusCredits", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      Starts
                      <input
                        type="datetime-local"
                        value={form.startsAt}
                        onChange={(e) => set("startsAt", e.target.value)}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      Ends
                      <input
                        type="datetime-local"
                        value={form.endsAt}
                        onChange={(e) => set("endsAt", e.target.value)}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      />
                    </label>
                  </div>

                  {productType ? (
                    <div>
                      <p className="text-xs font-medium">Products</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Leave every box empty to apply to all {productType === "credit_pack" ? "credit packs" : "plans"}.
                      </p>
                      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                        {products.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No {productType === "credit_pack" ? "credit packs" : "plans"} found.</p>
                        ) : (
                          products.map((product) => (
                            <label key={product.id} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent/50">
                              <input
                                type="checkbox"
                                checked={form.productIds.includes(product.id)}
                                onChange={(e) => {
                                  set(
                                    "productIds",
                                    e.target.checked
                                      ? [...form.productIds, product.id]
                                      : form.productIds.filter((id) => id !== product.id),
                                  )
                                }}
                              />
                              <span className="truncate">{product.name}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}

                  {formError ? <p className="text-xs text-destructive">{formError}</p> : null}

                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" onClick={save} disabled={busy} className="gap-1.5">
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                      {form.id ? "Save offer" : "Create offer"}
                    </Button>
                    {form.id ? (
                      <Button variant="outline" size="sm" onClick={reset} disabled={busy}>
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </main>
  )
}
