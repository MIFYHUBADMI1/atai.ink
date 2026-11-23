"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, Building2, Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sendJson } from "./api-client"
import type { BusinessDoc } from "@/lib/types/business"

export function BusinessIndex({ initialBusinesses }: { initialBusinesses: BusinessDoc[] }) {
  const router = useRouter()
  const [businesses, setBusinesses] = useState(initialBusinesses)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function create(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const result = await sendJson<{ business: BusinessDoc }>("/api/businesses", "POST", { name })
    if (!result.ok || !result.data) {
      setError(result.message ?? "Could not create the business.")
      return
    }
    setBusinesses((current) => [...current, result.data!.business])
    setName("")
    startTransition(() => router.refresh())
    router.push(`/business/${result.data.business.id}`)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Businesses</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One business holds your applications, the people who work on them, and everything Atai knows about them.
        </p>
      </div>

      <Card>
        <CardContent className="p-5">
          <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="business-name">Business name</Label>
              <Input
                id="business-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Bakery"
                maxLength={120}
                required
              />
            </div>
            <Button type="submit" disabled={pending || name.trim().length === 0}>
              <Plus className="mr-2 h-4 w-4" />
              Create business
            </Button>
          </form>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      {businesses.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No businesses yet. Create the first one above.</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {businesses.map((business) => (
            <li key={business.id}>
              <Link href={`/business/${business.id}`} className="block">
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{business.name}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="secondary">{business.status}</Badge>
                        <span className="text-xs text-muted-foreground">{business.id}</span>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
