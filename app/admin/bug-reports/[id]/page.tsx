"use client"

import { use, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Coins, FileText, Loader2,
  Mic, Paperclip, Shield, StickyNote, UserCheck, XCircle,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { AdminNav } from "@/components/admin-nav"
import { jsonFetcher, postJson } from "@/lib/client/api"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { AdminFeedbackReport, FeedbackSeverity, FeedbackStatus } from "@/lib/feedback/types"
import { SEVERITY_LABEL, STATUS_LABEL } from "@/lib/feedback/types"

interface RewardHistoryItem {
  id: string; amount: number; approvedBy: string; status: "approved" | "failed"
  note?: string; ledgerEntryId?: string; failureReason?: string; createdAt: number
}

type Detail = AdminFeedbackReport & { rewardHistory?: RewardHistoryItem[] }

const STATUSES: FeedbackStatus[] = ["new", "reviewing", "verified", "in_progress", "resolved", "rejected", "duplicate"]
const SEVERITIES: FeedbackSeverity[] = ["P0", "P1", "P2", "P3", "P4"]

async function patchReport(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/admin/feedback/reports/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? "Update failed")
  return data.data
}

export default function AdminBugReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data, isLoading, error, mutate } = useSWR<Detail>(`/api/admin/feedback/reports/${id}`, jsonFetcher)
  const [note, setNote] = useState("")
  const [response, setResponse] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [rewardMode, setRewardMode] = useState<"tier" | "custom">("tier")
  const [tierId, setTierId] = useState("")
  const [customAmount, setCustomAmount] = useState("")
  const [rewardNote, setRewardNote] = useState("")
  const [tiers, setTiers] = useState<{ id: string; label: string; credits: number }[]>([])

  useSWR<{ rewardTiers: { id: string; label: string; credits: number }[] }>(
    "/api/admin/feedback/settings", jsonFetcher,
    { onSuccess: (d) => setTiers(d.rewardTiers ?? []) },
  )

  if (isLoading) {
    return <main className="grid min-h-screen place-items-center bg-background"><Loader2 className="size-6 animate-spin text-primary" /></main>
  }
  if (error || !data) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <AdminNav />
        <div className="mx-auto max-w-6xl px-6 py-10 text-center">
          <AlertTriangle className="mx-auto mb-4 size-10 text-destructive" />
          <h1 className="text-xl font-semibold">Report not found</h1>
          <Link href="/admin/bug-reports" className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent">
            Back to reports
          </Link>
        </div>
      </main>
    )
  }

  const r = data
  const act = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(key)
    try {
      await fn()
      await mutate()
      toast.success(okMsg)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed")
    } finally {
      setBusy(null)
    }
  }

  const setStatus = (status: FeedbackStatus) =>
    act(`status-${status}`, () => patchReport(id, { status, reason: reason || undefined }), `Marked ${STATUS_LABEL[status].toLowerCase()}`)
  const setSeverity = (severity: FeedbackSeverity) =>
    act(`sev-${severity}`, () => patchReport(id, { severity }), `Severity set to ${severity}`)
  const addNote = () =>
    act("note", async () => { await patchReport(id, { internalNote: note }); setNote("") }, "Internal note added")
  const addResponse = () =>
    act("resp", async () => { await patchReport(id, { publicResponse: response, ...(reason ? { reason } : {}) }); setResponse(""); setReason("") }, "Response sent to user")
  const linkIncident = () =>
    act("incident", () => patchReport(id, { incidentId: incidentInput || null }), "Incident link updated")
  const [incidentInput, setIncidentInput] = useState("")
  const approveReward = () =>
    act("reward", async () => {
      const payload = rewardMode === "tier"
        ? { tierId, ...(rewardNote ? { note: rewardNote } : {}) }
        : { amount: Number(customAmount), ...(rewardNote ? { note: rewardNote } : {}) }
      await postJson(`/api/admin/feedback/reports/${id}/reward`, payload)
    }, "Reward approved — permanent credits granted")

  const diag = r.diagnostics
  const errors = diag?.errors ?? []
  const latestError = [...errors].sort((a, b) => b.at - a.at)[0]

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AdminNav />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Link href="/admin/bug-reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All reports
        </Link>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-semibold">{r.reference}</h1>
              <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[r.status])}>{STATUS_LABEL[r.status]}</Badge>
              <Badge variant="outline" className="font-mono text-[10px]">{r.severity} · {SEVERITY_LABEL[r.severity].split("—")[1]?.trim()}</Badge>
              {r.incidentId ? <Badge variant="outline" className="text-[10px]">incident: {r.incidentId}</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {r.categoryLabel} · reported by {r.userName ?? r.userId}{r.userEmail ? ` (${r.userEmail})` : ""} · {new Date(r.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={r.status}
              onChange={(e) => void setStatus(e.target.value as FeedbackStatus)}
              disabled={!!busy}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
              aria-label="Report status"
            >
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <select
              value={r.severity}
              onChange={(e) => void setSeverity(e.target.value as FeedbackSeverity)}
              disabled={!!busy}
              className="h-8 rounded-lg border border-border bg-background px-2 font-mono text-xs"
              aria-label="Severity"
            >
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </select>
          </div>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Main column */}
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardContent className="space-y-4 py-5">
                <SectionTitle icon={FileText}>Description</SectionTitle>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.description}</p>
                {r.originalDescription ? (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Original transcription (preserved)</p>
                    <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">{r.originalDescription}</p>
                  </div>
                ) : null}
                {r.transcription?.status === "failed" ? (
                  <p className="text-xs text-amber-500">Transcription failed — the user submitted a manual description.</p>
                ) : null}
                {r.attachments.length ? (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Attachments</p>
                    <ul className="space-y-1.5">
                      {r.attachments.map((a) => (
                        <li key={a.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
                          {a.kind === "image" ? <Paperclip className="size-3.5" /> : <Mic className="size-3.5" />}
                          {a.kind === "audio" ? (
                            <audio controls preload="none" src={`/api/feedback/attachments/${a.id}`} className="h-7 flex-1" />
                          ) : (
                            <a href={`/api/feedback/attachments/${a.id}`} target="_blank" rel="noreferrer" className="flex-1 truncate text-primary hover:underline">{a.name}</a>
                          )}
                          <span className="shrink-0 font-mono text-muted-foreground">{(a.size / 1024).toFixed(0)} KB</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-5">
                <SectionTitle icon={AlertTriangle}>Diagnostics</SectionTitle>
                {diag ? (
                  <div className="mt-3 space-y-4 text-sm">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                      <Diag label="URL" value={diag.page.url} mono />
                      <Diag label="Route" value={diag.page.route} mono />
                      <Diag label="Section" value={diag.page.section ?? "—"} mono />
                      <Diag label="Project" value={diag.page.projectId ?? "—"} mono />
                      <Diag label="Environment" value={diag.page.environment} />
                      <Diag label="Release" value={diag.page.release ?? "—"} mono />
                      <Diag label="Browser" value={[diag.device.browser, diag.device.browserVersion].filter(Boolean).join(" ") || "—"} />
                      <Diag label="OS" value={diag.device.os ?? "—"} />
                      <Diag label="Device" value={diag.device.deviceCategory} />
                      <Diag label="Viewport" value={`${diag.device.viewportWidth}×${diag.device.viewportHeight}`} mono />
                      <Diag label="Screen" value={`${diag.device.screenWidth}×${diag.device.screenHeight}`} mono />
                      <Diag label="Language" value={diag.device.language} mono />
                      <Diag label="Online" value={diag.device.online ? "yes" : "no"} />
                      <Diag label="Captured" value={new Date(diag.collectedAt).toISOString()} mono />
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                        Recent errors ({errors.length}){latestError ? " — latest may be related, not confirmed" : ""}
                      </p>
                      {errors.length ? (
                        <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                          {[...errors].sort((a, b) => b.at - a.at).map((e, i) => (
                            <li key={i} className="rounded-md border border-border px-2.5 py-1.5 text-xs">
                              <span className="font-mono text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span>{" "}
                              <Badge variant="outline" className="mx-1 text-[10px]">{e.kind}</Badge>
                              {e.status ? <span className="font-mono text-muted-foreground">{e.status} </span> : null}
                              <span>{e.message}</span>
                              {e.fingerprint ? <span className="ml-1 font-mono text-[10px] text-muted-foreground">fp:{e.fingerprint}</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-xs text-muted-foreground">No client errors captured.</p>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Automatically observed context — correlation with the reported issue is not confirmed unless verified during review.
                    </p>
                  </div>
                ) : <p className="text-sm text-muted-foreground">No diagnostics captured.</p>}
              </CardContent>
            </Card>

            {r.similarReports?.length ? (
              <Card>
                <CardContent className="py-5">
                  <SectionTitle icon={AlertTriangle}>Similar reports ({r.similarReports.length})</SectionTitle>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {r.similarReports.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3">
                        <Link href={`/admin/bug-reports/${s.id}`} className="font-mono text-xs text-primary hover:underline">{s.reference}</Link>
                        <Badge variant="outline" className="text-[10px]">{STATUS_LABEL[s.status]}</Badge>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            {/* Reward */}
            <Card>
              <CardContent className="space-y-3 py-5">
                <SectionTitle icon={Coins}>Contributor reward</SectionTitle>
                {r.reward ? (
                  <p className="text-sm text-green-600">
                    Awarded <strong>{r.reward.amount.toLocaleString()}</strong> permanent credits
                    {r.reward.note ? ` — ${r.reward.note}` : ""}
                  </p>
                ) : r.status === "verified" || r.status === "in_progress" || r.status === "resolved" ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Button variant={rewardMode === "tier" ? "default" : "outline"} size="sm" onClick={() => setRewardMode("tier")}>Tier</Button>
                      <Button variant={rewardMode === "custom" ? "default" : "outline"} size="sm" onClick={() => setRewardMode("custom")}>Custom</Button>
                    </div>
                    {rewardMode === "tier" ? (
                      <select value={tierId} onChange={(e) => setTierId(e.target.value)} className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs">
                        <option value="">Choose a reward level…</option>
                        {tiers.map((t) => <option key={t.id} value={t.id}>{t.label} — {t.credits.toLocaleString()} credits</option>)}
                      </select>
                    ) : (
                      <Input type="number" min={100} max={2000000} value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} placeholder="Credits (max 2,000,000)" className="h-8 text-xs" />
                    )}
                    <Textarea value={rewardNote} onChange={(e) => setRewardNote(e.target.value)} placeholder="Reason for the award (required for exceptional rewards)" rows={2} className="text-xs" />
                    <Button size="sm" onClick={() => void approveReward()} disabled={!!busy || (rewardMode === "tier" ? !tierId : !customAmount)} className="gap-1.5">
                      {busy === "reward" ? <Loader2 className="size-3.5 animate-spin" /> : <Coins className="size-3.5" />}
                      Approve permanent-credit reward
                    </Button>
                    <p className="text-xs text-muted-foreground">Granted through the permanent-credit ledger. One reward per report; cannot exceed 2,000,000 credits.</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Rewards unlock once the report is verified.</p>
                )}
                {r.rewardHistory?.length ? (
                  <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
                    {r.rewardHistory.map((h) => (
                      <li key={h.id} className="flex items-center justify-between gap-2">
                        <span>{h.amount.toLocaleString()} credits · {h.status}</span>
                        <span className="font-mono text-muted-foreground">{new Date(h.createdAt).toLocaleDateString()}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* Side column */}
          <div className="space-y-6">
            <Card>
              <CardContent className="space-y-3 py-5">
                <SectionTitle icon={UserCheck}>Triage</SectionTitle>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Incident ID</p>
                  <div className="flex gap-2">
                    <Input value={incidentInput} onChange={(e) => setIncidentInput(e.target.value)} placeholder={r.incidentId ?? "inc_…"} className="h-8 font-mono text-xs" />
                    <Button variant="outline" size="sm" onClick={() => void linkIncident()} disabled={!!busy}>Link</Button>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Reason (required for reject/duplicate)</p>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 text-xs" placeholder="Short reason shown to the user" />
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(["verified", "in_progress", "resolved", "rejected", "duplicate"] as const).map((s) => (
                    <Button key={s} variant="outline" size="xs" disabled={!!busy || r.status === s} onClick={() => void setStatus(s)}>
                      {busy === `status-${s}` ? <Loader2 className="size-3 animate-spin" /> : null}
                      {STATUS_LABEL[s]}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 py-5">
                <SectionTitle icon={StickyNote}>Internal notes</SectionTitle>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Admin-only note…" className="text-xs" />
                <Button size="sm" variant="outline" onClick={() => void addNote()} disabled={!!busy || !note.trim()} className="gap-1.5">
                  {busy === "note" ? <Loader2 className="size-3.5 animate-spin" /> : <StickyNote className="size-3.5" />} Add note
                </Button>
                <ul className="max-h-48 space-y-2 overflow-y-auto border-t border-border pt-2">
                  {r.internalNotes.map((n) => (
                    <li key={n.id} className="text-xs">
                      <p className="whitespace-pre-wrap">{n.body}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</p>
                    </li>
                  ))}
                  {!r.internalNotes.length ? <li className="text-xs text-muted-foreground">No internal notes.</li> : null}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 py-5">
                <SectionTitle icon={CheckCircle2}>User-visible response</SectionTitle>
                <Textarea value={response} onChange={(e) => setResponse(e.target.value)} rows={3} placeholder="Shown to the reporter on their contribution page…" className="text-xs" />
                <Button size="sm" onClick={() => void addResponse()} disabled={!!busy || !response.trim()} className="gap-1.5">
                  {busy === "resp" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Send response
                </Button>
                {r.responses.length ? (
                  <ul className="max-h-40 space-y-2 overflow-y-auto border-t border-border pt-2">
                    {r.responses.map((c) => (
                      <li key={c.id} className="text-xs">
                        <p className="whitespace-pre-wrap">{c.body}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-5">
                <SectionTitle icon={Shield}>Audit history</SectionTitle>
                <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
                  {r.auditHistory.map((a) => (
                    <li key={a.id} className="text-xs">
                      <span className="font-mono text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>{" "}
                      <span className="font-medium">{a.action}</span>
                      {a.detail ? <span className="text-muted-foreground"> — {a.detail}</span> : null}
                    </li>
                  ))}
                  {!r.auditHistory.length ? <li className="text-xs text-muted-foreground">No recorded actions yet.</li> : null}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  )
}

const STATUS_TONE: Record<string, string> = {
  new: "border-blue-500/40 text-blue-500",
  reviewing: "border-amber-500/40 text-amber-500",
  verified: "border-green-500/40 text-green-500",
  in_progress: "border-purple-500/40 text-purple-500",
  resolved: "border-emerald-600/40 text-emerald-600",
  rejected: "border-red-500/40 text-red-500",
  duplicate: "border-border text-muted-foreground",
}

function SectionTitle({ icon: Icon, children }: { icon: typeof FileText; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
      <Icon className="size-3.5" /> {children}
    </p>
  )
}

function Diag({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", mono && "font-mono")}>{value}</dd>
    </div>
  )
}
