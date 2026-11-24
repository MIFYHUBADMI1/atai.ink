"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, ArrowRight, Building2, Globe2, Lightbulb, GitBranch, Search, Trash2,
  Loader2, LayoutGrid, List, SlidersHorizontal, FolderOpen,
  Clock, CheckCircle2, AlertCircle, Zap, Plus, Rocket, Brain,
  DollarSign, TrendingUp, TrendingDown, AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"
import { StateBadge } from "@/components/state-badge"
import { ProjectThumbnail } from "@/components/project-thumbnail"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { deleteJson, postJson, useSession } from "@/lib/client/api"
import { selectOrphanedBuilds } from "@/lib/projects/build-recovery"
import { cn } from "@/lib/utils"
import type { BusinessStatus } from "@/lib/types/business"
import {
  countTabs,
  filterPortfolio,
  isConnectedBusinessItem,
  itemHref,
  itemLabel,
  itemMode,
  type BusinessTab,
  type ConnectedBusinessItem,
  type EnrichedProject,
  type PortfolioItem,
  type SortKey,
} from "./portfolio"
import type { FinanceTotals } from "@/lib/finances/project-finances"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// ─── Types ────────────────────────────────────────────────────────────────────

/** Re-exported so the server page and its tests share one type. */
export type { ConnectedBusinessItem, PortfolioItem } from "./portfolio"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function formatMoney(minor: number | null, currency: string | null): string {
  if (minor === null) return "No data"
  const major = minor / 100
  const formatted = major.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return currency ? `${currency} ${formatted}` : `$${formatted}`
}

function ModeIcon({ mode, className }: { mode: string; className?: string }) {
  if (mode === "connected") return <Building2 className={className} />
  if (mode === "website") return <Globe2 className={className} />
  if (mode === "github") return <GitBranch className={className} />
  return <Lightbulb className={className} />
}

const BUSINESS_STATUS_LABEL: Record<BusinessStatus, string> = {
  draft: "Draft",
  active: "Active",
  suspended: "Suspended",
  archived: "Archived",
}

const BUSINESS_STATUS_CLASS: Record<BusinessStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-success/15 text-success border-success/30",
  suspended: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  archived: "bg-muted text-muted-foreground",
}

function BusinessStatusBadge({ status }: { status: BusinessStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-0.5 font-mono text-xs uppercase tracking-wider",
        BUSINESS_STATUS_CLASS[status],
      )}
    >
      {BUSINESS_STATUS_LABEL[status]}
    </span>
  )
}

// ─── Business-oriented navigation ─────────────────────────────────────────────

const BUSINESS_TABS: { id: BusinessTab; label: string; icon: React.ElementType }[] = [
  { id: "all", label: "All", icon: FolderOpen },
  { id: "in-progress", label: "In progress", icon: Zap },
  { id: "live", label: "Live", icon: CheckCircle2 },
  { id: "needs-attention", label: "Needs attention", icon: AlertTriangle },
  { id: "archived", label: "Archived", icon: FolderOpen },
]

// ─── Delete dialog ────────────────────────────────────────────────────────────

function DeleteDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: EnrichedProject | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  if (!project) return null
  const title = project.name

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteJson(`/api/projects/${project!.id}`)
      toast.success("Business deleted")
      onOpenChange(false)
      onDeleted()
    } catch (e) {
      toast.error((e as Error).message || "Failed to delete business")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this business?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes <span className="font-medium text-foreground">{title}</span>, its build
            history and project workspace data, and revokes its Atai runtime keys. Financial and audit records
            are retained. The Atai claim on this business&apos;s website is released, so it can be connected
            again — but hosted apps, external files, DNS, domains and subscriptions are not removed or
            cancelled; shut them down separately. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleDelete() }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : "Delete business"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ─── Connected business delete dialog ─────────────────────────────────────────

