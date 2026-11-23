"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  AlertTriangle,
  Archive,
  Check,
  Plus,
  RefreshCw,
  Send,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { jsonFetcher } from "@/lib/client/api"
import type {
  CatalogProductDetail,
  CatalogProductType,
  CatalogProductView,
  CatalogVersionSummary,
} from "@/lib/billing/catalog/types"
import { cn } from "@/lib/utils"

type ListResponse = { products: CatalogProductView[] }
type DetailResponse = { product: CatalogProductDetail }
type StatusFilter = "all" | "draft" | "published" | "archived"

type FormState = {
  type: CatalogProductType
  slug: string
  name: string
  description: string
  tagline: string
  saleMode: "self_serve" | "free" | "contact"
  currency: string
  priceUsd: string
  annualPriceUsd: string
  monthly: boolean
  annual: boolean
  monthlyGrant: string
  oneTimeGrant: string
  annualTotalCredits: string
  annualMonths: string
  annualIssuance: "monthly" | "upfront"
  bonusCredits: string
  expiresAfterDays: string
  purchaseModel: "credit_funded" | "direct_purchase"
  durationDays: string
  renewal: "manual" | "auto" | "none"
  storageLabel: string
  storageBytes: string
  totalumCredits: string
  creditCharge: string
  changeSummary: string
  notes: string
}

const TYPE_LABEL: Record<CatalogProductType, string> = {
  subscription: "Subscription",
  credit_pack: "Credit pack",
  infrastructure: "Infrastructure",
}

function money(minor: number | null): string {
  return minor === null ? "" : (minor / 100).toFixed(2)
}

function minor(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
}

