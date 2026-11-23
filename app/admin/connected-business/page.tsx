"use client"

import { useCallback, useEffect, useState } from "react"
import useSWR from "swr"
import { AlertTriangle, Loader2, Plus, RotateCcw, Save, Users, X } from "lucide-react"
import { toast } from "sonner"

import { AdminNav } from "@/components/admin-nav"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { deleteJson, jsonFetcher, patchJson } from "@/lib/client/api"
import { cn } from "@/lib/utils"

type Mode = "off" | "internal" | "all"

interface Rollout {
  mode: Mode
  cohort: string[]
  source: "admin" | "env" | "default"
  updatedAt?: number
  updatedBy?: string
}

interface Payload {
  rollout: Rollout
  deployment: Rollout
}

const MODES: { value: Mode; label: string; description: string }[] = [
  {
    value: "off",
    label: "Off",
    description: "Nobody sees the workspace. Every business route answers 404, including yours.",
  },
  {
    value: "internal",
    label: "Internal cohort",
    description: "Only the user ids below see it. Everyone else gets 404, as if the feature did not exist.",
  },
  {
    value: "all",
    label: "Everyone",
    description: "Every signed-in founder sees the workspace. Do not use this until the migration has run.",
  },
]

export default function AdminConnectedBusinessPage() {
  const { data, error, isLoading, mutate } = useSWR<Payload>("/api/admin/connected-business", jsonFetcher)

  const [mode, setMode] = useState<Mode>("off")
  const [cohort, setCohort] = useState<string[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!data) return
    setMode(data.rollout.mode)
    setCohort([...data.rollout.cohort])
  }, [data])

  const dirty =
    data !== undefined &&
    (mode !== data.rollout.mode || cohort.join("\u0000") !== [...data.rollout.cohort].sort().join("\u0000"))

  const addToCohort = useCallback(() => {
    const entries = draft
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (entries.length === 0) return
    setCohort((current) => [...new Set([...current, ...entries])].sort())
    setDraft("")
  }, [draft])

  const save = useCallback(async () => {
    setBusy(true)
    try {
      await patchJson("/api/admin/connected-business", { mode, cohort })
      await mutate()
      toast.success("Rollout saved. It applies within a few seconds.")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the rollout.")
    } finally {
      setBusy(false)
    }
  }, [mode, cohort, mutate])

  const clearOverride = useCallback(async () => {
    setBusy(true)
    try {
      await deleteJson("/api/admin/connected-business")
      await mutate()
      toast.success("Override cleared. The deployment env vars apply again.")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not clear the override.")
    } finally {
      setBusy(false)
    }
  }, [mutate])

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="size-6 animate-spin text-primary" />
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <AdminNav />
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="mt-10 text-center">
            <AlertTriangle className="mx-auto mb-4 size-10 text-destructive" />
            <h1 className="text-xl font-semibold">Access Denied</h1>
            <p className="mt-2 text-sm text-muted-foreground">You don&apos;t have permission to access this page.</p>
          </div>
        </div>
      </main>
    )
  }

  const rollout = data!.rollout
  const deployment = data!.deployment

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AdminNav />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Admin</p>
          <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight">
            <Users className="size-6 text-primary" />
            Connected business rollout
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Who can see the connected-business workspace at <code className="font-mono text-xs">/business</code>. The
            saved setting below overrides the deployment environment variables.
          </p>
        </header>

        <Card className="mt-6">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4 text-sm">
            <span className="flex items-center gap-2">
              Effective mode
              <Badge variant={rollout.mode === "off" ? "secondary" : "default"}>{rollout.mode}</Badge>
            </span>
            <span className="flex items-center gap-2 text-muted-foreground">
              Decided by
              <Badge variant="outline">
                {rollout.source === "admin" ? "this setting" : rollout.source === "env" ? "env vars" : "default (off)"}
              </Badge>
            </span>
            {rollout.updatedAt ? (
              <span className="text-xs text-muted-foreground">
                Saved {new Date(rollout.updatedAt).toLocaleString()}
                {rollout.updatedBy ? ` by ${rollout.updatedBy}` : ""}
              </span>
            ) : null}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  mode === option.value ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                )}
              >
                <span
                  className={cn(
                    "mt-1 size-3.5 shrink-0 rounded-full border",
                    mode === option.value ? "border-primary bg-primary" : "border-muted-foreground",
                  )}
                />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Internal test users</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Only used while the mode is <span className="font-medium">internal</span>. Paste one or more user ids —
              comma or space separated. They are kept when you switch modes.
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    addToCohort()
                  }
                }}
                placeholder="user id, or several separated by commas"
                aria-label="Add user id to the internal cohort"
              />
              <Button type="button" variant="outline" onClick={addToCohort} disabled={!draft.trim()}>
                <Plus className="mr-1.5 size-4" />
                Add
              </Button>
            </div>

            {cohort.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                Nobody is in the cohort. In internal mode the workspace stays hidden for everyone.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border">
                {cohort.map((id) => (
                  <li key={id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <code className="truncate font-mono text-xs">{id}</code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${id}`}
                      onClick={() => setCohort((current) => current.filter((entry) => entry !== id))}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={busy || !dirty}>
            <Save className="mr-1.5 size-4" />
            {dirty ? "Save rollout" : "Saved"}
          </Button>
          <Button variant="outline" onClick={clearOverride} disabled={busy || rollout.source !== "admin"}>
            <RotateCcw className="mr-1.5 size-4" />
            Clear override
          </Button>
          <span className="text-xs text-muted-foreground">
            Env fallback: <span className="font-mono">{deployment.mode}</span>
            {deployment.mode === "internal" ? ` · ${deployment.cohort.length} user(s)` : ""}
          </span>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          The switch is read per request with a five-second cache, so a change here can take up to five seconds to
          appear — and up to that long to stop appearing, which matters when you turn it off.
        </p>
      </div>
    </main>
  )
}