function DeleteConnectedBusinessDialog({
  business,
  open,
  onOpenChange,
  onDeleted,
}: {
  business: ConnectedBusinessItem | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onDeleted: () => void
}) {
  const { session } = useSession()
  const isPasswordUser = session?.user?.authProvider === "password"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setEmail("")
    setPassword("")
    setError(null)
    setDeleting(false)
  }, [open])

  if (!business) return null

  const emailMatches =
    email.trim().toLowerCase() === (session?.user?.email ?? "").toLowerCase()
  const canDelete = !deleting && emailMatches && (!isPasswordUser || password.length > 0)

  async function handleDelete() {
    if (!business) return
    setDeleting(true)
    setError(null)
    try {
      await postJson(`/api/businesses/${business.id}/delete`, {
        confirmEmail: email.trim(),
        ...(isPasswordUser ? { currentPassword: password } : {}),
      })
      toast.success("Business deleted")
      onOpenChange(false)
      onDeleted()
    } catch (e) {
      setError((e as Error).message || "Failed to delete business")
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[min(90vh,44rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Permanently delete {business.name}?</AlertDialogTitle>
          <AlertDialogDescription className="block space-y-2">
            <span className="block">
              This permanently removes the connected business, its applications, its people and its workspace
              records. Atai also releases its ownership claim on the website, so another Atai account can connect
              it. Runtime keys are revoked.
            </span>
            <span className="block">
              Anything running outside Atai — hosting, DNS, your domain registrar, third-party subscriptions — is
              not cancelled or removed. Billing, refund and audit records are retained. This cannot be undone.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="delete-business-email" className="text-sm font-medium">
              Confirm with your account email
            </Label>
            <Input
              id="delete-business-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={session?.user?.email ?? "you@example.com"}
              autoComplete="email"
              disabled={deleting}
            />
          </div>

          {isPasswordUser ? (
            <div className="space-y-2">
              <Label htmlFor="delete-business-password" className="text-sm font-medium">
                Confirm with your current password
              </Label>
              <Input
                id="delete-business-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter current password"
                autoComplete="current-password"
                disabled={deleting}
              />
            </div>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              Your account signs in with {session?.user?.authProvider === "github" ? "GitHub" : "Google"}, so typing
              your account email is the confirmation.
            </p>
          )}

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={!canDelete}
          >
            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : "Delete permanently"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ─── Portfolio overview cards ─────────────────────────────────────────────────

function PortfolioOverview({
  totals,
  projectCount,
}: {
  totals: FinanceTotals | null
  projectCount: number
}) {
  const revenue = totals?.earningsMinor
  const credits = totals?.creditsCharged ?? 0
  const providerCost = totals?.providerCostUsd
  const netProfit = revenue !== null && revenue !== undefined && providerCost !== null && providerCost !== undefined
    ? revenue / 100 - providerCost
    : null
  const needsAttention = 0 // Will be computed from projects

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Total businesses</p>
          <FolderOpen className="size-4 text-muted-foreground" />
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight">{projectCount}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {projectCount === 1 ? "1 business in your portfolio" : `${projectCount} businesses in your portfolio`}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Revenue</p>
          <DollarSign className="size-4 text-muted-foreground" />
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight">
          {revenue !== null && revenue !== undefined ? formatMoney(revenue, totals?.currencies[0] ?? null) : "No data"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {revenue !== null ? "Attributed earnings" : "Financial data not available yet"}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Net profit</p>
          {netProfit !== null && netProfit >= 0 ? (
            <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : netProfit !== null && netProfit < 0 ? (
            <TrendingDown className="size-4 text-destructive" />
          ) : (
            <AlertCircle className="size-4 text-muted-foreground" />
          )}
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight">
          {netProfit !== null ? formatMoney(netProfit, totals?.currencies[0] ?? null) : "No data"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {netProfit !== null ? "Revenue minus expenses" : "Financial data not available yet"}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Needs attention</p>
          <AlertTriangle className="size-4 text-muted-foreground" />
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight">{needsAttention}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Businesses requiring your action
        </p>
      </div>
    </div>
  )
}

// ─── Grid card ────────────────────────────────────────────────────────────────

function RecoveringNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-[11px] font-medium text-primary", className)}>
      <Loader2 className="size-3 shrink-0 motion-safe:animate-spin motion-reduce:animate-none" aria-hidden />
      Reconnecting to your build
    </p>
  )
}

function BusinessCard({
  item,
  recovering = false,
  onDeleteRequest,
  onDeleteBusiness,
}: {
  item: PortfolioItem
  recovering?: boolean
  onDeleteRequest: (p: EnrichedProject) => void
  onDeleteBusiness: (b: ConnectedBusinessItem) => void
}) {
  const connected = isConnectedBusinessItem(item)
  const hasThumbnail = !connected && Boolean(item.thumbnailUrl)
  const isPlanReady = !connected && item.state === "plan_ready"
  const finance = connected ? undefined : item.financialSummary
  const badge = isConnectedBusinessItem(item) ? (
    <BusinessStatusBadge status={item.status} />
  ) : (
    <StateBadge state={item.state} />
  )

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
      <button
        aria-label={connected ? "Delete connected business" : "Delete business"}
        onClick={(e) => {
          e.preventDefault()
          if (isConnectedBusinessItem(item)) onDeleteBusiness(item)
          else onDeleteRequest(item)
        }}
        className="absolute right-3 top-3 z-10 flex size-7 items-center justify-center rounded-md bg-card/80 text-muted-foreground opacity-100 backdrop-blur-sm transition-opacity hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>

      <Link href={itemHref(item)} className="flex flex-1 flex-col">
        {/* Thumbnail */}
        {hasThumbnail ? (
          <div className="relative aspect-[16/7] w-full overflow-hidden bg-muted">
            <ProjectThumbnail
              src={item.thumbnailUrl}
              alt={`Preview of ${item.name}`}
              className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-card/80" />
            <div className="absolute bottom-2 right-2">{badge}</div>
          </div>
        ) : null}

        <div className={hasThumbnail ? "flex flex-1 flex-col gap-3 p-4" : "flex flex-1 flex-col gap-4 p-5"}>
          {!hasThumbnail && (
            <div className="flex items-center justify-between">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
                <ModeIcon mode={itemMode(item)} className="size-4 text-primary" />
              </div>
              {badge}
            </div>
          )}

          <div className="flex-1">
            <p className="truncate font-semibold text-sm text-foreground leading-snug">{item.name}</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-widest">
              {itemLabel(item)}
            </p>
            {recovering ? <RecoveringNote className="mt-1.5" /> : null}
          </div>

          {/* Financial summary */}
          {finance?.hasFinancialData && (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Revenue</span>
                <span className="font-medium text-foreground">
                  {finance.earningsMinor !== null
                    ? formatMoney(finance.earningsMinor, finance.currency)
                    : "No data"}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Credits</span>
                <span className="font-medium text-foreground">
                  {finance.creditsCharged.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {!finance?.hasFinancialData && (
            <div className="rounded-lg border border-dashed border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">No financial data yet</p>
            </div>
          )}

          {/* Plan ready prompt */}
          {isPlanReady && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
              <p className="text-[11px] font-semibold text-primary">✨ Plan ready — review before building</p>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              <Clock className="size-3" />
              {relativeTime(item.updatedAt)}
            </span>
            <span className="font-mono text-[10px] text-primary opacity-0 transition-opacity group-hover:opacity-100">
              {isPlanReady ? "Review →" : "Open →"}
            </span>
          </div>
        </div>
      </Link>
    </div>
  )
}

// ─── List row ─────────────────────────────────────────────────────────────────

function BusinessRow({
  item,
  recovering = false,
  onDeleteRequest,
  onDeleteBusiness,
}: {
  item: PortfolioItem
  recovering?: boolean
  onDeleteRequest: (p: EnrichedProject) => void
  onDeleteBusiness: (b: ConnectedBusinessItem) => void
}) {
  const connected = isConnectedBusinessItem(item)
  const isPlanReady = !connected && item.state === "plan_ready"
  const href = itemHref(item)
  const finance = connected ? undefined : item.financialSummary

  return (
    <div className="group relative flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 transition-all hover:border-primary/30 hover:shadow-sm">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
        <ModeIcon mode={itemMode(item)} className="size-4 text-primary" />
      </div>

      <div className="min-w-0 flex-1">
        <Link href={href} className="group/link">
          <p className="truncate font-semibold text-sm text-foreground transition-colors group-hover/link:text-primary">
            {item.name}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60 uppercase tracking-widest">
            {itemLabel(item)}
            {isPlanReady && <span className="ml-2 text-primary">· Plan ready</span>}
          </p>
          {recovering ? <RecoveringNote className="mt-1.5 normal-case tracking-normal" /> : null}
        </Link>
      </div>

      {/* Financial summary */}
      <div className="hidden shrink-0 text-right md:block">
        {finance?.hasFinancialData ? (
          <div>
            <p className="text-xs font-medium text-foreground">
              {finance.earningsMinor !== null
                ? formatMoney(finance.earningsMinor, finance.currency)
                : "No data"}
            </p>
            <p className="text-[10px] text-muted-foreground">Revenue</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No data</p>
        )}
      </div>

      <div className="hidden sm:block">
        {connected ? <BusinessStatusBadge status={item.status} /> : <StateBadge state={item.state} />}
      </div>

      <span className="hidden shrink-0 font-mono text-xs text-muted-foreground md:block">
        {relativeTime(item.updatedAt)}
      </span>

      <div className="flex items-center gap-1">
        <Link
          href={href}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Open business"
        >
          <ArrowRight className="size-3.5" />
        </Link>
        <button
          aria-label={connected ? "Delete connected business" : "Delete business"}
          onClick={() => {
            if (isConnectedBusinessItem(item)) onDeleteBusiness(item)
            else onDeleteRequest(item)
          }}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground opacity-100 transition-all hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Main workspace ───────────────────────────────────────────────────────────

export function ProjectsWorkspace({
  projects,
  businesses = [],
  portfolioTotals,
}: {
  projects: EnrichedProject[]
  /** Connected businesses. The server decides what the caller may see. */
  businesses?: ConnectedBusinessItem[]
  portfolioTotals: FinanceTotals | null
}) {
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState<BusinessTab>("all")
  const [sort, setSort] = useState<SortKey>("updatedAt")
  const [view, setView] = useState<"grid" | "list">("grid")
  const [deleteTarget, setDeleteTarget] = useState<EnrichedProject | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusinessTarget, setDeleteBusinessTarget] = useState<ConnectedBusinessItem | null>(null)
  const [deleteBusinessOpen, setDeleteBusinessOpen] = useState(false)
  const [recoveringIds, setRecoveringIds] = useState<string[]>([])
  const recoveryStartedRef = useRef(false)
  const router = useRouter()

  // A build the founder left behind — closed tab, refresh, navigation, crash —
  // keeps running at the builder, but nothing was watching it finish. One status
  // call per abandoned build is what reconciles it: the endpoint asks the builder,
  // and a build that finished while nobody looked transitions to ready with its
  // preview URL and settled credits.
  useEffect(() => {
    if (recoveryStartedRef.current || projects.length === 0) return
    const abandoned = selectOrphanedBuilds(projects)
    if (abandoned.length === 0) return
    recoveryStartedRef.current = true
    setRecoveringIds(abandoned.map((p) => p.id))
    void (async () => {
      for (const project of abandoned) {
        try {
          await fetch(`/api/projects/${project.id}/status`, { headers: { accept: "application/json" } })
        } catch {
          // The stored state stays on screen; opening the workspace retries.
        }
      }
      setRecoveringIds([])
      router.refresh()
    })()
  }, [projects, router])

  const items = useMemo<PortfolioItem[]>(() => [...projects, ...businesses], [projects, businesses])

  function requestDelete(p: EnrichedProject) {
    setDeleteTarget(p)
    setDeleteOpen(true)
  }

  function requestBusinessDelete(business: ConnectedBusinessItem) {
    setDeleteBusinessTarget(business)
    setDeleteBusinessOpen(true)
  }

  const displayed = useMemo(() => filterPortfolio(items, { tab, search, sort }), [items, tab, search, sort])
  const tabCounts = useMemo(() => countTabs(items), [items])

  return (
    <>
      {/* ── Page header ── */}
      <div className="mb-8 flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/dashboard"
            className="mb-3 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="size-3" /> Dashboard
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">All businesses</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Everything you run, in one place — businesses Atai builds for you, and the ones you already run.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/new/existing"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-foreground"
          >
            <Building2 className="size-4" /> Connect existing business
          </Link>
          <Link
            href="/new/idea"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-foreground"
          >
            <Lightbulb className="size-4" /> Explore projects
          </Link>
          <Link
            href="/new"
            data-atai-tour="projects-new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="size-4" /> New business
          </Link>
        </div>
      </div>

      {/* ── Portfolio overview ── */}
      <div className="mb-8">
        <PortfolioOverview totals={portfolioTotals} projectCount={items.length} />
      </div>

      {/* ── Business navigation ── */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
          {BUSINESS_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                tab === id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
              {tabCounts[id] > 0 && (
                <span className={cn(
                  "ml-0.5 rounded-full px-1.5 py-0.5 font-mono text-[9px] tabular-nums",
                  tab === id ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground",
                )}>
                  {tabCounts[id]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search businesses…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 rounded-xl border border-border bg-card pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 w-52"
            />
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5">
            <SlidersHorizontal className="size-3.5 text-muted-foreground" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="bg-transparent text-xs text-foreground focus:outline-none"
            >
              <option value="updatedAt">Last updated</option>
              <option value="name">Name</option>
              <option value="revenue">Revenue</option>
              <option value="profit">Profit</option>
            </select>
          </div>

          <div className="flex rounded-xl border border-border bg-card p-1">
            <button
              onClick={() => setView("grid")}
              className={cn(
                "flex size-7 items-center justify-center rounded-lg transition-colors",
                view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="Grid view"
            >
              <LayoutGrid className="size-3.5" />
            </button>
            <button
              onClick={() => setView("list")}
              className={cn(
                "flex size-7 items-center justify-center rounded-lg transition-colors",
                view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="List view"
            >
              <List className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      {displayed.length === 0 ? (
        <div data-atai-tour="projects-empty" className="flex flex-col items-center gap-5 rounded-2xl border border-dashed border-border bg-card/40 py-24 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-muted">
            <Rocket className="size-7 text-muted-foreground" />
          </div>
          {items.length === 0 ? (
            <>
              <div>
                <p className="text-lg font-bold text-foreground">Your next business starts here</p>
                <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
                  Turn an idea into a business with Atai. Describe what you want to build, start from a website, or bring an existing codebase.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <Link
                  href="/new/idea"
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Lightbulb className="size-4" /> Start a business
                </Link>
                <Link
                  href="/new/website"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-medium hover:bg-accent"
                >
                  <Globe2 className="size-4" /> From a website
                </Link>
                <Link
                  href="/new/github"
                  className="inline-flex items-center gap-2 rounded-xl border border-purple-500/30 bg-purple-500/5 px-5 py-2.5 text-sm font-medium text-purple-600 hover:bg-purple-500/10 dark:text-purple-400"
                >
                  <GitBranch className="size-4" /> From GitHub
                </Link>
              </div>
              <p className="text-sm text-muted-foreground">
                Not sure where to begin?{" "}
                <Link href="/tours" className="text-primary underline-offset-4 hover:underline">
                  take the guided tour
                </Link>{" "}
                — it walks the real product and never spends credits for you.
              </p>
            </>
          ) : (
            <>
              <div>
                <p className="font-semibold text-foreground">No matches found</p>
                <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search or filter.</p>
              </div>
              <button
                onClick={() => { setSearch(""); setTab("all") }}
                className="text-sm text-primary hover:underline"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      ) : view === "grid" ? (
        <div data-atai-tour="projects-list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {displayed.map((item) => (
            <BusinessCard key={item.id} item={item} recovering={recoveringIds.includes(item.id)} onDeleteRequest={requestDelete} onDeleteBusiness={requestBusinessDelete} />
          ))}
        </div>
      ) : (
        <div data-atai-tour="projects-list" className="flex flex-col gap-2">
          <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 pb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground sm:grid">
            <span>Business</span>
            <span>Revenue</span>
            <span>Status</span>
            <span>Updated</span>
            <span />
          </div>
          {displayed.map((item) => (
            <BusinessRow key={item.id} item={item} recovering={recoveringIds.includes(item.id)} onDeleteRequest={requestDelete} onDeleteBusiness={requestBusinessDelete} />
          ))}
        </div>
      )}

      {/* ── Stats footer ── */}
      {items.length > 0 && (
        <div className="mt-10 flex flex-wrap items-center gap-6 border-t border-border pt-6 text-xs text-muted-foreground">
          {BUSINESS_TABS.filter((t) => t.id !== "all").map(({ id, label, icon: Icon }) => (
            tabCounts[id] > 0 && (
              <div key={id} className="flex items-center gap-1.5">
                <Icon className="size-3.5" />
                <span>{tabCounts[id]} {label.toLowerCase()}</span>
              </div>
            )
          ))}
          <div className="flex items-center gap-1.5 ml-auto">
            <FolderOpen className="size-3.5" />
            <span>{items.length} total business{items.length !== 1 ? "es" : ""}</span>
          </div>
        </div>
      )}

      <DeleteDialog
        project={deleteTarget}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => window.location.reload()} // Simple refresh; could be improved with SWR
      />

      <DeleteConnectedBusinessDialog
        business={deleteBusinessTarget}
        open={deleteBusinessOpen}
        onOpenChange={setDeleteBusinessOpen}
        onDeleted={() => window.location.reload()}
      />
    </>
  )
}