function integer(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function formFromProduct(product: CatalogProductView | null): FormState {
  const source = product?.draftVersion ?? product?.currentVersion
  const credits = source?.credits
  const infrastructure = source?.infrastructure
  return {
    type: product?.type ?? "subscription",
    slug: product?.slug ?? "",
    name: source?.name ?? product?.name ?? "",
    description: source?.description ?? product?.description ?? "",
    tagline: source?.tagline ?? product?.tagline ?? "",
    saleMode:
      source?.saleMode === "free" || source?.saleMode === "contact"
        ? source.saleMode
        : "self_serve",
    currency: source?.currency ?? "USD",
    priceUsd: money(source?.priceMinor ?? null),
    annualPriceUsd: money(source?.annualPriceMinor ?? null),
    monthly: source?.billingIntervals.includes("monthly") ?? true,
    annual: source?.billingIntervals.includes("annual") ?? false,
    monthlyGrant: credits?.monthlyGrant?.toString() ?? "",
    oneTimeGrant: credits?.oneTimeGrant?.toString() ?? "",
    annualTotalCredits: credits?.annualTotalCredits?.toString() ?? "",
    annualMonths: credits?.annualMonths?.toString() ?? "",
    annualIssuance: credits?.annualIssuance ?? "monthly",
    bonusCredits: credits?.bonusCredits?.toString() ?? "",
    expiresAfterDays: credits?.expiresAfterDays?.toString() ?? "",
    purchaseModel: infrastructure?.purchaseModel ?? "credit_funded",
    durationDays: infrastructure?.durationDays?.toString() ?? "30",
    renewal: infrastructure?.renewal ?? "manual",
    storageLabel: infrastructure?.storageLabel ?? "",
    storageBytes: infrastructure?.storageBytes?.toString() ?? "",
    totalumCredits: infrastructure?.totalumInfrastructureCredits?.toString() ?? "",
    creditCharge: infrastructure?.creditCharge?.toString() ?? "",
    changeSummary: source?.changeSummary ?? "",
    notes: "",
  }
}

function formatMoney(currency: string, value: number | null): string {
  if (value === null) return "Custom"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value / 100)
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

function creditsLabel(product: CatalogProductView): string {
  const version = product.currentVersion
  if (product.type === "infrastructure") {
    const charge = version?.infrastructure?.creditCharge
    return charge === null || charge === undefined ? "Custom" : `${charge.toLocaleString()} credits`
  }
  const credits = version?.credits
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

function StatusBadge({ product }: { product: CatalogProductView }) {
  if (product.status === "archived") return <Badge variant="outline">Archived</Badge>
  if (product.status === "draft") return <Badge variant="secondary">Draft</Badge>
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge>Published</Badge>
      {product.draftVersion ? (
        <Badge variant="secondary">Draft v{product.draftVersion.version}</Badge>
      ) : null}
    </span>
  )
}

function VersionBadge({ status }: { status: CatalogVersionSummary["status"] }) {
  if (status === "published") return <Badge>Published</Badge>
  if (status === "archived") return <Badge variant="outline">Archived</Badge>
  return <Badge variant="secondary">Draft</Badge>
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  const json = (await response.json()) as { ok?: boolean; error?: { message?: string } }
  if (!response.ok || !json.ok) throw new Error(json.error?.message || "The request failed.")
  return json
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

function ProductForm({
  product,
  onCancel,
  onSaved,
}: {
  product: CatalogProductView | null
  onCancel: () => void
  onSaved: (message: string, productId?: string) => void
}) {
  const [form, setForm] = useState<FormState>(() => formFromProduct(product))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = Boolean(product)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const intervals =
        form.type === "subscription"
          ? [form.monthly ? "monthly" : null, form.annual ? "annual" : null].filter(
              (value): value is "monthly" | "annual" => value !== null,
            )
          : []
      const credits =
        form.type === "infrastructure"
          ? null
          : {
              creditType: form.type === "subscription" ? "subscription" : "permanent",
              monthlyGrant: integer(form.monthlyGrant),
              oneTimeGrant: integer(form.oneTimeGrant),
              annualTotalCredits: integer(form.annualTotalCredits),
              annualMonths: integer(form.annualMonths),
              annualIssuance: form.annual ? form.annualIssuance : null,
              expiresAfterDays: integer(form.expiresAfterDays),
              bonusCredits: integer(form.bonusCredits),
            }
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        tagline: optionalText(form.tagline),
        saleMode: form.saleMode,
        currency: form.currency.trim().toUpperCase(),
        priceMinor: minor(form.priceUsd),
        annualPriceMinor: form.annual ? minor(form.annualPriceUsd) : null,
        billingIntervals: intervals,
        credits,
        changeSummary: form.changeSummary.trim(),
        notes: optionalText(form.notes),
      }
      if (form.type === "infrastructure") {
        body.infrastructure = {
          purchaseModel: form.purchaseModel,
          durationDays: integer(form.durationDays) ?? 30,
          renewal: form.renewal,
          storageLabel: form.storageLabel.trim(),
          storageBytes: integer(form.storageBytes),
          totalumInfrastructureCredits: integer(form.totalumCredits),
          creditCharge: integer(form.creditCharge),
        }
      }
      if (!editing) {
        body.type = form.type
        body.slug = form.slug.trim()
        body.entitlement = null
      }

      if (editing && product) {
        body.expectedUpdatedAt = product.updatedAt
        await requestJson(`/api/admin/billing/catalog/${encodeURIComponent(product.id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
        onSaved("Draft version saved.", product.id)
      } else {
        const json = (await requestJson("/api/admin/billing/catalog/products", {
          method: "POST",
          body: JSON.stringify(body),
        })) as { data?: { productId?: string } }
        onSaved("Product created with an initial draft.", json.data?.productId)
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save the product.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{editing ? "Edit draft version" : "Create product"}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Saving creates a new immutable draft version. Published versions are never edited in place.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="gap-1">
          <X className="size-4" /> Cancel
        </Button>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {!editing ? (
          <>
            <FormField label="Product type">
              <select
                value={form.type}
                onChange={(event) => {
                  const type = event.target.value as CatalogProductType
                  setForm((current) => ({
                    ...current,
                    type,
                    priceUsd:
                      type === "infrastructure" && !current.priceUsd.trim()
                        ? "0.00"
                        : current.priceUsd,
                  }))
                }}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {(["subscription", "credit_pack", "infrastructure"] as const).map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Slug" hint="Lowercase words separated by hyphens. Cannot be reused after archive.">
              <Input
                value={form.slug}
                onChange={(event) => set("slug", event.target.value)}
                placeholder="studio-pro"
                required
              />
            </FormField>
          </>
        ) : (
          <div className="sm:col-span-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Identity is stable: <span className="font-mono">{product?.id}</span> · slug{" "}
            <span className="font-mono">{product?.slug}</span>. Editing creates a new draft version.
          </div>
        )}

        <FormField label="Name">
          <Input value={form.name} onChange={(event) => set("name", event.target.value)} required />
        </FormField>
        <FormField label="Sale mode">
          <select
            value={form.saleMode}
            onChange={(event) => set("saleMode", event.target.value as FormState["saleMode"])}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="self_serve">Self-serve</option>
            <option value="free">Free</option>
            <option value="contact">Contact</option>
          </select>
        </FormField>
        <FormField label="Description">
          <Textarea
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
            rows={3}
            required
          />
        </FormField>
        <FormField label="Tagline">
          <Input value={form.tagline} onChange={(event) => set("tagline", event.target.value)} />
        </FormField>

        <FormField label="Currency">
          <Input
            value={form.currency}
            onChange={(event) => set("currency", event.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </FormField>
        <FormField label="Monthly price (USD)">
          <Input
            value={form.priceUsd}
            onChange={(event) => set("priceUsd", event.target.value)}
            inputMode="decimal"
            placeholder="125.00"
          />
        </FormField>

        {form.type === "subscription" ? (
          <>
            <div className="space-y-2">
              <span className="text-xs font-medium">Billing intervals</span>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.monthly}
                  onChange={(event) => set("monthly", event.target.checked)}
                />
                Monthly
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.annual}
                  onChange={(event) => set("annual", event.target.checked)}
                />
                Annual
              </label>
            </div>
            <FormField label="Annual price (USD)">
              <Input
                value={form.annualPriceUsd}
                onChange={(event) => set("annualPriceUsd", event.target.value)}
                inputMode="decimal"
                disabled={!form.annual}
                placeholder="1200.00"
              />
            </FormField>
            <FormField label="Monthly credit grant">
              <Input
                value={form.monthlyGrant}
                onChange={(event) => set("monthlyGrant", event.target.value)}
                inputMode="numeric"
              />
            </FormField>
            <FormField label="Annual total credits">
              <Input
                value={form.annualTotalCredits}
                onChange={(event) => set("annualTotalCredits", event.target.value)}
                inputMode="numeric"
              />
            </FormField>
            <FormField label="Annual months">
              <Input
                value={form.annualMonths}
                onChange={(event) => set("annualMonths", event.target.value)}
                inputMode="numeric"
              />
            </FormField>
            <FormField label="Annual issuance">
              <select
                value={form.annualIssuance}
                onChange={(event) =>
                  set("annualIssuance", event.target.value as FormState["annualIssuance"])
                }
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                disabled={!form.annual}
              >
                <option value="monthly">Monthly during the year</option>
                <option value="upfront">Upfront for the year</option>
              </select>
            </FormField>
          </>
        ) : null}

        {form.type === "credit_pack" ? (
          <FormField label="One-time credits">
            <Input
              value={form.oneTimeGrant}
              onChange={(event) => set("oneTimeGrant", event.target.value)}
              inputMode="numeric"
            />
          </FormField>
        ) : null}

        {form.type !== "infrastructure" ? (
          <>
            <FormField label="Bonus credits">
              <Input
                value={form.bonusCredits}
                onChange={(event) => set("bonusCredits", event.target.value)}
                inputMode="numeric"
              />
            </FormField>
            <FormField label="Credit expiry (days)" hint="Leave blank for subscription-period credits.">
              <Input
                value={form.expiresAfterDays}
                onChange={(event) => set("expiresAfterDays", event.target.value)}
                inputMode="numeric"
              />
            </FormField>
          </>
        ) : null}

        {form.type === "infrastructure" ? (
          <>
            <FormField label="Purchase model">
              <select
                value={form.purchaseModel}
                onChange={(event) =>
                  set("purchaseModel", event.target.value as FormState["purchaseModel"])
                }
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="credit_funded">Credit-funded</option>
                <option value="direct_purchase">Direct purchase</option>
              </select>
            </FormField>
            <FormField label="Duration (days)">
              <Input
                value={form.durationDays}
                onChange={(event) => set("durationDays", event.target.value)}
                inputMode="numeric"
              />
            </FormField>
            <FormField label="Renewal">
              <select
                value={form.renewal}
                onChange={(event) => set("renewal", event.target.value as FormState["renewal"])}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="manual">Manual</option>
                <option value="auto">Automatic</option>
                <option value="none">None</option>
              </select>
            </FormField>
            <FormField label="Storage label">
              <Input
                value={form.storageLabel}
                onChange={(event) => set("storageLabel", event.target.value)}
                required
              />
            </FormField>
            <FormField label="Storage bytes">
              <Input
                value={form.storageBytes}
                onChange={(event) => set("storageBytes", event.target.value)}
                inputMode="numeric"
              />
            </FormField>
            <FormField label="Totalum infrastructure credits">
              <Input
                value={form.totalumCredits}
                onChange={(event) => set("totalumCredits", event.target.value)}
                inputMode="numeric"
              />
            </FormField>
            <FormField label="Atai credit charge">
              <Input
                value={form.creditCharge}
                onChange={(event) => set("creditCharge", event.target.value)}
                inputMode="numeric"
              />
            </FormField>
          </>
        ) : null}

        <FormField label="Change summary" hint="Required. Explains this version to the next admin.">
          <Input
            value={form.changeSummary}
            onChange={(event) => set("changeSummary", event.target.value)}
            required
          />
        </FormField>
        <FormField label="Notes">
          <Input value={form.notes} onChange={(event) => set("notes", event.target.value)} />
        </FormField>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button type="submit" disabled={busy} className="gap-1.5">
          {busy ? <RefreshCw className="size-4 animate-spin" /> : <Check className="size-4" />}
          {editing ? "Save draft version" : "Create product"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Dodo product ids, prices and existing subscriptions are not changed by this form.
        </p>
      </div>
    </form>
  )
}

function VersionHistory({ product }: { product: CatalogProductDetail }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-border">
      <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium">Version history</div>
      <ul className="divide-y divide-border">
        {product.versions.map((version) => (
          <li key={version.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">v{version.version}</span>
              <VersionBadge status={version.status} />
              <span className="text-xs text-muted-foreground">{version.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {version.publishedAt
                  ? `Published ${new Date(version.publishedAt).toLocaleString()}`
                  : `Created ${new Date(version.createdAt).toLocaleString()}`}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{version.changeSummary}</p>
            <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
              {version.id} · checksum {version.checksum.slice(0, 12)}…
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DetailPanel({
  product,
  loading,
  onEdit,
  onPublish,
  onArchive,
  busy,
}: {
  product: CatalogProductDetail | null
  loading: boolean
  onEdit: () => void
  onPublish: () => void
  onArchive: () => void
  busy: boolean
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading product detail…</p>
  if (!product) return <p className="text-sm text-muted-foreground">Select a product to inspect it.</p>

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{product.name}</h2>
            <StatusBadge product={product} />
          </div>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {product.id} · {product.slug} · {TYPE_LABEL[product.type]}
          </p>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{product.description}</p>
        </div>
        {product.status !== "archived" ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onEdit} className="gap-1">
              {product.draftVersion ? "Edit draft" : "Create draft"}
            </Button>
            {product.draftVersion ? (
              <Button type="button" size="sm" onClick={onPublish} disabled={busy} className="gap-1">
                <Send className="size-4" /> Publish draft
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={onArchive} disabled={busy} className="gap-1">
              <Archive className="size-4" /> Archive
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Current version</p>
          <p className="mt-1 text-sm font-medium">
            {product.currentVersion ? `v${product.currentVersion.version} · ${product.currentVersion.status}` : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{priceLabel(product)}</p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Draft</p>
          <p className="mt-1 text-sm font-medium">
            {product.draftVersion ? `v${product.draftVersion.version}` : "None"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {product.draftVersion ? "Publish is explicit" : "Edit to create one"}
          </p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Dodo</p>
          <p className="mt-1 text-sm font-medium">{product.dodoStatus}</p>
          <p className="mt-1 text-xs text-muted-foreground">Mappings are read-only here</p>
        </div>
      </div>

      {product.status === "archived" ? (
        <p className="mt-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Archived products cannot be edited or published. Historical versions and Dodo mappings remain.
        </p>
      ) : null}

      <VersionHistory product={product} />

      {product.mappings.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border p-3">
          <p className="text-xs font-medium">Dodo mappings</p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {product.mappings.map((mapping) => (
              <li key={`${mapping.productVersionId}:${mapping.cycle}:${mapping.environment}`} className="font-mono">
                {mapping.cycle}/{mapping.environment}: {mapping.dodoProductId} ({mapping.status})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function CatalogManager({ initialProducts }: { initialProducts: CatalogProductView[] }) {
  const list = useSWR<ListResponse>("/api/admin/billing/catalog", jsonFetcher, {
    fallbackData: { products: initialProducts },
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const detail = useSWR<DetailResponse>(
    selectedId ? `/api/admin/billing/catalog/${encodeURIComponent(selectedId)}` : null,
    jsonFetcher,
  )
  const [editor, setEditor] = useState<{ product: CatalogProductView | null } | null>(null)
  const [filter, setFilter] = useState<StatusFilter>("all")
  const [flash, setFlash] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const products = list.data?.products ?? initialProducts
  const selected = detail.data?.product ?? null
  const counts = useMemo(
    () => ({
      all: products.length,
      draft: products.filter((product) => product.status === "draft" || product.draftVersion).length,
      published: products.filter((product) => product.status === "published").length,
      archived: products.filter((product) => product.status === "archived").length,
    }),
    [products],
  )
  const filtered = useMemo(
    () =>
      products.filter((product) => {
        if (filter === "all") return true
        if (filter === "draft") return product.status === "draft" || Boolean(product.draftVersion)
        return product.status === filter
      }),
    [filter, products],
  )

  async function refresh(message?: string, productId?: string) {
    if (message) setFlash(message)
    setActionError(null)
    if (productId) setSelectedId(productId)
    await Promise.all([list.mutate(), productId ? detail.mutate() : Promise.resolve()])
  }

  async function publish(product: CatalogProductView) {
    if (!product.draftVersion) return
    if (!window.confirm(`Publish draft v${product.draftVersion.version} of “${product.name}”?`)) return
    setBusyId(product.id)
    setActionError(null)
    try {
      await requestJson(`/api/admin/billing/catalog/${encodeURIComponent(product.id)}/publish`, {
        method: "POST",
        body: JSON.stringify({ expectedUpdatedAt: product.updatedAt }),
      })
      await refresh("Draft published. Customer reads remain on the code catalog.", product.id)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not publish the product.")
    } finally {
      setBusyId(null)
    }
  }

  async function archive(product: CatalogProductView) {
    if (!window.confirm(`Archive “${product.name}”? Historical versions and Dodo mappings stay intact.`)) return
    setBusyId(product.id)
    setActionError(null)
    try {
      await requestJson(`/api/admin/billing/catalog/${encodeURIComponent(product.id)}/archive`, {
        method: "POST",
        body: JSON.stringify({ expectedUpdatedAt: product.updatedAt }),
      })
      await refresh("Product archived. Historical versions remain.", product.id)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not archive the product.")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {flash ? (
        <p className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <Check className="size-4" /> {flash}
        </p>
      ) : null}
      {actionError || list.error ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {actionError ?? "The catalog could not be refreshed. Check the database connection."}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {(["all", "draft", "published", "archived"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium capitalize",
                filter === value
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {value} ({counts[value]})
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void refresh()} className="gap-1.5">
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Button type="button" onClick={() => setEditor({ product: null })} className="gap-1.5">
            <Plus className="size-4" /> New product
          </Button>
        </div>
      </div>

      {editor ? (
        <ProductForm
          key={editor.product?.id ?? "new"}
          product={editor.product}
          onCancel={() => setEditor(null)}
          onSaved={(message, productId) => {
            setEditor(null)
            void refresh(message, productId)
          }}
        />
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            {filter === "all" ? "All products" : `${filter[0].toUpperCase()}${filter.slice(1)} products`}
          </h2>
        </div>
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">No products in this state.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium">Version</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium">Credits</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => (
                  <tr key={product.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelectedId(product.id)}
                        className="text-left font-medium hover:underline"
                      >
                        {product.name}
                      </button>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{product.id}</p>
                      <p className="text-[11px] text-muted-foreground">{TYPE_LABEL[product.type]}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge product={product} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {product.currentVersion ? `v${product.currentVersion.version}` : "—"}
                      <span className="block text-[10px] text-muted-foreground">{product.versionCount} total</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{priceLabel(product)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{creditsLabel(product)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedId(product.id)}>
                          Open
                        </Button>
                        {product.status !== "archived" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditor({ product })}
                          >
                            {product.draftVersion ? "Edit draft" : "Draft"}
                          </Button>
                        ) : null}
                        {product.draftVersion && product.status !== "archived" ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void publish(product)}
                            disabled={busyId === product.id}
                          >
                            Publish
                          </Button>
                        ) : null}
                        {product.status !== "archived" ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => void archive(product)}
                            disabled={busyId === product.id}
                            className="text-destructive"
                          >
                            <Archive className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Product details</h2>
          {selectedId ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
              Close
            </Button>
          ) : null}
        </div>
        <DetailPanel
          product={selected}
          loading={Boolean(selectedId) && detail.isLoading}
          onEdit={() => {
            if (selected) setEditor({ product: selected })
          }}
          onPublish={() => {
            if (selected) void publish(selected)
          }}
          onArchive={() => {
            if (selected) void archive(selected)
          }}
          busy={Boolean(selected && busyId === selected.id)}
        />
      </section>
    </div>
  )
}
