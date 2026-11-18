"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  BookOpen,
  Calendar,
  Check,
  ClipboardList,
  Copy,
  FileText,
  Filter,
  Image as ImageIcon,
  Link2,
  Loader2,
  Mail,
  Megaphone,
  Mic,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Share2,
  Target,
  Video,
  Wallet,
  X,
} from "lucide-react"
import { jsonFetcher } from "@/lib/client/api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { buildTrackedUrl, channelToUtmMedium, slugify } from "@/lib/marketing/campaigns/utm"
import { cn } from "@/lib/utils"

/**
 * Campaigns panel — the founder's plan-and-track surface. It creates and edits
 * campaign plans (name / objective / channels / dates / planned budget) and moves
 * them through draft → active → paused → completed/cancelled, all through the
 * ownership-gated, flag-gated endpoint. Nothing here sends email, posts to
 * social, spends any budget, or runs on a timer: a campaign records intent, not
 * results. The tracked-link tool is a PURE helper — it only builds a copyable
 * UTM URL from a link the founder pastes; it changes no checkout and reports no
 * measured result.
 */

export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "cancelled"
export type CampaignChannel = "email" | "social" | "content" | "seo" | "referral" | "other"

export interface CampaignView {
  id: string
  name: string
  objective: string
  channels: CampaignChannel[]
  status: CampaignStatus
  plannedBudgetCents: number | null
  utmCampaign: string | null
  startDate: number | null
  endDate: number | null
  notes: string | null
  assetIds: string[]
  origin: "ai_generated" | "user_created"
  createdAt: number
  updatedAt: number
  pausedAt: number | null
  cancelledAt: number | null
}

export interface CampaignsState {
  enabled: boolean
  campaigns: CampaignView[]
}

/** Lightweight studio asset reference for the attach picker and card display. */
export interface AssetSummary {
  id: string
  title: string
  kind: string
  channel: string | null
}

const ASSET_KIND_LABELS: Record<string, string> = {
  copy: "Copy",
  email: "Email",
  social: "Social",
  timeline: "Timeline",
  blog: "Blog",
  brief: "Brief",
  image: "Image",
  voice: "Voice",
  video: "Video",
}

function AssetKindIcon({ kind, className }: { kind: string; className?: string }) {
  switch (kind) {
    case "image": return <ImageIcon className={className} aria-hidden />
    case "video": return <Video className={className} aria-hidden />
    case "voice": return <Mic className={className} aria-hidden />
    case "email": return <Mail className={className} aria-hidden />
    case "social": return <Share2 className={className} aria-hidden />
    case "blog": return <BookOpen className={className} aria-hidden />
    case "brief": return <ClipboardList className={className} aria-hidden />
    case "timeline": return <Calendar className={className} aria-hidden />
    default: return <FileText className={className} aria-hidden />
  }
}

const ALL_CHANNELS: CampaignChannel[] = ["email", "social", "content", "seo", "referral", "other"]
const STATUS_FILTERS: Array<{ key: CampaignStatus | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "active", label: "Active" },
  { key: "paused", label: "Paused" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
]

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  paused: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  completed: "bg-primary/10 text-primary",
  cancelled: "bg-muted text-muted-foreground",
}

/** Mirror of the service transition machine, expressed as user-facing actions. */
const ACTIONS: Record<CampaignStatus, Array<{ to: CampaignStatus; label: string }>> = {
  draft: [
    { to: "active", label: "Start" },
    { to: "cancelled", label: "Cancel" },
  ],
  active: [
    { to: "paused", label: "Pause" },
    { to: "completed", label: "Complete" },
    { to: "cancelled", label: "Cancel" },
  ],
  paused: [
    { to: "active", label: "Resume" },
    { to: "completed", label: "Complete" },
    { to: "cancelled", label: "Cancel" },
  ],
  completed: [],
  cancelled: [],
}

function actionIcon(to: CampaignStatus) {
  switch (to) {
    case "active": return <Play className="mr-2 h-4 w-4" />
    case "paused": return <Pause className="mr-2 h-4 w-4" />
    case "completed": return <Check className="mr-2 h-4 w-4" />
    case "cancelled": return <X className="mr-2 h-4 w-4" />
    default: return null
  }
}

function formatMoney(cents: number | null): string | null {
  if (cents === null || !Number.isFinite(cents)) return null
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
}

