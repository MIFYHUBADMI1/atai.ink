"use client"

import { Globe, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { BlogSeo } from "@/lib/blog/types"

export function SeoPanel({
  seo,
  onChange,
  siteUrl,
  slug,
  title,
  description,
}: {
  seo: BlogSeo
  onChange: (next: BlogSeo) => void
  siteUrl: string
  slug: string
  title: string
  description: string
}) {
  const serpTitle = seo.title?.trim() || `${title} | Atai Blog`
  const serpDescription = seo.description?.trim() || description
  const url = seo.canonical?.trim() || `${siteUrl}/blog/${slug}`
  const titleLength = serpTitle.length
  const descLength = serpDescription.length

  function set<K extends keyof BlogSeo>(key: K, value: BlogSeo[K]) {
    onChange({ ...seo, [key]: value })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Search preview</p>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Search className="size-3" /> atai.ink
          </p>
          {/* Two lines, like a real result, rather than one clipped line — the
              admin needs to see the whole title they wrote. */}
          <p className="mt-1 line-clamp-2 break-words text-base text-[#1a0dab] dark:text-[#8ab4f8]">{serpTitle}</p>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{serpDescription}</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <span className={titleLength > 70 ? "text-amber-500" : "text-muted-foreground"}>Title {titleLength}/70</span>
          <span className={descLength > 160 ? "text-amber-500" : "text-muted-foreground"}>
            Description {descLength}/160
          </span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="seo-title">SEO title</Label>
          <Input id="seo-title" value={seo.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="Defaults to the article title" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="seo-description">Meta description</Label>
          <Input id="seo-description" value={seo.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="Defaults to the article description" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="seo-canonical">Canonical URL</Label>
          <Input id="seo-canonical" value={seo.canonical ?? ""} onChange={(e) => set("canonical", e.target.value)} placeholder={`${siteUrl}/blog/${slug}`} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="seo-focus">Focus keyword</Label>
          <Input id="seo-focus" value={seo.focusKeyword ?? ""} onChange={(e) => set("focusKeyword", e.target.value)} placeholder="e.g. lovable alternative" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="seo-og-title">OG title</Label>
          <Input id="seo-og-title" value={seo.ogTitle ?? ""} onChange={(e) => set("ogTitle", e.target.value)} placeholder="Social sharing title" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="seo-og-description">OG description</Label>
          <Input id="seo-og-description" value={seo.ogDescription ?? ""} onChange={(e) => set("ogDescription", e.target.value)} placeholder="Social sharing description" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="seo-og-image">OG image URL</Label>
          <Input id="seo-og-image" value={seo.ogImage ?? ""} onChange={(e) => set("ogImage", e.target.value)} placeholder="https://…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="seo-keywords">Secondary keywords</Label>
          <Input
            id="seo-keywords"
            value={(seo.secondaryKeywords ?? []).join(", ")}
            onChange={(e) => set("secondaryKeywords", e.target.value.split(",").map((k) => k.trim()).filter(Boolean))}
            placeholder="comma, separated, keywords"
          />
        </div>
      </div>

      <label className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={seo.noindex ?? false}
          onChange={(e) => set("noindex", e.target.checked)}
        />
        <span>
          <span className="font-medium">Hide from search engines (noindex)</span>
          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Globe className="size-3" /> The article stays reachable by link but is left out of the sitemap and search results.
          </span>
        </span>
      </label>
    </div>
  )
}
