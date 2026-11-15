"use client"

import { useState } from "react"
import useSWR from "swr"
import { AlertTriangle, Loader2, Plus, RefreshCw, Shield } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { AdminNav } from "@/components/admin-nav"
import { jsonFetcher, postJson } from "@/lib/client/api"
import { toast } from "sonner"
import type { FeedbackSeverity } from "@/lib/feedback/types"
import { SEVERITY_LABEL } from "@/lib/feedback/types"

interface Incident {
  id: string; reference: string; title: string; severity: FeedbackSeverity
  status: string; reportCount: number; createdAt: number; updatedAt: number
}

export default function AdminIncidentsPage() {
  const { data, isLoading, mutate } = useSWR<Incident[]>("/api/admin/feedback/incidents", jsonFetcher)
  const [title, setTitle] = useState("")
  const [severity, setSeverity] = useState<FeedbackSeverity>("P2")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (title.trim().length < 4) return toast.error("Give the incident a title.")
    setBusy(true)
    try {
      await postJson("/api/admin/feedback/incidents", { title, severity, ...(description.trim() ? { description } : {}) })
      setTitle(""); setDescription("")
      await mutate()
      toast.success("Incident created")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AdminNav />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Admin</p>
              <Badge variant="secondary" className="gap-1 text-xs"><Shield className="size-3" />Feedback Hub</Badge>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Incidents</h1>
            <p className="mt-1 text-sm text-muted-foreground">Group recurring reports into tracked production incidents.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void mutate()} className="gap-1.5"><RefreshCw className="size-3.5" />Refresh</Button>
        </header>

        <Card className="mt-8">
          <CardContent className="space-y-3 py-5">
            <p className="text-sm font-medium">New incident</p>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Incident title (e.g. Checkout fails on Safari)" className="h-8 text-sm" />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What is happening, affected area…" className="text-sm" />
            <div className="flex items-center gap-2">
              <select value={severity} onChange={(e) => setSeverity(e.target.value as FeedbackSeverity)} className="h-8 rounded-lg border border-border bg-background px-2 text-xs">
                {(["P0", "P1", "P2", "P3", "P4"] as const).map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
              </select>
              <Button size="sm" onClick={() => void create()} disabled={busy} className="gap-1.5">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Create incident
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">After creating, link reports from each report&apos;s detail page (Triage → Incident ID: <span className="font-mono">inc_…</span>).</p>
          </CardContent>
        </Card>

        <div className="mt-6 space-y-2">
          {isLoading ? <Loader2 className="mx-auto mt-8 size-5 animate-spin text-primary" /> : null}
          {(data ?? []).length === 0 && !isLoading ? (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No incidents yet.</CardContent></Card>
          ) : null}
          {(data ?? []).map((i) => (
            <Card key={i.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{i.reference}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{i.severity}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{i.status}</Badge>
                  </div>
                  <p className="mt-1 font-medium">{i.title}</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><AlertTriangle className="size-3.5" />{i.reportCount} report{i.reportCount === 1 ? "" : "s"}</span>
                  <span className="font-mono">{new Date(i.updatedAt).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  )
}
