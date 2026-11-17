"use client"

import { useState } from "react"
import useSWR from "swr"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { deleteJson, jsonFetcher, patchJson, postJson } from "@/lib/client/api"
import type { BlogCategoryDoc } from "@/lib/blog/types"

type ListResponse = { items: BlogCategoryDoc[] }

export function CategoriesManager() {
  const { data, mutate } = useSWR<ListResponse>("/api/admin/blog/categories", jsonFetcher)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const items = data?.items ?? []

  async function create() {
    setBusy(true)
    setFlash(null)
    try {
      await postJson("/api/admin/blog/categories", { name, slug: slug || undefined, description })
      setName("")
      setSlug("")
      setDescription("")
      await mutate()
      setFlash("Category created.")
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not create the category.")
    } finally {
      setBusy(false)
    }
  }

  async function update(category: BlogCategoryDoc, patch: Partial<BlogCategoryDoc>) {
    setBusy(true)
    setFlash(null)
    try {
      await patchJson(`/api/admin/blog/categories/${category.id}`, {
        name: patch.name ?? category.name,
        slug: patch.slug ?? category.slug,
        description: patch.description ?? category.description,
        seoTitle: category.seoTitle,
        seoDescription: category.seoDescription,
        order: patch.order ?? category.order,
      })
      await mutate()
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not update the category.")
    } finally {
      setBusy(false)
    }
  }

  async function remove(category: BlogCategoryDoc) {
    if (!window.confirm(`Delete the “${category.name}” category?`)) return
    setBusy(true)
    try {
      await deleteJson(`/api/admin/blog/categories/${category.id}`)
      await mutate()
      setFlash("Category deleted.")
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not delete the category.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Editorial pillars for the blog. Each category has its own public landing page.
        </p>
      </div>

      {flash ? <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{flash}</p> : null}

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Add a category</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto]">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" aria-label="Category name" />
          <Input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="slug" aria-label="Category slug" />
          <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" aria-label="Category description" />
          <Button onClick={() => void create()} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
          </Button>
        </div>
      </section>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Name</th>
              <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Slug</th>
              <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Description</th>
              <th className="border-b border-border bg-muted/50 px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((category) => (
              <tr key={category.id}>
                <td className="border-b border-border/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Input
                      defaultValue={category.name}
                      onBlur={(event) => {
                        if (event.target.value !== category.name) void update(category, { name: event.target.value })
                      }}
                      className="h-9"
                      aria-label={`Name for ${category.name}`}
                    />
                    {category.builtIn ? (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Built-in
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="border-b border-border/60 px-3 py-2">
                  <Input
                    defaultValue={category.slug}
                    onBlur={(event) => {
                      if (event.target.value !== category.slug) void update(category, { slug: event.target.value })
                    }}
                    className="h-9 font-mono text-xs"
                    aria-label={`Slug for ${category.name}`}
                  />
                </td>
                <td className="border-b border-border/60 px-3 py-2">
                  <Textarea
                    defaultValue={category.description}
                    rows={1}
                    onBlur={(event) => {
                      if (event.target.value !== category.description) void update(category, { description: event.target.value })
                    }}
                    className="min-h-9"
                    aria-label={`Description for ${category.name}`}
                  />
                </td>
                <td className="border-b border-border/60 px-3 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void remove(category)}
                    disabled={busy || category.builtIn}
                    title={category.builtIn ? "Built-in categories cannot be deleted." : "Delete this category"}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