function toInputDate(ms: number | null): string {
  if (!ms) return ""
  return new Date(ms).toISOString().slice(0, 10)
}

function fromInputDate(value: string): number | null {
  if (!value) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

function formatDateRange(start: number | null, end: number | null): string | null {
  if (!start && !end) return null
  const f = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
  if (start && end) return `${f(start)} → ${f(end)}`
  if (start) return `From ${f(start)}`
  return `Until ${f(end as number)}`
}

export function CampaignsPanel({ projectId, state }: { projectId: string; state: CampaignsState }) {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<CampaignView[]>(state.campaigns)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "all">("all")
  const [channelFilter, setChannelFilter] = useState<CampaignChannel | "all">("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CampaignView | null>(null)
  const [assets, setAssets] = useState<AssetSummary[]>([])

  // The studio library is optional context: it powers the attach picker and lets
  // cards name their attachments. If it is unavailable, cards fall back to counts.
  useEffect(() => {
    let cancelled = false
    jsonFetcher<{ enabled: boolean; items?: Array<{ id: string; title: string; kind: string; brief?: { channel?: string } }> }>(
      `/api/projects/${encodeURIComponent(projectId)}/market/studio`,
    )
      .then((data) => {
        if (cancelled || !Array.isArray(data.items)) return
        setAssets(
          data.items.map((it) => ({ id: it.id, title: it.title, kind: it.kind, channel: it.brief?.channel ?? null })),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId])

  const assetsById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])

  const counts = useMemo(() => {
    const by = (status: CampaignStatus) => campaigns.filter((c) => c.status === status).length
    return { total: campaigns.length, active: by("active"), draft: by("draft"), completed: by("completed") }
  }, [campaigns])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return campaigns
      .filter((c) => (statusFilter === "all" ? true : c.status === statusFilter))
      .filter((c) => (channelFilter === "all" ? true : c.channels.includes(channelFilter)))
      .filter((c) => (q ? c.name.toLowerCase().includes(q) || c.objective.toLowerCase().includes(q) : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [campaigns, search, statusFilter, channelFilter])

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(campaign: CampaignView) {
    setEditing(campaign)
    setDialogOpen(true)
  }

  function onSaved(campaign: CampaignView, isNew: boolean) {
    setCampaigns((prev) => (isNew ? [campaign, ...prev] : prev.map((c) => (c.id === campaign.id ? campaign : c))))
    setDialogOpen(false)
    router.refresh()
  }

  async function setStatus(campaign: CampaignView, status: CampaignStatus) {
    setBusyId(campaign.id)
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/campaigns`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id, status }),
      })
      const json = await response.json()
      if (!response.ok || !json.ok) {
        toast.error(json?.error?.message ?? "That change didn't save.")
        return
      }
      const updated = json.data as CampaignView
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      router.refresh()
    } catch {
      toast.error("That change didn't save.")
    } finally {
      setBusyId(null)
    }
  }

  if (!state.enabled) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Campaigns</h2>
        <p className="rounded-2xl border border-dashed border-border bg-transparent p-5 text-sm leading-6 text-muted-foreground">
          Campaign planning is switched off.{" "}
          <Link href="/settings/features" className="font-medium text-primary hover:underline">
            Turn it on in Settings
          </Link>{" "}
          if you want it in your workspace.
        </p>
      </section>
    )
  }

  const summary: Array<{ key: CampaignStatus | "all"; label: string; value: number; icon: typeof Target }> = [
    { key: "all", label: "Total plans", value: counts.total, icon: Megaphone },
    { key: "active", label: "Active", value: counts.active, icon: Play },
    { key: "draft", label: "Drafts", value: counts.draft, icon: Pencil },
    { key: "completed", label: "Completed", value: counts.completed, icon: Check },
  ]

  return (
    <section data-atai-tour="campaigns-board" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Megaphone className="h-5 w-5 text-primary" /> Campaigns
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Plan and track marketing campaigns for this project. A campaign records what you intend to do — Atai
            does not send email, post to social, spend any budget, or run anything on a schedule.
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" /> New campaign
        </Button>
      </div>

      {/* Summary cards — click to filter */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.map((card) => {
          const activeCard = statusFilter === card.key
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setStatusFilter(card.key)}
              aria-pressed={activeCard}
              className={cn(
                "flex flex-col gap-1 rounded-2xl border bg-card p-4 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeCard ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40",
              )}
            >
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <card.icon className="size-3.5" aria-hidden /> {card.label}
              </span>
              <span className="text-2xl font-bold tabular-nums tracking-tight">{card.value}</span>
            </button>
          )
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search campaigns by name or objective"
              className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <label className="flex items-center gap-2">
            <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <Filter className="size-3" aria-hidden /> Channel
            </span>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as CampaignChannel | "all")}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All channels</option>
              {ALL_CHANNELS.map((ch) => (
                <option key={ch} value={ch}>{ch}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((entry) => {
            const activeChip = statusFilter === entry.key
            return (
              <button
                key={entry.key}
                type="button"
                aria-pressed={activeChip}
                onClick={() => setStatusFilter(entry.key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  activeChip ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {entry.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* List */}
      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-12 text-center">
          <Megaphone className="mx-auto size-7 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-base font-semibold tracking-tight">No campaigns yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
            Create a plan to record what you intend to do — audience, message, channels and timing. Plans only: nothing
            is scheduled, posted, or executed anywhere.
          </p>
          <Button onClick={openCreate} className="mt-4">
            <Plus className="mr-2 h-4 w-4" /> Create your first campaign
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          No campaigns match these filters.{" "}
          <button
            type="button"
            onClick={() => { setSearch(""); setStatusFilter("all"); setChannelFilter("all") }}
            className="font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              busy={busyId === campaign.id}
              assetsById={assetsById}
              onSetStatus={setStatus}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}

      <CampaignDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        projectId={projectId}
        assets={assets}
        onSaved={onSaved}
      />
    </section>
  )
}

function CampaignCard({
  campaign,
  busy,
  assetsById,
  onSetStatus,
  onEdit,
}: {
  campaign: CampaignView
  busy: boolean
  assetsById: Map<string, AssetSummary>
  onSetStatus: (campaign: CampaignView, status: CampaignStatus) => void
  onEdit: (campaign: CampaignView) => void
}) {
  const actions = ACTIONS[campaign.status]
  const originLabel = campaign.origin === "ai_generated" ? "AI-proposed" : "You created"
  const budget = formatMoney(campaign.plannedBudgetCents)
  const dates = formatDateRange(campaign.startDate, campaign.endDate)
  const attachedCount = campaign.assetIds.length
  const attached = campaign.assetIds
    .map((id) => assetsById.get(id))
    .filter((a): a is AssetSummary => Boolean(a))

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="break-words text-sm font-semibold tracking-tight">{campaign.name}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", STATUS_STYLES[campaign.status])}>
            {campaign.status}
          </span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{originLabel}</span>
        </div>
        <button
          type="button"
          onClick={() => onEdit(campaign)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          <Pencil className="size-3" aria-hidden /> Edit
        </button>
      </div>

      {campaign.objective ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{campaign.objective}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {campaign.channels.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {campaign.channels.map((ch) => (
              <span key={ch} className="rounded-full border border-border px-2 py-0.5 capitalize">{ch}</span>
            ))}
          </span>
        ) : null}
        {dates ? (
          <span className="inline-flex items-center gap-1"><Calendar className="size-3" aria-hidden /> {dates}</span>
        ) : null}
        {budget ? (
          <span className="inline-flex items-center gap-1"><Wallet className="size-3" aria-hidden /> planned {budget}</span>
        ) : null}
      </div>

      {campaign.notes ? (
        <p className="whitespace-pre-wrap break-words rounded-xl border border-border bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
          {campaign.notes}
        </p>
      ) : null}

      {attachedCount > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-background px-3 py-2">
          <Paperclip className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 text-xs leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">
              {attachedCount} asset{attachedCount === 1 ? "" : "s"} attached
            </span>
            {attached.length > 0 ? <span className="block break-words">{attached.map((a) => a.title).join(", ")}</span> : null}
          </div>
        </div>
      ) : null}

      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button
              key={a.to}
              size="sm"
              variant={a.to === "cancelled" ? "ghost" : "outline"}
              onClick={() => onSetStatus(campaign, a.to)}
              disabled={busy}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : actionIcon(a.to)}
              {a.label}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">This campaign is {campaign.status} — no further actions.</p>
      )}

      <TrackedLinkBuilder campaign={campaign} />
    </article>
  )
}

function CampaignDialog({
  open,
  onOpenChange,
  initial,
  projectId,
  assets,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: CampaignView | null
  projectId: string
  assets: AssetSummary[]
  onSaved: (campaign: CampaignView, isNew: boolean) => void
}) {
  const [name, setName] = useState("")
  const [objective, setObjective] = useState("")
  const [channels, setChannels] = useState<CampaignChannel[]>([])
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [budget, setBudget] = useState("")
  const [notes, setNotes] = useState("")
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? "")
    setObjective(initial?.objective ?? "")
    setChannels(initial?.channels ?? [])
    setStart(toInputDate(initial?.startDate ?? null))
    setEnd(toInputDate(initial?.endDate ?? null))
    setBudget(initial?.plannedBudgetCents != null ? String(initial.plannedBudgetCents / 100) : "")
    setNotes(initial?.notes ?? "")
    setSelectedAssets(initial?.assetIds ?? [])
    setError(null)
  }, [open, initial])

  function toggleChannel(ch: CampaignChannel) {
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]))
  }

  function toggleAsset(id: string) {
    setSelectedAssets((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]))
  }

  async function save() {
    const trimmed = name.trim()
    if (trimmed.length < 3) {
      setError("Give the campaign a short name (at least 3 characters).")
      return
    }
    const startDate = fromInputDate(start)
    const endDate = fromInputDate(end)
    if (startDate && endDate && endDate < startDate) {
      setError("The end date can't be before the start date.")
      return
    }
    let plannedBudgetCents: number | null = null
    if (budget.trim() !== "") {
      const dollars = Number(budget)
      if (!Number.isFinite(dollars) || dollars < 0) {
        setError("Planned budget must be a positive number (or left blank).")
        return
      }
      plannedBudgetCents = Math.round(dollars * 100)
    }

    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: trimmed,
        objective: objective.trim(),
        channels,
        startDate,
        endDate,
        plannedBudgetCents,
        notes: notes.trim(),
        assetIds: selectedAssets,
      }
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/campaigns`, {
        method: initial ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          initial
            ? { campaignId: initial.id, ...payload }
            : { ...payload, utmCampaign: slugify(trimmed) || null, origin: "user_created" },
        ),
      })
      const json = await response.json()
      if (!response.ok || !json.ok) {
        setError(json?.error?.message ?? "The campaign couldn't be saved.")
        return
      }
      toast.success(initial ? "Campaign updated." : "Campaign plan added as a draft.")
      onSaved(json.data as CampaignView, !initial)
    } catch {
      setError("The campaign couldn't be saved. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="size-4 text-primary" /> {initial ? "Edit campaign" : "New campaign"}
          </DialogTitle>
          <DialogDescription>
            A plan you run yourself. Atai sends, posts, spends and schedules nothing — this records your intent.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-name">Name</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Product hunt launch"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-objective">Objective (optional)</Label>
            <Textarea
              id="campaign-objective"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="What you hope this achieves"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Channels</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_CHANNELS.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggleChannel(ch)}
                  aria-pressed={channels.includes(ch)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs capitalize transition-colors",
                    channels.includes(ch) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-start">Start date (optional)</Label>
              <Input id="campaign-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-end">End date (optional)</Label>
              <Input id="campaign-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-budget">Planned budget in USD (optional)</Label>
            <Input
              id="campaign-budget"
              type="number"
              min={0}
              step="1"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="e.g. 200"
            />
            <p className="text-xs text-muted-foreground">A planning number you track yourself — never spend, and never charged as credits.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-notes">Notes (optional)</Label>
            <Textarea
              id="campaign-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Anything to remember when you run this yourself"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Attached assets (optional)</Label>
            <AssetPicker assets={assets} selected={selectedAssets} onToggle={toggleAsset} />
          </div>

          {error ? (
            <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || name.trim().length < 3}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            {initial ? "Save changes" : "Add campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Attach studio assets to a campaign plan. Reads the project's own library
 * (passed in from the panel), filterable by asset type and platform. Selecting
 * an asset only stores a reference — it never copies, publishes, or schedules
 * anything.
 */
function AssetPicker({
  assets,
  selected,
  onToggle,
}: {
  assets: AssetSummary[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  const [search, setSearch] = useState("")
  const [kindFilter, setKindFilter] = useState<string>("all")
  const [platformFilter, setPlatformFilter] = useState<string>("all")

  const kinds = useMemo(() => Array.from(new Set(assets.map((a) => a.kind))).sort(), [assets])
  const platforms = useMemo(
    () => Array.from(new Set(assets.map((a) => a.channel).filter((c): c is string => Boolean(c)))).sort(),
    [assets],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return assets.filter(
      (a) =>
        (kindFilter === "all" || a.kind === kindFilter) &&
        (platformFilter === "all" || a.channel === platformFilter) &&
        (q ? a.title.toLowerCase().includes(q) : true),
    )
  }, [assets, search, kindFilter, platformFilter])

  if (assets.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-3 py-3 text-xs leading-5 text-muted-foreground">
        No assets in your Studio library yet. Draft creatives on the Ad bench or in the Studio, then attach them to this
        plan here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets by title"
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          aria-label="Filter assets by platform"
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">All platforms</option>
          {platforms.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter assets by type">
        <button
          type="button"
          aria-pressed={kindFilter === "all"}
          onClick={() => setKindFilter("all")}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            kindFilter === "all" ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          All types
        </button>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={kindFilter === kind}
            onClick={() => setKindFilter(kind)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              kindFilter === kind ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            <AssetKindIcon kind={kind} className="size-3" />
            {ASSET_KIND_LABELS[kind] ?? kind}
          </button>
        ))}
      </div>

      <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">No assets match these filters.</p>
        ) : (
          visible.map((a) => {
            const checked = selected.includes(a.id)
            return (
              <label
                key={a.id}
                className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(a.id)}
                  className="size-4 shrink-0 accent-[var(--primary)]"
                />
                <AssetKindIcon kind={a.kind} className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 break-words text-xs leading-5">{a.title}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  {ASSET_KIND_LABELS[a.kind] ?? a.kind}
                </span>
                {a.channel ? (
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
                    {a.channel}
                  </span>
                ) : null}
              </label>
            )
          })
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {selected.length} selected · attaching only links the asset to this plan — nothing is published or scheduled.
      </p>
    </div>
  )
}

/**
 * Pure, offline link builder. The founder pastes any URL they own; we append
 * UTM params and let them copy it. Nothing is sent, stored, or measured — this
 * is a convention helper only, not an attribution pipeline.
 */
function TrackedLinkBuilder({ campaign }: { campaign: CampaignView }) {
  const [base, setBase] = useState("")
  const [utmSource, setUtmSource] = useState("atai")

  const result = useMemo(() => {
    if (!base.trim()) return { url: null as string | null, reason: undefined as string | undefined }
    const medium = campaign.channels[0] ? channelToUtmMedium(campaign.channels[0]) : "other"
    return buildTrackedUrl(base, {
      utmSource: utmSource.trim() || "atai",
      utmMedium: medium,
      utmCampaign: campaign.utmCampaign || slugify(campaign.name) || undefined,
    })
  }, [base, utmSource, campaign.channels, campaign.utmCampaign, campaign.name])

  async function copy() {
    if (!result.url) return
    try {
      await navigator.clipboard.writeText(result.url)
      toast.success("Tracking link copied.")
    } catch {
      toast.error("Couldn't copy to your clipboard.")
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-transparent p-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" /> Tracked link (copy &amp; use yourself — Atai sends nothing)
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="Paste a link you own — https://…"
          className="min-w-0 flex-1 rounded-lg border border-border bg-transparent p-2 text-xs outline-none placeholder:text-muted-foreground focus:border-primary"
        />
        <input
          value={utmSource}
          onChange={(e) => setUtmSource(e.target.value)}
          placeholder="utm_source"
          className="w-28 rounded-lg border border-border bg-transparent p-2 text-xs outline-none placeholder:text-muted-foreground focus:border-primary"
        />
      </div>
      {result.url ? (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground">{result.url}</code>
          <Button size="sm" variant="outline" onClick={copy}>
            <Copy className="mr-2 h-4 w-4" /> Copy
          </Button>
        </div>
      ) : base.trim() && result.reason ? (
        <p className="text-xs text-muted-foreground">{result.reason}</p>
      ) : null}
    </div>
  )
}