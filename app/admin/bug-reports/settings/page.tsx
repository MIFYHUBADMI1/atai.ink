"use client"

import { useState } from "react"
import useSWR from "swr"
import { Loader2, RefreshCw, Settings, Shield } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AdminNav } from "@/components/admin-nav"
import { jsonFetcher } from "@/lib/client/api"
import { toast } from "sonner"
import type { FeedbackSettingsDoc } from "@/lib/feedback/types"

export default function FeedbackHubSettingsPage() {
  const { data, isLoading, mutate } = useSWR<FeedbackSettingsDoc>("/api/admin/feedback/settings", jsonFetcher)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<FeedbackSettingsDoc> | null>(null)

  const f = form ?? data
  const set = <K extends keyof FeedbackSettingsDoc>(k: K, v: FeedbackSettingsDoc[K]) =>
    setForm({ ...(f ?? {}), [k]: v } as Partial<FeedbackSettingsDoc>)

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      const res = await fetch("/api/admin/feedback/settings", {
        method: "PATCH", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) throw new Error(body?.error?.message ?? "Save failed")
      await mutate(body.data, false)
      setForm(null)
      toast.success("Settings saved")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const Toggle = ({ k, label, hint }: { k: keyof FeedbackSettingsDoc; label: string; hint?: string }) => (
    <label className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={Boolean(f?.[k])}
        onChange={(e) => set(k, e.target.checked as never)}
        className="mt-1 size-4 accent-primary"
      />
    </label>
  )

  const Num = ({ k, label, hint }: { k: keyof FeedbackSettingsDoc; label: string; hint?: string }) => (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint ? <span className="ml-2 text-xs text-muted-foreground">{hint}</span> : null}
      <Input
        type="number"
        className="mt-1 h-8 text-sm"
        value={Number(f?.[k] ?? 0)}
        onChange={(e) => set(k, Number(e.target.value) as never)}
      />
    </label>
  )

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AdminNav />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Admin</p>
              <Badge variant="secondary" className="gap-1 text-xs"><Shield className="size-3" />Feedback Hub</Badge>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Feedback settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">Launcher, reporting, and contributor-reward configuration.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void mutate()} className="gap-1.5"><RefreshCw className="size-3.5" />Reload</Button>
        </header>

        {isLoading || !f ? (
          <Loader2 className="mx-auto mt-16 size-6 animate-spin text-primary" />
        ) : (
          <div className="mt-8 space-y-6">
            <Card>
              <CardContent className="space-y-3 py-5">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground"><Settings className="size-3.5" />Launcher</p>
                <Toggle k="enabled" label="Enable feedback hub" hint="Master switch for the floating launcher." />
                <Toggle k="bugReportsEnabled" label="Bug reporting" hint="Allow users to submit reports." />
                <Toggle k="cofounderShortcutEnabled" label="AI Co-founder shortcut" hint="Show the co-founder action in the hub." />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 py-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Reporting</p>
                <Toggle k="voiceEnabled" label="Voice reporting" hint="Dictation and audio notes." />
                <Toggle k="screenshotEnabled" label="Image attachments" hint="Screenshots and image files." />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Num k="maxAudioSeconds" label="Max recording (sec)" />
                  <Num k="maxAudioBytes" label="Max audio (bytes)" />
                  <Num k="maxAttachmentBytes" label="Max attachment (bytes)" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 py-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Contributor rewards</p>
                <Toggle k="rewardsEnabled" label="Enable permanent-credit rewards" hint="Admins approve rewards per verified report." />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Num k="minReward" label="Minimum reward" />
                  <Num k="maxReward" label="Maximum reward" hint="Hard cap 2,000,000" />
                  <Num k="dualApprovalOver" label="Exceptional threshold" hint="Requires written justification above this" />
                </div>
                <div>
                  <p className="mb-1.5 text-sm font-medium">Reward tiers</p>
                  <div className="space-y-1.5">
                    {(f.rewardTiers ?? []).map((t, i) => (
                      <div key={t.id} className="flex items-center gap-2">
                        <Input
                          className="h-8 flex-1 text-xs"
                          value={t.label}
                          onChange={(e) => {
                            const tiers = [...(f.rewardTiers ?? [])]
                            tiers[i] = { ...tiers[i], label: e.target.value }
                            set("rewardTiers", tiers)
                          }}
                        />
                        <Input
                          type="number"
                          className="h-8 w-32 text-xs"
                          value={t.credits}
                          onChange={(e) => {
                            const tiers = [...(f.rewardTiers ?? [])]
                            tiers[i] = { ...tiers[i], credits: Number(e.target.value) }
                            set("rewardTiers", tiers)
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setForm(null); void mutate() }} disabled={saving}>Discard</Button>
              <Button size="sm" onClick={() => void save()} disabled={saving || !form} className="gap-1.5">
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null} Save settings
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
