"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  BellOff,
  CheckCheck,
  Inbox,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Undo2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { jsonFetcher, useProjects, useSession } from "@/lib/client/api"
import { relativeTimeShort } from "@/lib/client/format"
import {
  buildNotificationInbox,
  selectNotifications,
  type InboxItem,
  type NotificationSort,
  type NotificationTab,
} from "@/lib/dashboard/view-model"
import { useNotificationState } from "@/lib/dashboard/notifications-store"
import type { PublicFeatureRequest } from "@/lib/feature-requests/types"
import { cn } from "@/lib/utils"
import useSWR from "swr"

// The page is the complete record; the header preview only takes the newest few.
const SHOW_ALL = { maxItems: 200, maxFeatureRequests: 100 } as const

const KIND_LABEL: Record<InboxItem["kind"], string> = {
  action: "Needs you",
  progress: "In progress",
  update: "Update",
}

const TABS: { id: NotificationTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "action", label: "Needs you" },
  { id: "progress", label: "In progress" },
  { id: "update", label: "Updates" },
  { id: "dismissed", label: "Dismissed" },
]

const SORTS: { id: NotificationSort; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "priority", label: "Priority" },
]

const SEVERITY_STYLE: Record<InboxItem["severity"], string> = {
  error: "bg-destructive/10 text-destructive",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  info: "bg-primary/10 text-primary",
  neutral: "bg-muted text-muted-foreground",
}

