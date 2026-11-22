"use client"

import { useState } from "react"
import useSWR from "swr"
import { Bot, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { deleteJson, jsonFetcher, patchJson, postJson, type ApiError } from "@/lib/client/api"
import type { CofounderModelTier } from "@/lib/cofounder/models"

interface TiersResponse {
  tiers: CofounderModelTier[]
}

interface TierForm {
  name: string
  strength: string
  modelId: string
  creditsPerMessage: string
}

const EMPTY_FORM: TierForm = { name: "", strength: "", modelId: "", creditsPerMessage: "0" }

function costLabel(tier: CofounderModelTier): string {
  return tier.creditsPerMessage === 0 ? "Free" : `${tier.creditsPerMessage} credits / message`
}

export default function AdminCofounderModelsPage() {
  const { data, error, isLoading, mutate } = useSWR<TiersResponse>("/api/admin/cofounder-models", jsonFetcher)
  const [form, setForm] = useState<TierForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<TierForm>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const tiers = data?.tiers ?? []

  async function create() {
    setBusy(true)
    setErr(null)
    setNotice(null)
    try {
      const res = await postJson<{ tier: CofounderModelTier; notified: { sent: number; failed: number } }>(
        "/api/admin/cofounder-models",
        {
          name: form.name,
          strength: form.strength,
          modelId: form.modelId,
          creditsPerMessage: Number(form.creditsPerMessage) || 0,
        },
      )
      setForm(EMPTY_FORM)
      setNotice(
        `"${res.tier.name}" is live. Founders were emailed (${res.notified.sent} sent${res.notified.failed ? `, ${res.notified.failed} failed` : ""}).`,
      )
      await mutate()
    } catch (e) {
      setErr((e as ApiError).message || "Couldn't add that engine.")
    } finally {
      setBusy(false)
    }
  }

  function startEdit(tier: CofounderModelTier) {
    setEditingId(tier.id)
    setEditForm({
      name: tier.name,
      strength: tier.strength,
      modelId: tier.modelId,
      creditsPerMessage: String(tier.creditsPerMessage),
    })
    setErr(null)
    setNotice(null)
  }

  async function saveEdit(id: string) {
    setBusy(true)
    setErr(null)
    setNotice(null)
    try {
      const res = await patchJson<{ changed: boolean; notified: { sent: number; failed: number } | null }>(
        `/api/admin/cofounder-models/${id}`,
        {
          name: editForm.name,
          strength: editForm.strength,
          modelId: editForm.modelId,
          creditsPerMessage: Number(editForm.creditsPerMessage) || 0,
        },
      )
      setEditingId(null)
      setNotice(
        res.changed
          ? `Saved — founders were emailed about the change (${res.notified?.sent ?? 0} sent).`
          : "Saved. No founder-visible fields changed, so no email went out.",
      )
      await mutate()
    } catch (e) {
      setErr((e as ApiError).message || "Couldn't save that engine.")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this engine? Founders using it fall back to the default.")) return
    setBusy(true)
    setErr(null)
    try {
      await deleteJson(`/api/admin/cofounder-models/${id}`)
      setNotice("Engine deleted.")
      await mutate()
    } catch (e) {
      setErr((e as ApiError).message || "Couldn't delete that engine.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Product</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Co-founder engines</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            The named modes founders pick in Settings → AI co-founder. Rename them, change the model behind them,
            or adjust the credit cost — founders get an email whenever an engine is added or visibly changed. The
            cost is charged per co-founder message and added to the price of a founder's first read of a business,
            so it is the whole per-turn cost of that engine, not a markup.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void mutate()} className="gap-1.5 self-start">
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </header>

      {notice ? (
        <p className="mt-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground">{notice}</p>
      ) : null}
      {err ? (
        <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</p>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-3">Engine</th>
              <th className="px-4 py-3">Strength (shown to founders)</th>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3">Cost</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && !data ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading engines…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-destructive">
                  Couldn't load the catalog.
                </td>
              </tr>
            ) : tiers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No engines yet — add the first one below.
                </td>
              </tr>
            ) : (
              tiers.map((tier) =>
                editingId === tier.id ? (
                  <tr key={tier.id} className="border-b border-border bg-muted/30">
                    <td className="px-4 py-3">
                      <input
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                        placeholder="Engine name"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={editForm.strength}
                        onChange={(e) => setEditForm({ ...editForm, strength: e.target.value })}
                        className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                        placeholder="What it's good at"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={editForm.modelId}
                        onChange={(e) => setEditForm({ ...editForm, modelId: e.target.value })}
                        className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono text-xs"
                        placeholder="provider/model-id"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={editForm.creditsPerMessage}
                        onChange={(e) => setEditForm({ ...editForm, creditsPerMessage: e.target.value })}
                        className="h-8 w-24 rounded-md border border-input bg-transparent px-2 font-mono text-xs"
                        inputMode="numeric"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" disabled={busy} onClick={() => void saveEdit(tier.id)}>
                          Save
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={tier.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{tier.name}</td>
                    <td className="max-w-xs px-4 py-3 text-muted-foreground">{tier.strength}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{tier.modelId}</td>
                    <td className="px-4 py-3 text-muted-foreground">{costLabel(tier)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => startEdit(tier)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || tiers.length <= 1}
                          onClick={() => void remove(tier.id)}
                          className="gap-1"
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Bot className="size-4 text-muted-foreground" />
          Add an engine
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Founders see the name and strength — the model id powers it behind the scenes. Setting credits to 0 makes
          it free; anything above charges that many credits per co-founder message, and the same amount is added to
          the price of a founder's first read of a business.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Engine name (e.g. Nova)"
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
          />
          <input
            value={form.modelId}
            onChange={(e) => setForm({ ...form, modelId: e.target.value })}
            placeholder="OpenRouter model id (e.g. openai/gpt-5.2)"
            className="h-9 rounded-lg border border-input bg-transparent px-3 font-mono text-xs"
          />
          <input
            value={form.strength}
            onChange={(e) => setForm({ ...form, strength: e.target.value })}
            placeholder="Strength description shown to founders"
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm sm:col-span-2"
          />
          <input
            value={form.creditsPerMessage}
            onChange={(e) => setForm({ ...form, creditsPerMessage: e.target.value })}
            placeholder="Credits per message (0 = free)"
            inputMode="numeric"
            className="h-9 rounded-lg border border-input bg-transparent px-3 font-mono text-xs"
          />
          <Button onClick={() => void create()} disabled={busy} className="gap-1.5">
            <Plus className="size-4" />
            Add engine &amp; notify founders
          </Button>
        </div>
      </section>
    </div>
  )
}
