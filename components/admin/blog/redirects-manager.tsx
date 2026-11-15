"use client"

import { useState } from "react"
import useSWR from "swr"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { deleteJson, jsonFetcher, postJson } from "@/lib/client/api"
import type { BlogRedirectDoc } from "@/lib/blog/types"

type ListResponse = { items: BlogRedirectDoc[] }

export function RedirectsManager() {
  const { data, mutate } = useSWR<ListResponse>("/api/admin/blog/redirects", jsonFetcher)
  const [from, setFrom] = useState("")
  const [toSlug, setToSlug] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const items = data?.items ?? []

  async function create() {
    setBusy(true)
    setFlash(null)
    try {
      await postJson("/api/admin/blog/redirects", { from, toSlug, reason: reason || undefined })
      setFrom("")
      setToSlug("")
      setReason("")
      await mutate()
      setFlash("Redirect saved.")
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not save the redirect.")
    } finally {
      setBusy(false)
    }
  }

  async function remove(redirect: BlogRedirectDoc) {
    setBusy(true)
    try {
      await deleteJson(`/api/admin/blog/redirects/${redirect.id}`)
      await mutate()
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not delete the redirect.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Redirects</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanent redirects keep old article URLs alive when a slug changes, so existing links keep working.
        </p>
      </div>

      {flash ? <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{flash}</p> : null}

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Add a redirect</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Input value={from} onChange={(event) => setFrom(event.target.value)} placeholder="/blog/old-slug" aria-label="Old path" />
          <Input value={toSlug} onChange={(event) => setToSlug(event.target.value)} placeholder="new-slug" aria-label="Target slug" />
          <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason (optional)" aria-label="Reason" />
          <Button onClick={() => void create()} disabled={busy || !from.trim() || !toSlug.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
          </Button>
        </div>
      </section>

      {items.length ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">From</th>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">To</th>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Reason</th>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((redirect) => (
                <tr key={redirect.id}>
                  <td className="border-b border-border/60 px-3 py-2 font-mono text-xs">{redirect.from}</td>
                  <td className="border-b border-border/60 px-3 py-2 font-mono text-xs">/blog/{redirect.toSlug}</td>
                  <td className="border-b border-border/60 px-3 py-2 text-muted-foreground">{redirect.reason ?? "—"}</td>
                  <td className="border-b border-border/60 px-3 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => void remove(redirect)} disabled={busy}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          No redirects yet. Changing a published slug creates one automatically.
        </p>
      )}
    </div>
  )
}
