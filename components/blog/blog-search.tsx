"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Search } from "lucide-react"
import { useState } from "react"

export function BlogSearch({ defaultValue = "" }: { defaultValue?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(defaultValue)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const params = new URLSearchParams(searchParams.toString())
    if (value.trim()) params.set("q", value.trim())
    else params.delete("q")
    params.delete("page")
    router.push(`/blog${params.toString() ? `?${params.toString()}` : ""}`)
  }

  return (
    <form onSubmit={submit} role="search" className="relative w-full max-w-md">
      <label className="sr-only" htmlFor="blog-search">
        Search articles
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        id="blog-search"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search comparisons, guides, topics…"
        className="h-11 w-full rounded-lg border border-border bg-card pl-10 pr-4 text-base text-foreground outline-none focus:border-primary sm:text-sm"
      />
    </form>
  )
}