export function NotificationsWorkspace() {
  const router = useRouter()
  const { projects } = useProjects()
  const { session } = useSession()
  const { data: mine, isLoading: requestsLoading } = useSWR<{ items: PublicFeatureRequest[] }>(
    session ? "/api/feature-requests?mine=1&sort=updated" : null,
    jsonFetcher,
    { revalidateOnFocus: true, dedupingInterval: 30_000 },
  )
  const { hydrated, read, dismissed, markRead, markUnread, markAllRead, dismiss, restore, clearDismissed } =
    useNotificationState()

  const [tab, setTab] = useState<NotificationTab>("all")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<NotificationSort>("newest")

  const items = useMemo(
    () =>
      buildNotificationInbox({
        projects,
        emailVerified: session?.user.emailVerified ?? true,
        creditsAvailable: session?.credits.available,
        featureRequests: mine?.items,
        ...SHOW_ALL,
      }),
    [projects, session, mine],
  )

  const live = useMemo(() => selectNotifications({ items, read, dismissed }), [items, read, dismissed])
  const visible = useMemo(
    () => selectNotifications({ items, read, dismissed, tab, search, sort }),
    [items, read, dismissed, tab, search, sort],
  )

  const counts = useMemo(() => {
    const unread = live.filter((item) => !read.has(item.id)).length
    // Only ids still backed by live work count as dismissed — stale ids from finished
    // projects would otherwise inflate the tab.
    const dismissedCount = items.filter((item) => dismissed.has(item.id)).length
    return {
      all: live.length,
      unread,
      action: live.filter((item) => item.kind === "action").length,
      progress: live.filter((item) => item.kind === "progress").length,
      update: live.filter((item) => item.kind === "update").length,
      dismissed: dismissedCount,
    } satisfies Record<NotificationTab, number>
  }, [items, live, read, dismissed])

  function openItem(item: InboxItem) {
    markRead(item.id)
    router.push(item.href)
  }

  function dismissItem(item: InboxItem) {
    dismiss(item.id)
    toast("Notification dismissed", {
      description: item.title,
      action: { label: "Undo", onClick: () => restore(item.id) },
    })
  }

  function restoreItem(item: InboxItem) {
    restore(item.id)
    toast("Notification restored")
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="border-b border-border pb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Notifications</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Everything Atai needs to tell you — plans to review, builds in progress, launches, and your feature
          requests. Search it, sort it, or dismiss what you no longer need.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              markAllRead(live.map((item) => item.id))
              toast("All notifications marked as read")
            }}
            disabled={counts.unread === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCheck className="size-4" />
            Mark all read
          </button>
          {counts.dismissed > 0 ? (
            <button
              type="button"
              onClick={() => {
                clearDismissed()
                toast("Dismissed notifications restored")
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-4" />
              Restore {counts.dismissed} dismissed
            </button>
          ) : null}
        </div>
      </header>

      {/* Tabs */}
      <div className="mt-6 -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 rounded-xl border border-border bg-card p-1">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                tab === id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {label}
              {counts[id] > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 font-mono text-[9px] tabular-nums",
                    tab === id ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {counts[id]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* Search + sort */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search notifications…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search notifications"
            className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-3 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 sm:h-9 sm:text-sm"
          />
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as NotificationSort)}
            aria-label="Sort notifications"
            className="w-full bg-transparent text-sm text-foreground focus:outline-none sm:w-auto"
          >
            {SORTS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      <div className="mt-6 flex flex-col gap-2">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-muted">
              {tab === "dismissed" ? <BellOff className="size-6 text-muted-foreground" /> : <Inbox className="size-6 text-muted-foreground" />}
            </div>
            {tab === "dismissed" ? (
              <div>
                <p className="font-semibold text-foreground">Nothing dismissed</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Dismissed notifications rest here so you can bring one back.
                </p>
              </div>
            ) : search.trim() ? (
              <div>
                <p className="font-semibold text-foreground">No notifications match “{search.trim()}”</p>
                <p className="mt-1 text-sm text-muted-foreground">Try a business name, a status, or a shorter phrase.</p>
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="mt-3 text-sm text-primary hover:underline"
                >
                  Clear search
                </button>
              </div>
            ) : !hydrated || (session && requestsLoading) ? (
              <p className="text-sm text-muted-foreground">Loading your notifications…</p>
            ) : (
              <div>
                <p className="font-semibold text-foreground">You&apos;re all caught up</p>
                <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                  Plans to review, build results, launches, and request updates land here as they happen.
                </p>
                <Link
                  href="/new"
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Start a business
                </Link>
              </div>
            )}
          </div>
        ) : (
          visible.map((item) => {
            const unseen = !read.has(item.id)
            const gone = dismissed.has(item.id)
            return (
              <article
                key={item.id}
                className={cn(
                  "rounded-xl border bg-card px-4 py-4 transition-colors sm:px-5",
                  gone ? "border-border opacity-70" : "border-border hover:border-primary/30",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                      SEVERITY_STYLE[item.severity],
                    )}
                  >
                    {KIND_LABEL[item.kind]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold leading-snug text-foreground">
                      {unseen && !gone ? <span className="size-1.5 rounded-full bg-primary" aria-hidden /> : null}
                      <span className="min-w-0">{item.title}</span>
                    </p>
                    <p className="mt-1 text-sm break-words text-muted-foreground">{item.description}</p>
                    <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                      {relativeTimeShort(item.at)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {gone ? (
                    <button
                      type="button"
                      onClick={() => restoreItem(item)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Undo2 className="size-3.5" />
                      Restore
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openItem(item)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
                      >
                        {item.actionLabel}
                        <ArrowRight className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => (unseen ? markRead(item.id) : markUnread(item.id))}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {unseen ? "Mark read" : "Mark unread"}
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissItem(item)}
                        aria-label={`Dismiss: ${item.title}`}
                        className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X className="size-4" />
                      </button>
                    </>
                  )}
                </div>
              </article>
            )
          })
        )}
      </div>

      {live.length > 0 || counts.dismissed > 0 ? (
        <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
          Showing {visible.length} of {tab === "dismissed" ? counts.dismissed : counts.all} notification
          {tab === "dismissed" ? (counts.dismissed === 1 ? "" : "s") : counts.all === 1 ? "" : "s"}
          {counts.unread > 0 && tab !== "dismissed" ? ` · ${counts.unread} unread` : ""}
          . Notifications track live work, so a resolved item leaves the list on its own.
        </p>
      ) : null}
    </div>
  )
}
